/**
 * Kaampilot console dashboard (PLAN.md §21.9): read-only views across every company and account for Kaampilot staff.
 * Nothing here changes customer data. Every view of a company's or a person's data is written to the staff audit log
 * (`view.*` actions, at most one row per staff + action + subject every 10 minutes so auto-refresh does not flood it).
 */
import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { EXPORT_MAX } from '../common/export';
import { notFound } from '../common/http';
import type { SheetCell } from '../common/sheet';
import { BillingService, type StaffActor } from '../billing/billing.service';
import { DbService } from '../db/db.service';
import { staffAudit } from '../db/schema';
import { LogsService } from './logs.service';

import { VIEW_ACTIONS } from '../billing/billing.service';
export { VIEW_ACTIONS };
export type ViewAction = (typeof VIEW_ACTIONS)[number];
const VIEW_DEDUPE_MS = 10 * 60_000;

/** `as***@domain.com` */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return `${email.slice(0, 2)}***`;
  return `${user.slice(0, 2)}***@${domain}`;
}
/** `+91******3210` */
export function maskMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  return `${mobile.startsWith('+') ? `+${digits.slice(0, 2)}` : ''}******${digits.slice(-4)}`;
}

export const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

@Injectable()
export class ConsoleDashboardService {
  private readonly lastView = new Map<string, number>();

  constructor(
    private readonly dbs: DbService,
    private readonly billing: BillingService,
    private readonly logs: LogsService,
  ) {}

  private async rows<T>(q: SQL): Promise<T[]> {
    return (await this.dbs.root.execute(q)).rows as T[];
  }

  /** One staff_audit row per view (deduplicated for 10 minutes per staff + action + subject). Never fails the view. */
  async audit(staff: StaffActor, ip: string | undefined, action: ViewAction, subject: { companyId?: string | null; companyCode?: string | null; details?: Record<string, unknown> } = {}) {
    const key = `${staff.accountId}|${action}|${subject.companyId ?? ''}|${JSON.stringify(subject.details ?? {})}`;
    const now = Date.now();
    if ((this.lastView.get(key) ?? 0) > now - VIEW_DEDUPE_MS) return;
    this.lastView.set(key, now);
    if (this.lastView.size > 5000) this.lastView.clear();
    try {
      await this.dbs.root.insert(staffAudit).values({
        staffAccountId: staff.accountId,
        staffEmail: staff.email,
        action,
        companyId: subject.companyId ?? null,
        companyCode: subject.companyCode ?? null,
        details: { view: true, ...(subject.details ?? {}) },
        ip: ip ?? null,
      });
    } catch {
      this.lastView.delete(key);
    }
  }

  /** Tests only. */
  resetViewDedupe() {
    this.lastView.clear();
  }

  // ─── Overview ──────────────────────────────────────────────────────

