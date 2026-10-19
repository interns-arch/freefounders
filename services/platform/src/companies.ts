// Company management from the command line (the owner console for staff is /console, PLAN.md §21).
//   npm run company -- list
//   npm run company -- create --name "Acme Pvt Ltd" --code ACME --owner-name "Asha Rao" --owner-email asha@acme.in
//                              [--owner-login asha] [--owner-password ...] [--apps tasks,assets]
//   npm run company -- sync [--code X]   set up every active company (or one) in each app it has, and re-link
//                              people who already have an app (safe to repeat)
//   npm run company -- reset --code DEMO --keep-owner [--no-staff]
//                              LOCAL TEST DATA ONLY: delete everyone but the owner(s) and their records in every app,
//                              archive every role but Admin and Member (back to defaults). Refused on a non-local database.
//   npm run company -- staff --email someone@freefounders.in [--off]
//                              mark an account (made by sign-up) as FreeFounders staff: it opens the owner console
// In multi-company mode each app keeps a company's data in its own schema; `create` and `sync` ask the apps
// (TASKS_INTERNAL_URL, ASSETS_INTERNAL_URL) to create it. Without a password one is generated, printed once,
// (they can change it from the account menu; nothing forces it). The steps are shared with self-serve sign-up
// (src/company/setup.service.ts).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { asc, eq, sql } from 'drizzle-orm';
import { AppModule } from './app.module';
import { hashPassword } from './auth/auth.service';
import { DbService } from './db/db.service';
import { accounts, APPS, companies, logins, people, subscriptions } from './db/schema';
import { CODE_RE, CompanySetupService } from './company/setup.service';
import { RolesService } from './roles/roles.service';

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

async function main() {
  process.env.FF_CLI = 'true'; // no background event polling in a one-off command
  const [command = 'list', ...rest] = process.argv.slice(2);
  const opts = args(rest);
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const dbs = ctx.get(DbService);
  const setup = ctx.get(CompanySetupService);
  const roles = ctx.get(RolesService);
  const say = (line: string) => console.log(line);
  try {
    if (command === 'list') {
      const rows = await dbs.db
        .select({
          name: companies.name,
          code: companies.code,
          apps: companies.enabledApps,
          status: companies.status,
          plan: sql<string>`coalesce(${subscriptions.plan}, 'complimentary') || ' / ' || coalesce(${subscriptions.state}, 'active')`,
          people: sql<number>`(select count(*)::int from ${people} where ${people.companyId} = ${companies.id})`,
        })
        .from(companies)
        .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
        .orderBy(asc(companies.createdAt));
      for (const r of rows) console.log(`${r.code.padEnd(16)} ${r.name.padEnd(32)} ${r.status.padEnd(9)} ${String(r.people).padStart(5)} people  [${r.apps.join(', ')}]  ${r.plan}`);
      return;
    }

    if (command === 'sync') {
      const only = opts.code?.trim().toUpperCase();
      const rows = (await dbs.db.select().from(companies).where(eq(companies.status, 'active')).orderBy(asc(companies.createdAt))).filter((c) => !only || c.code === only);
      if (only && !rows.length) throw new Error(`No active company with code ${only}`);
      for (const c of rows) {
        console.log(`${c.name} (${c.code})`);
        await setup.sync(c, say);
        const conv = roles.conversions.get(c.id);
        if (conv) console.log(`  ✔ two built-in roles (PLAN.md §19.28): ${conv.archived.length} template role(s) archived; ${conv.admin} → Admin, ${conv.member} → Member${conv.extra ? `, ${conv.extra} with extra access` : ''}`);
      }
      return;
    }

    if (command === 'reset') {
      const code = opts.code?.trim().toUpperCase();
      if (!code || opts['keep-owner'] !== 'true') throw new Error('reset needs --code <CODE> --keep-owner (everyone else is deleted)');
      const host = new URL(process.env.DATABASE_URL ?? 'postgres://localhost/ff_platform').hostname;
      if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
        throw new Error('reset is for local test data only (the database must be on localhost)');
      }
      const [c] = await dbs.db.select().from(companies).where(eq(companies.code, code)).limit(1);
      if (!c) throw new Error(`No company with code ${code}`);
      console.log(`${c.name} (${c.code}): reset to the owner only`);
      await setup.resetToOwner(c.id, { keepStaff: opts['no-staff'] !== 'true' }, say);
      return;
    }

    if (command === 'staff') {
      const email = opts.email?.trim().toLowerCase();
      if (!email) throw new Error('staff needs --email (an account made by sign-up)');
      const [a] = await dbs.db
        .update(accounts)
        .set({ isStaff: opts.off !== 'true', updatedAt: new Date() })
        .where(sql`lower(${accounts.email}) = ${email}`)
        .returning({ id: accounts.id });
      if (!a) throw new Error(`No account with the email ${email} (they sign up first)`);
      console.log(`✔ ${email} ${opts.off === 'true' ? 'is no longer' : 'is now'} FreeFounders staff (owner console)`);
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
      if (password.length < 6) throw new Error('--owner-password must be at least 6 characters');

      const company = await dbs.db.transaction(async (tx) => {
        const [c] = await tx.insert(companies).values({ name, code, enabledApps: apps }).returning();
        const [owner] = await tx.insert(people).values({ companyId: c.id, fullName: ownerName, email: ownerEmail, platformRole: 'owner' }).returning();
        await tx.insert(logins).values({ personId: owner.id, username: opts['owner-login']?.trim() || null, passwordHash: await hashPassword(password), mustChangePassword: false });
        // Made by us, not by sign-up: no billing (PLAN.md §21).
        await tx.insert(subscriptions).values({ companyId: c.id, plan: 'complimentary', state: 'active' });
        return c;
      });
      console.log(`✔ ${company.name} (${company.code}) created; owner ${ownerEmail}`);
      if (generated) console.log(`  Password: ${password}   (shown once; they can change it from the account menu)`);
      await setup.provisionNew(company, say);
      return;
    }

    throw new Error(`Unknown command "${command}". Use list, create, sync or staff.`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
