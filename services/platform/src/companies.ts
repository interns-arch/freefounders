// Company management from the command line (the owner console for staff is /console, PLAN.md §21).
//   npm run company -- list
//   npm run company -- create --name "Acme Pvt Ltd" --code ACME --owner-name "Asha Rao" --owner-email asha@acme.in
//                              [--owner-login asha] [--owner-password ...] [--apps tasks,assets]
//   npm run company -- sync [--code X]   set up every active company (or one) in each app it has, and re-link
//                              people who already have an app (safe to repeat)
//   npm run company -- reset --code DEMO --keep-owner [--no-staff]
//                              LOCAL TEST DATA ONLY: delete everyone but the owner(s) and their records in every app,
//                              archive every role but Admin and Member (back to defaults). Refused on a non-local database.
//   npm run company -- staff --email someone@kaampilot.com [--off]
//                              mark an account (made by sign-up) as Kaampilot staff: it opens the owner console
//   npm run company -- rename --code X --name "New name"
//                              rename a company (same uniqueness rule as Settings), then send the new name to the apps
//   npm run company -- delete --code X [--confirm X] [--force-paid] [--allow-last]
//                              PERMANENT. Without --confirm: a dry run that prints everything that would go. With
//                              --confirm <same code>: deletes it in Tasks and Assets (schema, registry row, files), then in
//                              the Platform (people, roles, invites, billing…, accounts left with no company; never staff
//                              accounts). Refuses the last company unless --allow-last, and a company that paid unless
//                              --force-paid.
//                              Safe to run again after a partial failure. On the server:
//                              docker compose exec platform node dist/companies.js delete --code X --confirm X
//   npm run company -- wipe-all [--confirm WIPE-ALL-COMPANIES] [--force-paid]
//                              PERMANENT. Every company, as `delete` (dry run without --confirm), then every account left
//                              with no company. Kaampilot staff accounts stay (they sign in to the owner console).
//   npm run company -- grant --code X --complimentary --all-modules [--confirm X]
//                              everything unlocked for good: complimentary plan (never expires, never read-only, no user
//                              limit), every plan area + AI, every module of every app on; pushed to the apps. Dry run
//                              without --confirm.
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
import { assertCompanyNameFree } from './company/company-name';
import { CompanyDeleteService, deleteRefusal } from './company/delete.service';
import { CompanyGrantService } from './company/grant.service';
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
      // Local only: the apps of `npm run dev` unless other addresses are given (they must delete the people's records too).
      process.env.TASKS_INTERNAL_URL ||= 'http://127.0.0.1:8000/api/internal';
      process.env.ASSETS_INTERNAL_URL ||= 'http://127.0.0.1:3000/api/internal';
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
      console.log(`✔ ${email} ${opts.off === 'true' ? 'is no longer' : 'is now'} Kaampilot staff (owner console)`);
      return;
    }

    if (command === 'rename') {
      const code = opts.code?.trim().toUpperCase();
      const name = opts.name?.trim();
      if (!code || !name || name === 'true') throw new Error('rename needs --code <CODE> --name "New name"');
      const [c] = await dbs.db.select().from(companies).where(eq(companies.code, code)).limit(1);
      if (!c) throw new Error(`No company with code ${code}`);
      const clean = await dbs.tx(async (tx) => {
        const value = await assertCompanyNameFree(tx, name, c.id);
        await tx.update(companies).set({ name: value, updatedAt: new Date() }).where(eq(companies.id, c.id));
        return value;
      });
      console.log(`✔ ${c.code}: "${c.name}" → "${clean}"`);
      await setup.syncProfile(c.id, say);
      return;
    }

    if (command === 'delete') {
      const code = opts.code?.trim().toUpperCase();
      if (!code || code === 'TRUE') throw new Error('delete needs --code <CODE> (dry run), then --confirm <CODE> to delete');
      const del = ctx.get(CompanyDeleteService);
      const forcePaid = opts['force-paid'] === 'true';
      const allowLast = opts['allow-last'] === 'true';
      const confirm = opts.confirm?.trim().toUpperCase();
      if (confirm && confirm !== code) throw new Error(`--confirm must repeat the code exactly (${code})`);
      const plan = await del.plan(code);
      if (!plan) throw new Error(`No company with code ${code} (already deleted?)`);
      console.log(confirm ? 'DELETING (permanent):' : 'DRY RUN (nothing changed):');
      del.describe(plan, say);
      const why = deleteRefusal(plan, { forcePaid, allowLast });
      if (why) throw new Error(`Refused: ${why}`);
      if (!confirm) {
        console.log(`\nNothing deleted. To delete it permanently: company -- delete --code ${code} --confirm ${code}${forcePaid ? ' --force-paid' : ''}${allowLast ? ' --allow-last' : ''}`);
        return;
      }
      await del.run(code, { forcePaid, allowLast, by: 'cli' }, say);
      console.log(`✔ ${plan.company.name} (${code}) deleted`);
      return;
    }

    if (command === 'wipe-all') {
      const del = ctx.get(CompanyDeleteService);
      const forcePaid = opts['force-paid'] === 'true';
      const confirmed = opts.confirm === 'WIPE-ALL-COMPANIES';
      if (opts.confirm && !confirmed) throw new Error('--confirm must be exactly WIPE-ALL-COMPANIES');
      const all = await dbs.db.select({ code: companies.code }).from(companies).orderBy(asc(companies.createdAt));
      console.log(confirmed ? `WIPING ALL ${all.length} COMPANIES (permanent):` : `DRY RUN (nothing changed): ${all.length} companies`);
      const plans = [];
      for (const { code } of all) {
        const plan = await del.plan(code);
        if (!plan) continue;
        del.describe(plan, say);
        const why = deleteRefusal(plan, { forcePaid, allowLast: true });
        if (why) throw new Error(`Refused (nothing deleted): ${why}`);
        plans.push(plan);
      }
      const leaving = new Set(plans.flatMap((p) => p.accountsDeleted.map((a) => a.id)));
      const already = (await del.orphanAccounts()).filter((a) => !leaving.has(a.id));
      console.log(`Accounts already in no company (deleted at the end, never staff): ${already.length}`);
      for (const a of already) console.log(`    - ${a.label}`);
      if (!confirmed) {
        console.log(`\nNothing deleted. To delete everything: company -- wipe-all --confirm WIPE-ALL-COMPANIES${forcePaid ? ' --force-paid' : ''}`);
        return;
      }
      for (const p of plans) {
        console.log(`${p.company.name} (${p.company.code})`);
        await del.run(p.company.code, { forcePaid, allowLast: true, by: 'cli' }, say);
      }
      const n = await del.deleteOrphanAccounts('cli');
      console.log(`✔ ${plans.length} companies deleted; ${n} more account(s) with no company deleted. Kaampilot staff accounts kept.`);
      return;
    }

    if (command === 'grant') {
      const code = opts.code?.trim().toUpperCase();
      if (!code || code === 'TRUE' || opts.complimentary !== 'true' || opts['all-modules'] !== 'true') {
        throw new Error('grant needs --code <CODE> --complimentary --all-modules (then --confirm <CODE>)');
      }
      const confirm = opts.confirm?.trim().toUpperCase();
      if (confirm && confirm !== code) throw new Error(`--confirm must repeat the code exactly (${code})`);
      const grant = ctx.get(CompanyGrantService);
      const plan = await grant.plan(code);
      if (!plan) throw new Error(`No company with code ${code}`);
      console.log(confirm ? 'GRANTING:' : 'DRY RUN (nothing changed):');
      grant.describe(plan, say);
      if (!confirm) {
        console.log(`\nNothing changed. To apply: company -- grant --code ${code} --complimentary --all-modules --confirm ${code}`);
        return;
      }
      await grant.run(code, 'cli', say);
      console.log(`✔ ${plan.company.name} (${code}): everything unlocked`);
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
        // Company names are unique across the product (PLAN.md §21.6): same check and lock as sign-up.
        const clean = await assertCompanyNameFree(tx, name);
        const [c] = await tx.insert(companies).values({ name: clean, code, enabledApps: apps }).returning();
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

    throw new Error(`Unknown command "${command}". Use list, create, sync, reset, staff, rename, delete, wipe-all or grant.`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
