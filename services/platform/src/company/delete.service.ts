import { Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbService, type Executor } from '../db/db.service';
import {
  accounts,
  APPS,
  type AppKey,
  billingProfiles,
  checkoutSessions,
  companies,
  departments,
  eventCursors,
  invites,
  invoiceLines,
  invoices,
  logins,
  payments,
  people,
  personApps,
  personRoles,
  refreshSessions,
  roles,
  seatChanges,
  serviceLogs,
  staffAudit,
  subscriptions,
} from '../db/schema';
import { type AppCompanyData, internalUrl, ProvisionClient } from '../provision/provision.client';

type Say = (line: string) => void;

export interface DeleteAccount {
  id: string;
  label: string;
}

/** Everything `company -- delete` would remove (or keep), read without changing anything. */
export interface CompanyDeletePlan {
  company: { id: string; code: string; name: string; status: string; enabledApps: string[] };
  /** Companies other than this one (the last one is never deleted). */
  otherCompanies: number;
  /** Platform rows that go, per table. */
  counts: Record<string, number>;
  /** Paid invoices / captured payments (and their total in paise): refused without --force-paid. */
  paid: { invoices: number; payments: number; total: number };
  /** Accounts left with no company: deleted. */
  accountsDeleted: DeleteAccount[];
  /** Accounts that stay: Kaampilot staff, or still in another company. */
  accountsKeptStaff: DeleteAccount[];
  accountsKeptShared: number;
  /** Kept on purpose (history): staff audit rows and production log rows of the company. */
  kept: { staffAudit: number; serviceLogs: number };
  /** Per app: what it holds for the company (null = not in multi-company mode; error = could not ask). */
  apps: Array<{ app: AppKey; connected: boolean; data?: AppCompanyData | null; error?: string }>;
}

export interface CompanyDeleteOptions {
  forcePaid?: boolean;
  /** Also the last remaining company (`--allow-last`, `wipe-all`). */
  allowLast?: boolean;
  /** Who ran it (staff audit): "cli" from the command line. */
  by?: string;
}

const n = sql<number>`count(*)::int`;
/**
 * The account is in no company. Written out in full: drizzle prints a column inside sql`` without its table, so
 * `${people.accountId} = ${accounts.id}` would compare two columns of `people` and match every account.
 */
const NO_MEMBERSHIP = sql.raw('not exists (select 1 from platform.people p where p.account_id = platform.accounts.id)');
const label = (a: { email: string | null; mobile: string | null; username: string | null; fullName: string }) =>
  `${a.fullName} <${a.email ?? a.mobile ?? a.username ?? 'no email'}>`;

/** Why the delete is refused, or null. Pure, so it can be tested without a database holding one company. */
export function deleteRefusal(plan: Pick<CompanyDeletePlan, 'otherCompanies' | 'paid' | 'apps' | 'company'>, opts: CompanyDeleteOptions = {}): string | null {
  if (plan.otherCompanies < 1 && !opts.allowLast) return `${plan.company.code} is the last remaining company: add --allow-last to delete it too`;
  if ((plan.paid.invoices || plan.paid.payments) && !opts.forcePaid) {
    return (
      `${plan.company.code} has paid for Kaampilot (${plan.paid.invoices} paid invoice(s), ${plan.paid.payments} captured payment(s), ` +
      `₹${(plan.paid.total / 100).toFixed(2)}). GST invoices are tax records: keep them unless you are sure. Add --force-paid to delete them too.`
    );
  }
  const missing = plan.apps.filter((a) => !a.connected).map((a) => `${a.app.toUpperCase()}_INTERNAL_URL`);
  if (missing.length) {
    return `${missing.join(' and ')} not set: the apps could not delete the company's data. Run it where the Platform reaches the apps (the platform container on the server).`;
  }
  const failed = plan.apps.filter((a) => a.error);
  if (failed.length) return `Could not ask ${failed.map((a) => `${a.app} (${a.error})`).join(', ')}: nothing was deleted`;
  return null;
}

/**
 * Permanently deletes a company (PLAN.md §14, "Deleting a company"): first in each app (its schema, registry row and
 * files), then every Platform row about it, then the accounts left with no company (never Kaampilot staff). Each step
 * can be repeated: after a partial failure, running it again finishes the job. Staff audit and the 30-day production
 * log keep their rows (the company code stays readable there).
 */
