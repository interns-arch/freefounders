// Company management from the command line (the platform owner console comes in Phase 8).
//   npm run company -- list
//   npm run company -- create --name "Acme Pvt Ltd" --code ACME --owner-name "Asha Rao" --owner-email asha@acme.in
//                              [--owner-login asha] [--owner-password ...] [--apps tasks,assets]
//   npm run company -- sync    set up every active company in each app it has, and re-link people who
//                              already have an app (safe to repeat)
// In multi-company mode each app keeps a company's data in its own schema; `create` and `sync` ask the apps
// (TASKS_INTERNAL_URL, ASSETS_INTERNAL_URL) to create it. Without a password one is generated, printed once,
// and must be changed at first sign-in.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppModule } from './app.module';
import { hashPassword } from './auth/auth.service';
import { DbService } from './db/db.service';
import { type AppKey, APPS, companies, logins, people, personApps } from './db/schema';
import { internalUrl, ProvisionClient } from './provision/provision.client';
import { CompanyService } from './company/company.service';
import { RolesService } from './roles/roles.service';
import { DirectoryService } from './people/directory.service';

const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

async function setUpInApps(provisioner: ProvisionClient, company: { id: string; code: string; name: string; enabledApps: string[] }) {
  for (const app of company.enabledApps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a))) {
    if (!internalUrl(app)) {
      console.log(`  • ${app}: skipped (${app.toUpperCase()}_INTERNAL_URL is not set)`);
      continue;
    }
    const res = await provisioner.setUpCompany(app, { companyId: company.id, code: company.code, name: company.name });
    console.log(`  ✔ ${app}: ${res.created ? 'set up' : 'up to date'} (${res.schema})`);
  }
}

/**
 * Provisions every person who already has an app again and stores the app's user id. Provisioning finds the
 * person's existing user first, so this changes nothing when all is well, and repairs the links after an app's
 * data moved (e.g. switching an install to multi-company mode, or the CarTrends import).
 */
async function relink(dbs: DbService, provisioner: ProvisionClient, companyId: string) {
  const grants = await dbs.db
    .select({ personId: people.id, fullName: people.fullName, email: people.email, employeeCode: people.employeeCode, mobile: people.mobile, platformRole: people.platformRole, username: logins.username, app: personApps.app, localUserId: personApps.localUserId })
    .from(personApps)
    .innerJoin(people, eq(people.id, personApps.personId))
    .leftJoin(logins, eq(logins.personId, people.id))
    .where(eq(people.companyId, companyId));
  let changed = 0;
  for (const g of grants) {
    if (!(APPS as readonly string[]).includes(g.app) || !internalUrl(g.app as AppKey)) continue;
    try {
      const localUserId = await provisioner.provision(g.app as AppKey, companyId, {
        personId: g.personId,
        fullName: g.fullName,
        email: g.email,
        employeeCode: g.employeeCode,
        mobile: g.mobile,
        username: g.username,
        platformRole: g.platformRole,
      });
      if (localUserId !== g.localUserId) {
        await dbs.db.update(personApps).set({ localUserId }).where(and(eq(personApps.personId, g.personId), eq(personApps.app, g.app)));
        changed++;
      }
    } catch (err) {
      console.log(`  ✖ ${g.fullName} in ${g.app}: ${(err as Error).message}`);
    }
  }
  if (grants.length) console.log(`  ✔ ${grants.length} app access link(s) checked, ${changed} updated`);
}