  async overview() {
    const [summary, companies] = await Promise.all([this.billing.consoleSummary(), this.billing.consoleCompanies()]);
    const [people] = await this.rows<{ people: number; active_people: number; accounts: number; logins: number; staff: number }>(sql`
      select (select count(*)::int from platform.people) as people,
             (select count(*)::int from platform.people where status = 'active') as active_people,
             (select count(*)::int from platform.accounts) as accounts,
             (select count(*)::int from platform.logins l join platform.people p on p.id = l.person_id where p.account_id is null) as logins,
             (select count(*)::int from platform.accounts where is_staff) as staff`);
    // Active = signed in or refreshed a session (every page load renews it within 15 minutes).
    const [active] = await this.rows<{ today: number; d7: number; d30: number }>(sql`
      with act as (
        select coalesce(p.account_id::text, p.id::text) as who, r.created_at as at
          from platform.refresh_sessions r join platform.people p on p.id = r.person_id
         where r.created_at >= now() - interval '30 days'
        union all
        select coalesce(p.account_id::text, p.id::text), l.last_login_at
          from platform.logins l join platform.people p on p.id = l.person_id where l.last_login_at >= now() - interval '30 days'
        union all
        select a.id::text, a.last_login_at from platform.accounts a where a.last_login_at >= now() - interval '30 days'
      )
      select count(distinct who) filter (where at >= date_trunc('day', now()))::int as today,
             count(distinct who) filter (where at >= now() - interval '7 days')::int as d7,
             count(distinct who)::int as d30
        from act`);
    const signups = await this.rows<{ day: string; accounts: number; companies: number }>(sql`
      with days as (select generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') as day)
      select to_char(d.day, 'YYYY-MM-DD') as day,
             (select count(*)::int from platform.accounts a where a.created_at >= d.day and a.created_at < d.day + interval '1 day') as accounts,
             (select count(*)::int from platform.companies c where c.created_at >= d.day and c.created_at < d.day + interval '1 day') as companies
        from days d order by d.day`);
    const [money] = await this.rows<{ revenue_month: number; payments_month: number; failed_month: number; failed_30d: number }>(sql`
      select coalesce(sum(amount) filter (where status = 'captured' and created_at >= date_trunc('month', now())), 0)::int as revenue_month,
             count(*) filter (where status = 'captured' and created_at >= date_trunc('month', now()))::int as payments_month,
             count(*) filter (where status = 'failed' and created_at >= date_trunc('month', now()))::int as failed_month,
             count(*) filter (where status = 'failed' and created_at >= now() - interval '30 days')::int as failed_30d
        from platform.payments`);
    const [otp] = await this.rows<{ sent: number; failed: number }>(sql`
      select count(*) filter (where failed_at is null)::int as sent, count(*) filter (where failed_at is not null)::int as failed
        from platform.otp_codes where created_at >= date_trunc('day', now())`);
    const punches = await this.logs.punchesToday();
    const paidSeats = companies.reduce((s, c) => s + c.seats.paid, 0);
    return {
      companies: {
        total: summary.companies,
        active: summary.active,
        trialing: summary.trialing,
        free: summary.free,
        complimentary: summary.complimentary,
        pastDue: summary.pastDue,
        readOnly: summary.readOnly,
        suspended: summary.suspended,
        cancelled: summary.cancelled,
      },
      people: { total: people.people, active: people.active_people, accounts: people.accounts, adminLogins: people.logins, staff: people.staff },
      activeUsers: { today: active.today, d7: active.d7, d30: active.d30 },
      signups,
      punchesToday: punches,
      billing: { mrr: summary.mrr, revenueMonth: money.revenue_month, paymentsMonth: money.payments_month, paidSeats, seatsUsed: summary.seatsUsed, failedMonth: money.failed_month, failed30d: money.failed_30d },
      otpToday: otp,
      errorsToday: await this.logs.errorsToday(),
    };
  }

  // ─── Companies ─────────────────────────────────────────────────────

  /** The owner console's company list plus last activity and module switches (search / sort happen on the screen). */
  async companies() {
    const list = await this.billing.consoleCompanies();
    const extra = await this.rows<{ id: string; last: string | null; modules: Record<string, boolean> | null; people: number; billing: string | null }>(sql`
      select c.id, c.modules,
             (select count(*)::int from platform.people p where p.company_id = c.id) as people,
             (select greatest(max(l.last_login_at), max(a.last_login_at), max(r.created_at))
                from platform.people p
                left join platform.logins l on l.person_id = p.id
                left join platform.accounts a on a.id = p.account_id
                left join lateral (select max(created_at) as created_at from platform.refresh_sessions rs where rs.person_id = p.id) r on true
               where p.company_id = c.id) as last,
             (select status from platform.payments pm where pm.company_id = c.id order by created_at desc limit 1) as billing
        from platform.companies c`);
    const by = new Map(extra.map((e) => [e.id, e]));
    return list.map((c) => {
      const e = by.get(c.id);
      const off = Object.entries(e?.modules ?? {}).filter(([, on]) => on === false).map(([k]) => k);
      return { ...c, people: e?.people ?? 0, lastActivity: iso(e?.last), modulesOff: off, lastPayment: e?.billing ?? null };
    });
  }