@Injectable()
export class CompanyDeleteService {
  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
  ) {}

  async plan(code: string): Promise<CompanyDeletePlan | null> {
    const db = this.dbs.db;
    const [c] = await db.select().from(companies).where(eq(companies.code, code.trim().toUpperCase())).limit(1);
    if (!c) return null;
    const id = c.id;
    const count = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
    const inCompany = eq(people.companyId, id);
    const counts: Record<string, number> = {
      people: await count(db.select({ n }).from(people).where(inCompany)),
      logins: await count(db.select({ n }).from(logins).innerJoin(people, eq(people.id, logins.personId)).where(inCompany)),
      person_apps: await count(db.select({ n }).from(personApps).innerJoin(people, eq(people.id, personApps.personId)).where(inCompany)),
      refresh_sessions: await count(db.select({ n }).from(refreshSessions).innerJoin(people, eq(people.id, refreshSessions.personId)).where(inCompany)),
      invites: await count(db.select({ n }).from(invites).where(eq(invites.companyId, id))),
      roles: await count(db.select({ n }).from(roles).where(eq(roles.companyId, id))),
      person_roles: await count(db.select({ n }).from(personRoles).innerJoin(roles, eq(roles.id, personRoles.roleId)).where(eq(roles.companyId, id))),
      departments: await count(db.select({ n }).from(departments).where(eq(departments.companyId, id))),
      event_cursors: await count(db.select({ n }).from(eventCursors).where(eq(eventCursors.companyId, id))),
      subscriptions: await count(db.select({ n }).from(subscriptions).where(eq(subscriptions.companyId, id))),
      billing_profiles: await count(db.select({ n }).from(billingProfiles).where(eq(billingProfiles.companyId, id))),
      checkout_sessions: await count(db.select({ n }).from(checkoutSessions).where(eq(checkoutSessions.companyId, id))),
      invoices: await count(db.select({ n }).from(invoices).where(eq(invoices.companyId, id))),
      invoice_lines: await count(db.select({ n }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(eq(invoices.companyId, id))),
      payments: await count(db.select({ n }).from(payments).where(eq(payments.companyId, id))),
      seat_changes: await count(db.select({ n }).from(seatChanges).where(eq(seatChanges.companyId, id))),
    };
    const [paidInv] = await db
      .select({ n, total: sql<number>`coalesce(sum(${invoices.total}), 0)::int` })
      .from(invoices)
      .where(and(eq(invoices.companyId, id), eq(invoices.status, 'paid')));
    const [paidPay] = await db
      .select({ n, total: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.companyId, id), eq(payments.status, 'captured')));
    const { deleted, staff, shared } = await this.accountsOf(db, id);
    const apps: CompanyDeletePlan['apps'] = [];
    for (const app of APPS) {
      if (!internalUrl(app)) {
        apps.push({ app, connected: false });
        continue;
      }
      try {
        apps.push({ app, connected: true, data: await this.provisioner.companyData(app, id, 'GET') });
      } catch (err) {
        apps.push({ app, connected: true, error: (err as Error).message });
      }
    }
    return {
      company: { id, code: c.code, name: c.name, status: c.status, enabledApps: c.enabledApps },
      otherCompanies: await count(db.select({ n }).from(companies).where(ne(companies.id, id))),
      counts,
      paid: { invoices: paidInv?.n ?? 0, payments: paidPay?.n ?? 0, total: Math.max(paidInv?.total ?? 0, paidPay?.total ?? 0) },
      accountsDeleted: deleted,
      accountsKeptStaff: staff,
      accountsKeptShared: shared,
      kept: {
        staffAudit: await count(db.select({ n }).from(staffAudit).where(eq(staffAudit.companyId, id))),
        serviceLogs: await count(db.select({ n }).from(serviceLogs).where(eq(serviceLogs.companyId, id))),
      },
      apps,
    };
  }

  /** The company's members' accounts: those left with no company go (never staff); the rest stay. */
  private async accountsOf(db: Executor, companyId: string) {
    const rows = await db
      .select({
        id: accounts.id,
        email: accounts.email,
        mobile: accounts.mobile,
        username: accounts.username,
        fullName: accounts.fullName,
        isStaff: accounts.isStaff,
        elsewhere: sql<number>`(select count(*)::int from platform.people p2 where p2.account_id = platform.accounts.id and p2.company_id <> ${companyId})`,
      })
      .from(accounts)
      .where(inArray(accounts.id, db.selectDistinct({ id: people.accountId }).from(people).where(eq(people.companyId, companyId))));
    const deleted: DeleteAccount[] = [];
    const staff: DeleteAccount[] = [];
    let shared = 0;
    for (const a of rows) {
      if (a.elsewhere > 0) shared++;
      else if (a.isStaff) staff.push({ id: a.id, label: label(a) });
      else deleted.push({ id: a.id, label: label(a) });
    }
    return { deleted, staff, shared };
  }

  /** Accounts in no company at all (never Kaampilot staff): what `wipe-all` removes at the end. */
  async orphanAccounts(): Promise<DeleteAccount[]> {
    const rows = await this.dbs.db
      .select({ id: accounts.id, email: accounts.email, mobile: accounts.mobile, username: accounts.username, fullName: accounts.fullName })
      .from(accounts)
      .where(and(eq(accounts.isStaff, false), NO_MEMBERSHIP));
    return rows.map((a) => ({ id: a.id, label: label(a) }));
  }

  async deleteOrphanAccounts(by = 'cli'): Promise<number> {
    return this.dbs.tx(async (tx) => {
      const gone = await tx
        .delete(accounts)
        .where(and(eq(accounts.isStaff, false), NO_MEMBERSHIP))
        .returning({ id: accounts.id });
      await tx.insert(staffAudit).values({ staffEmail: by, action: 'accounts.delete_orphans', details: { by, accountsDeleted: gone.length } });
      return gone.length;
    });
  }

  /** Prints the plan (dry run and before a real run). */
  describe(plan: CompanyDeletePlan, say: Say) {
    const c = plan.company;
    say(`${c.name} (${c.code})  id ${c.id}  status ${c.status}  apps [${c.enabledApps.join(', ')}]`);
    say('  Platform rows deleted:');
    for (const [table, rows] of Object.entries(plan.counts)) say(`    ${table.padEnd(18)} ${String(rows).padStart(6)}`);
    say(`  Accounts left with no company (deleted): ${plan.accountsDeleted.length}`);
    for (const a of plan.accountsDeleted) say(`    - ${a.label}`);
    if (plan.accountsKeptStaff.length) say(`  Kaampilot staff accounts kept: ${plan.accountsKeptStaff.map((a) => a.label).join(', ')}`);
    if (plan.accountsKeptShared) say(`  Accounts kept (still in another company): ${plan.accountsKeptShared}`);
    say(`  Kept for history: ${plan.kept.staffAudit} staff audit row(s); ${plan.kept.serviceLogs} production log row(s) (expire after 30 days)`);
    if (plan.paid.invoices || plan.paid.payments) {
      say(`  PAID: ${plan.paid.invoices} paid invoice(s), ${plan.paid.payments} captured payment(s), ₹${(plan.paid.total / 100).toFixed(2)}`);
    }
    for (const a of plan.apps) {
      if (!a.connected) say(`  ${a.app}: not connected (${a.app.toUpperCase()}_INTERNAL_URL is not set)`);
      else if (a.error) say(`  ${a.app}: could not ask (${a.error})`);
      else if (a.data === null) say(`  ${a.app}: not in multi-company mode, nothing to remove there`);
      else if (!a.data?.registered) say(`  ${a.app}: nothing (not set up there, or already removed)`);
      else {
        const d = a.data;
        say(
          `  ${a.app}: schema ${d.schema}${d.schemaExists === false ? ' (missing)' : ''}: ${d.tables ?? 0} tables, about ${d.rows ?? 0} rows; registry row; ` +
            `files ${d.files?.path ?? '-'} (${d.files?.count ?? 0} file(s)${d.files?.bytes ? `, ${Math.round(d.files.bytes / 1024)} KB` : ''})`,
        );
      }
    }
  }

  /** The real delete. Throws on a refusal or an app failure (nothing more is deleted; running it again continues). */
  async run(code: string, opts: CompanyDeleteOptions, say: Say): Promise<CompanyDeletePlan> {
    const plan = await this.plan(code);
    if (!plan) throw new Error(`No company with code ${code.trim().toUpperCase()} (already deleted?)`);
    const why = deleteRefusal(plan, opts);
    if (why) throw new Error(why);
    const id = plan.company.id;
    // Closed first: no sign-in, refresh or API call for it while the apps delete (auth checks companies.status).
    await this.dbs.db.update(companies).set({ status: 'deleting', updatedAt: new Date() }).where(eq(companies.id, id));
    const appResults: Record<string, unknown> = {};
    for (const a of plan.apps) {
      if (a.data === null) {
        appResults[a.app] = 'not multi-company';
        continue;
      }
      const res = await this.provisioner.companyData(a.app, id, 'DELETE');
      appResults[a.app] = res ? { schema: res.schema ?? a.data?.schema ?? null, deleted: res.deleted ?? false, files: res.files ?? null } : 'not multi-company';
      say(
        res?.deleted
          ? `  ✔ ${a.app}: schema ${res.schema} dropped, registry row deleted, ${res.files?.count ?? 0} file(s) removed${res.files?.path ? ` (${res.files.path})` : ''}`
          : `  ✔ ${a.app}: nothing left there`,
      );
    }

    const removed = await this.dbs.tx(async (tx) => {
      const { deleted } = await this.accountsOf(tx, id);
      const ids = (await tx.select({ id: people.id }).from(people).where(eq(people.companyId, id))).map((p) => p.id);
      // Billing first (invoices are referenced by payments and seat changes; checkout sessions by both).
      await tx.delete(payments).where(eq(payments.companyId, id));
      await tx.delete(seatChanges).where(eq(seatChanges.companyId, id));
      await tx.delete(invoices).where(eq(invoices.companyId, id)); // invoice lines cascade
      await tx.delete(checkoutSessions).where(eq(checkoutSessions.companyId, id));
      await tx.delete(billingProfiles).where(eq(billingProfiles.companyId, id));
      await tx.delete(invites).where(eq(invites.companyId, id));
      await tx.delete(eventCursors).where(eq(eventCursors.companyId, id));
      if (ids.length) await tx.update(people).set({ reportsTo: null }).where(inArray(people.reportsTo, ids));
      // Logins, app links, refresh sessions, role holdings and personal roles cascade with the people.
      await tx.delete(people).where(eq(people.companyId, id));
      await tx.delete(roles).where(eq(roles.companyId, id));
      await tx.delete(departments).where(eq(departments.companyId, id));
      await tx.delete(subscriptions).where(eq(subscriptions.companyId, id));
      await tx.delete(companies).where(eq(companies.id, id));
      // Checked again inside the transaction: an account that joined another company meanwhile stays.
      const gone = deleted.length
        ? await tx
            .delete(accounts)
            .where(and(inArray(accounts.id, deleted.map((a) => a.id)), eq(accounts.isStaff, false), NO_MEMBERSHIP))
            .returning({ id: accounts.id })
        : [];
      await tx.insert(staffAudit).values({
        staffEmail: opts.by ?? 'cli',
        action: 'company.delete',
        companyId: id,
        companyCode: plan.company.code,
        details: {
          name: plan.company.name,
          by: opts.by ?? 'cli',
          osUser: process.env.USER ?? process.env.USERNAME ?? null,
          forcePaid: !!opts.forcePaid,
          allowLast: !!opts.allowLast,
          paid: plan.paid,
          counts: plan.counts,
          accountsDeleted: gone.length,
          accountsKeptStaff: plan.accountsKeptStaff.length,
          accountsKeptShared: plan.accountsKeptShared,
          apps: appResults,
        },
      });
      return gone.length;
    });
    say(`  ✔ Platform: ${plan.counts.people} people, ${plan.counts.roles} roles, ${plan.counts.invites} invites, billing rows and the company deleted; ${removed} account(s) with no company left deleted`);
    say('  ✔ staff audit: company.delete written');
    return plan;
  }
}