/** Brings the company into the role builder (first time) and sends every app the current roles. */
async function syncRoles(rolesSvc: RolesService, companyId: string) {
  if (!APPS.some((a) => internalUrl(a))) return;
  try {
    const res = await rolesSvc.sync(companyId);
    console.log(`  ✔ roles: ${res.imported ? 'imported from the apps, ' : ''}sent to ${Object.entries(res.push).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
  } catch (err) {
    console.log(`  ✖ roles: ${(err as Error).message}`);
  }
}

/** Brings the company into the People directory (first time) and sends it to every app. */
async function syncPeople(directory: DirectoryService, companyId: string) {
  if (!APPS.some((a) => internalUrl(a))) return;
  try {
    const res = await directory.sync(companyId);
    console.log(`  ✔ people: ${res.imported ? 'imported from the apps, ' : ''}sent to ${Object.entries(res.push).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
  } catch (err) {
    console.log(`  ✖ people: ${(err as Error).message}`);
  }
}

/** Sends every app the company's names, colour, logo address and module switches. */
async function syncProfile(companySvc: CompanyService, companyId: string) {
  if (!APPS.some((a) => internalUrl(a))) return;
  const res = await companySvc.push(companyId);
  console.log(`  ✔ profile: sent to ${Object.entries(res).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
}

async function main() {
  const [command = 'list', ...rest] = process.argv.slice(2);
  const opts = args(rest);
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const dbs = ctx.get(DbService);
  const provisioner = ctx.get(ProvisionClient);
  const rolesSvc = ctx.get(RolesService);
  const companySvc = ctx.get(CompanyService);
  const directory = ctx.get(DirectoryService);
  try {
    if (command === 'list') {
      const rows = await dbs.db
        .select({ name: companies.name, code: companies.code, apps: companies.enabledApps, status: companies.status, people: sql<number>`(select count(*)::int from ${people} where ${people.companyId} = ${companies.id})` })
        .from(companies)
        .orderBy(asc(companies.createdAt));
      for (const r of rows) console.log(`${r.code.padEnd(16)} ${r.name.padEnd(32)} ${r.status.padEnd(9)} ${String(r.people).padStart(5)} people  [${r.apps.join(', ')}]`);
      return;
    }

    if (command === 'sync') {
      const rows = await dbs.db.select().from(companies).where(eq(companies.status, 'active')).orderBy(asc(companies.createdAt));
      for (const c of rows) {
        console.log(`${c.name} (${c.code})`);
        await setUpInApps(provisioner, c);
        await relink(dbs, provisioner, c.id);
        await syncRoles(rolesSvc, c.id);
        await syncProfile(companySvc, c.id);
        await syncPeople(directory, c.id);
      }
      return;
    }

    if (command === 'create') {
      const name = opts.name?.trim();
      const code = opts.code?.trim().toUpperCase();
      const ownerName = opts['owner-name']?.trim();
      const ownerEmail = opts['owner-email']?.trim().toLowerCase();
      const apps = (opts.apps ?? 'tasks,assets').split(',').map((a) => a.trim()).filter((a) => (APPS as readonly string[]).includes(a));
      if (!name || !code || !ownerName || !ownerEmail) throw new Error('create needs --name, --code, --owner-name and --owner-email');
      if (!CODE_RE.test(code)) throw new Error('--code: letters, digits and _ only, starting with a letter (2-41 characters)');
      const generated = !opts['owner-password'];
      const password = opts['owner-password'] ?? randomBytes(9).toString('base64url');
      if (password.length < 8) throw new Error('--owner-password must be at least 8 characters');

      const company = await dbs.db.transaction(async (tx) => {
        const [c] = await tx.insert(companies).values({ name, code, enabledApps: apps }).returning();
        const [owner] = await tx.insert(people).values({ companyId: c.id, fullName: ownerName, email: ownerEmail, platformRole: 'owner' }).returning();
        await tx.insert(logins).values({ personId: owner.id, username: opts['owner-login']?.trim() || null, passwordHash: await hashPassword(password), mustChangePassword: generated });
        return c;
      });
      console.log(`✔ ${company.name} (${company.code}) created; owner ${ownerEmail}`);
      if (generated) console.log(`  One-time password: ${password}   ← must be changed at first sign-in`);
      await setUpInApps(provisioner, company);
      if (APPS.some((a) => internalUrl(a))) {
        // A new company starts with the launch modules only (PLAN.md §16.2); an admin switches the rest on.
        await companySvc.applyLaunchDefaults(company.id);
      }
      await syncRoles(rolesSvc, company.id);
      await syncProfile(companySvc, company.id);
      await syncPeople(directory, company.id);
      return;
    }

    throw new Error(`Unknown command "${command}". Use list, create or sync.`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