  async company(id: string) {
    const all = await this.companies();
    const company = all.find((c) => c.id === id);
    if (!company) throw notFound('Company');
    const people = await this.rows<Record<string, unknown>>(sql`
      select p.id, p.full_name, p.platform_role, p.status, p.email, p.mobile, p.employee_code, p.created_at, p.account_id,
             l.username as login_username, a.username as account_username, a.email as account_email, a.mobile as account_mobile,
             greatest(l.last_login_at, a.last_login_at, (select max(created_at) from platform.refresh_sessions r where r.person_id = p.id)) as last_sign_in,
             coalesce((select array_agg(pa.app order by pa.app) from platform.person_apps pa where pa.person_id = p.id), '{}') as apps
        from platform.people p
        left join platform.logins l on l.person_id = p.id
        left join platform.accounts a on a.id = p.account_id
       where p.company_id = ${id}
       order by (p.platform_role = 'owner') desc, p.full_name`);
    const [sub] = await this.rows<Record<string, unknown>>(sql`select * from platform.subscriptions where company_id = ${id}`);
    const invoices = await this.rows<Record<string, unknown>>(sql`
      select id, number, issued_at, period_start, period_end, subtotal, cgst + sgst + igst as tax, total, status
        from platform.invoices where company_id = ${id} order by issued_at desc limit 200`);
    const payments = await this.rows<Record<string, unknown>>(sql`
      select id, created_at, gateway, gateway_payment_id, amount, status, reason
        from platform.payments where company_id = ${id} order by created_at desc limit 200`);
    const checkouts = await this.rows<Record<string, unknown>>(sql`
      select id, created_at, completed_at, gateway, plan, interval, seats, total, status
        from platform.checkout_sessions where company_id = ${id} order by created_at desc limit 100`);
    const seatChanges = await this.rows<Record<string, unknown>>(sql`
      select id, created_at, seats_from, seats_to, amount, effective_at from platform.seat_changes where company_id = ${id} order by created_at desc limit 100`);
    const audit = await this.rows<Record<string, unknown>>(sql`
      select id, at, action, staff_email, details, ip from platform.staff_audit where company_id = ${id} order by at desc limit 100`);
    const [errors] = await this.rows<{ n: number }>(sql`
      select coalesce(sum(count), 0)::int as n from platform.service_logs where company_id = ${id} and level = 'error' and at >= now() - interval '7 days'`);
    const [profile] = await this.rows<Record<string, unknown>>(sql`select legal_name, gstin, state from platform.billing_profiles where company_id = ${id}`);
    return {
      company,
      people: people.map((p) => ({
        id: p.id as string,
        name: p.full_name as string,
        role: p.platform_role as string,
        active: p.status === 'active',
        login: (p.account_username as string | null) ?? (p.login_username as string | null) ?? maskEmail((p.account_email as string | null) ?? (p.email as string | null)) ?? maskMobile((p.account_mobile as string | null) ?? (p.mobile as string | null)),
        kind: p.account_id ? 'account' : 'login',
        accountId: (p.account_id as string | null) ?? null,
        employeeCode: (p.employee_code as string | null) ?? null,
        apps: (p.apps as string[]) ?? [],
        lastSignIn: iso(p.last_sign_in),
        createdAt: iso(p.created_at),
      })),
      subscription: sub
        ? {
            plan: sub.plan,
            interval: sub.interval,
            state: sub.state,
            stateSince: iso(sub.state_since),
            seats: sub.seats,
            trialEndsAt: iso(sub.trial_ends_at),
            currentPeriodStart: iso(sub.current_period_start),
            currentPeriodEnd: iso(sub.current_period_end),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            gateway: sub.gateway ?? null,
          }
        : null,
      billingProfile: profile ? { legalName: profile.legal_name, gstin: profile.gstin, state: profile.state } : null,
      invoices: invoices.map((r) => ({ id: r.id, number: r.number, issuedAt: iso(r.issued_at), periodStart: iso(r.period_start), periodEnd: iso(r.period_end), subtotal: r.subtotal, tax: Number(r.tax), total: r.total, status: r.status })),
      payments: payments.map((r) => ({ id: r.id, at: iso(r.created_at), gateway: r.gateway, gatewayPaymentId: r.gateway_payment_id, amount: r.amount, status: r.status, reason: r.reason })),
      planChanges: [
        ...checkouts.map((r) => ({ at: iso(r.completed_at ?? r.created_at), kind: 'checkout', text: `${String(r.plan)} · ${String(r.interval)} · ${String(r.seats)} users · ${String(r.gateway)}`, status: r.status as string, amount: r.total as number })),
        ...seatChanges.map((r) => ({ at: iso(r.created_at), kind: 'seats', text: `Users ${String(r.seats_from)} → ${String(r.seats_to)}`, status: 'done', amount: r.amount as number })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at))),
      audit: audit.map((r) => ({ id: r.id, at: iso(r.at), action: r.action, staffEmail: r.staff_email, details: r.details, ip: r.ip })),
      errors7d: errors?.n ?? 0,
    };
  }

  // ─── Users ─────────────────────────────────────────────────────────

  private usersSql(q: UsersQuery, limit: number, offset: number) {
    const term = q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const match = (cols: SQL) => (term ? sql`and lower(${cols}) like ${term}` : sql``);
    return sql`
      with u as (
        select 'account' as kind, a.id, a.full_name as name, a.email, a.mobile, a.username, a.created_at, a.is_staff,
               greatest(a.last_login_at, (select max(r.created_at) from platform.refresh_sessions r join platform.people p on p.id = r.person_id where p.account_id = a.id)) as last_sign_in,
               coalesce((select array_agg(c.name order by c.name) from platform.people p join platform.companies c on c.id = p.company_id where p.account_id = a.id), '{}') as companies
          from platform.accounts a
         where true ${match(sql`concat_ws(' ', a.full_name, a.email, a.mobile, a.username)`)}
        union all
        select 'login', p.id, p.full_name, p.email, p.mobile, l.username, p.created_at, false,
               greatest(l.last_login_at, (select max(r.created_at) from platform.refresh_sessions r where r.person_id = p.id)),
               array[c.name]
          from platform.logins l join platform.people p on p.id = l.person_id join platform.companies c on c.id = p.company_id
         where p.account_id is null ${match(sql`concat_ws(' ', p.full_name, p.email, p.mobile, l.username, p.employee_code, c.name)`)}
      )
      select *, count(*) over ()::int as total from u order by created_at desc limit ${limit} offset ${offset}`;
  }

  async users(q: UsersQuery) {
    const rows = await this.rows<Record<string, unknown>>(this.usersSql(q, q.pageSize, (q.page - 1) * q.pageSize));
    return { total: (rows[0]?.total as number) ?? 0, page: q.page, pageSize: q.pageSize, rows: rows.map((r) => this.userRow(r)) };
  }

  private userRow(r: Record<string, unknown>) {
    return {
      kind: r.kind as 'account' | 'login',
      id: r.id as string,
      name: r.name as string,
      email: maskEmail(r.email as string | null),
      mobile: maskMobile(r.mobile as string | null),
      username: (r.username as string | null) ?? null,
      companies: (r.companies as string[]) ?? [],
      lastSignIn: iso(r.last_sign_in),
      createdAt: iso(r.created_at),
      // An account proved its email / mobile with a one-time code at sign-up; an admin-made login did not.
      verified: r.kind === 'account',
      staff: !!r.is_staff,
    };
  }

  async usersSheet(q: UsersQuery) {
    const rows = (await this.rows<Record<string, unknown>>(this.usersSql(q, EXPORT_MAX, 0))).map((r) => this.userRow(r));
    return {
      header: ['Name', 'Kind', 'Email', 'Mobile', 'Username', 'Companies', 'Last sign-in', 'Created', 'Verified', 'Staff'],
      rows: rows.map((u) => [u.name, u.kind === 'account' ? 'Account' : 'Admin-made login', u.email ?? '', u.mobile ?? '', u.username ?? '', u.companies.join(', '), u.lastSignIn ? new Date(u.lastSignIn) : null, u.createdAt ? new Date(u.createdAt) : null, u.verified ? 'Yes' : 'No', u.staff ? 'Yes' : ''] as SheetCell[]),
    };
  }

  /** One account (kind=account) or admin-made person (kind=login): memberships and recent sessions. */
  async user(kind: 'account' | 'login', id: string) {
    const [u] = await this.rows<Record<string, unknown>>(
      kind === 'account'
        ? sql`select 'account' as kind, a.id, a.full_name as name, a.email, a.mobile, a.username, a.created_at, a.is_staff, a.last_login_at as last_sign_in, '{}'::text[] as companies from platform.accounts a where a.id = ${id}`
        : sql`select 'login' as kind, p.id, p.full_name as name, p.email, p.mobile, l.username, p.created_at, false as is_staff, l.last_login_at as last_sign_in, '{}'::text[] as companies
                from platform.people p join platform.logins l on l.person_id = p.id where p.id = ${id} and p.account_id is null`,
    );
    if (!u) throw notFound('User');
    const memberships = await this.rows<Record<string, unknown>>(sql`
      select p.id as person_id, c.id as company_id, c.name, c.code, p.platform_role, p.status, p.created_at,
             coalesce((select array_agg(pa.app order by pa.app) from platform.person_apps pa where pa.person_id = p.id), '{}') as apps,
             (select max(created_at) from platform.refresh_sessions r where r.person_id = p.id) as last_session
        from platform.people p join platform.companies c on c.id = p.company_id
       where ${kind === 'account' ? sql`p.account_id = ${id}` : sql`p.id = ${id}`}
       order by c.name`);
    const sessions = await this.rows<Record<string, unknown>>(sql`
      select r.created_at, r.client, r.ip, r.user_agent, r.revoked_at, r.expires_at, c.code
        from platform.refresh_sessions r join platform.people p on p.id = r.person_id join platform.companies c on c.id = p.company_id
       where ${kind === 'account' ? sql`p.account_id = ${id}` : sql`p.id = ${id}`}
       order by r.created_at desc limit 20`);
    const row = this.userRow(u);
    return {
      user: { ...row, lastSignIn: iso(u.last_sign_in) ?? (sessions[0] ? iso(sessions[0].created_at) : null), companies: memberships.map((m) => m.name as string) },
      memberships: memberships.map((m) => ({
        personId: m.person_id,
        companyId: m.company_id,
        companyName: m.name,
        companyCode: m.code,
        role: m.platform_role,
        active: m.status === 'active',
        apps: m.apps,
        lastSession: iso(m.last_session),
        joinedAt: iso(m.created_at),
      })),
      sessions: sessions.map((s) => ({ at: iso(s.created_at), client: s.client, ip: s.ip, device: String(s.user_agent ?? '').slice(0, 120), companyCode: s.code, revoked: !!s.revoked_at, expiresAt: iso(s.expires_at) })),
    };
  }

  // ─── Billing ───────────────────────────────────────────────────────

  async billingAll() {
    const subscriptions = (await this.billing.consoleCompanies()).filter((c) => c.plan !== 'complimentary' || c.state !== 'active');
    const invoices = await this.rows<Record<string, unknown>>(sql`
      select i.id, i.number, i.issued_at, i.subtotal, i.cgst + i.sgst + i.igst as tax, i.total, i.status, c.name, c.code, c.id as company_id
        from platform.invoices i join platform.companies c on c.id = i.company_id order by i.issued_at desc limit 500`);
    const payments = await this.rows<Record<string, unknown>>(sql`
      select p.id, p.created_at, p.gateway, p.gateway_payment_id, p.amount, p.status, p.reason, c.name, c.code, c.id as company_id
        from platform.payments p join platform.companies c on c.id = p.company_id order by p.created_at desc limit 500`);
    const months = await this.rows<{ month: string; revenue: number; payments: number; failed: number; invoiced: number }>(sql`
      with m as (select generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') as month)
      select to_char(m.month, 'YYYY-MM') as month,
             coalesce((select sum(amount) from platform.payments p where p.status = 'captured' and p.created_at >= m.month and p.created_at < m.month + interval '1 month'), 0)::int as revenue,
             (select count(*) from platform.payments p where p.status = 'captured' and p.created_at >= m.month and p.created_at < m.month + interval '1 month')::int as payments,
             (select count(*) from platform.payments p where p.status = 'failed' and p.created_at >= m.month and p.created_at < m.month + interval '1 month')::int as failed,
             coalesce((select sum(total) from platform.invoices i where i.issued_at >= m.month and i.issued_at < m.month + interval '1 month'), 0)::int as invoiced
        from m order by m.month`);
    return {
      subscriptions,
      invoices: invoices.map((r) => ({ id: r.id, number: r.number, issuedAt: iso(r.issued_at), subtotal: r.subtotal, tax: Number(r.tax), total: r.total, status: r.status, companyId: r.company_id, companyName: r.name, companyCode: r.code })),
      payments: payments.map((r) => ({ id: r.id, at: iso(r.created_at), gateway: r.gateway, gatewayPaymentId: r.gateway_payment_id, amount: r.amount, status: r.status, reason: r.reason, companyId: r.company_id, companyName: r.name, companyCode: r.code })),
      months,
      // There is no refund flow yet (PLAN.md §21): refunds are made in the gateway's dashboard and do not show here.
      refunds: [] as unknown[],
    };
  }

  /** Download for the Billing tab: `sheet` = subscriptions | invoices | payments | months. */
  async billingSheet(sheet: string) {
    const b = await this.billingAll();
    const rs = (p: number) => p / 100;
    switch (sheet) {
      case 'invoices':
        return { name: 'console-invoices', header: ['Number', 'Issued', 'Company', 'Code', 'Subtotal (Rs.)', 'GST (Rs.)', 'Total (Rs.)', 'Status'], rows: b.invoices.map((i) => [i.number, i.issuedAt ? new Date(i.issuedAt) : null, i.companyName, i.companyCode, rs(i.subtotal as number), rs(i.tax), rs(i.total as number), i.status] as SheetCell[]) };
      case 'payments':
        return { name: 'console-payments', header: ['When', 'Company', 'Code', 'Gateway', 'Gateway payment', 'Amount (Rs.)', 'Status', 'Reason'], rows: b.payments.map((p) => [p.at ? new Date(p.at) : null, p.companyName, p.companyCode, p.gateway, p.gatewayPaymentId ?? '', rs(p.amount as number), p.status, p.reason ?? ''] as SheetCell[]) };
      case 'months':
        return { name: 'console-revenue', header: ['Month', 'Revenue (Rs.)', 'Payments', 'Failed', 'Invoiced (Rs.)'], rows: b.months.map((m) => [m.month, rs(m.revenue), m.payments, m.failed, rs(m.invoiced)] as SheetCell[]) };
      default:
        return {
          name: 'console-subscriptions',
          header: ['Company', 'Code', 'Plan', 'Interval', 'State', 'Users used', 'Users paid', 'MRR (Rs.)', 'Trial ends', 'Period ends'],
          rows: b.subscriptions.map((s) => [s.name, s.code, s.planName, s.interval, s.state, s.seats.used, s.seats.paid, rs(s.mrr), s.trialEndsAt ? new Date(s.trialEndsAt) : null, s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null] as SheetCell[]),
        };
    }
  }
}
