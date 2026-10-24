/**
 * Kaampilot console dashboard + production log (PLAN.md §21.9): Kaampilot staff only (Platform `/console/*`, 403 for
 * everyone else). Read-only; the owner console's existing actions stay in api.ts (`useConsoleAction`).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ExportTarget } from '../export';
import { platformApi } from '../http';
import type { ConsoleCompany, SubscriptionState } from './types';

// ─── types ──────────────────────────────────────────────────────────────────

export interface ConsoleOverview {
  companies: { total: number; active: number; trialing: number; free: number; complimentary: number; pastDue: number; readOnly: number; suspended: number; cancelled: number };
  people: { total: number; active: number; accounts: number; adminLogins: number; staff: number };
  activeUsers: { today: number; d7: number; d30: number };
  /** 30 days, oldest first: new accounts and new companies per day. */
  signups: Array<{ day: string; accounts: number; companies: number }>;
  /** From the Tasks worker's last heartbeat; null when none today. */
  punchesToday: { total: number | null; at: string | null };
  /** Amounts in paise. */
  billing: { mrr: number; revenueMonth: number; paymentsMonth: number; paidSeats: number; seatsUsed: number; failedMonth: number; failed30d: number };
  otpToday: { sent: number; failed: number };
  errorsToday: number;
}

export interface ConsoleHealthService {
  service: string;
  label: string;
  /** null = not connected / no heartbeat yet. */
  up: boolean | null;
  version: string | null;
  ms: number | null;
  note: string | null;
  errors24h: number;
  lastError: string | null;
  lastRun?: string | null;
  lastResults?: Record<string, number> | null;
}
export interface ConsoleHealth {
  checkedAt: string;
  services: ConsoleHealthService[];
}

export type DashboardCompany = ConsoleCompany & {
  seats: { used: number; paid: number };
  apps?: string[];
  interval?: string;
  currentPeriodEnd?: string | null;
  people: number;
  lastActivity: string | null;
  modulesOff: string[];
  lastPayment: string | null;
};

export interface DashboardPerson {
  id: string;
  name: string;
  role: string;
  active: boolean;
  /** Username, or a masked email / mobile. */
  login: string | null;
  kind: 'account' | 'login';
  accountId: string | null;
  employeeCode: string | null;
  apps: string[];
  lastSignIn: string | null;
  createdAt: string | null;
}

export interface DashboardCompanyDetail {
  company: DashboardCompany;
  people: DashboardPerson[];
  subscription: {
    plan: string;
    interval: string;
    state: SubscriptionState;
    stateSince: string | null;
    seats: number;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    gateway: string | null;
  } | null;
  billingProfile: { legalName: string; gstin: string | null; state: string } | null;
  invoices: Array<{ id: string; number: string; issuedAt: string | null; periodStart: string | null; periodEnd: string | null; subtotal: number; tax: number; total: number; status: string }>;
  payments: ConsolePayment[];
  planChanges: Array<{ at: string | null; kind: 'checkout' | 'seats'; text: string; status: string; amount: number }>;
  audit: Array<{ id: string; at: string | null; action: string; staffEmail: string | null; details: Record<string, unknown>; ip: string | null }>;
  errors7d: number;
}

export interface ConsoleUser {
  kind: 'account' | 'login';
  id: string;
  name: string;
  /** Masked (`as***@domain`). */
  email: string | null;
  /** Masked (`+91******3210`). */
  mobile: string | null;
  username: string | null;
  companies: string[];
  lastSignIn: string | null;
  createdAt: string | null;
  verified: boolean;
  staff: boolean;
}
export interface ConsoleUsersPage {
  total: number;
  page: number;
  pageSize: number;
  rows: ConsoleUser[];
}
export interface ConsoleUserDetail {
  user: ConsoleUser;
  memberships: Array<{ personId: string; companyId: string; companyName: string; companyCode: string; role: string; active: boolean; apps: string[]; lastSession: string | null; joinedAt: string | null }>;
  sessions: Array<{ at: string | null; client: string; ip: string | null; device: string; companyCode: string; revoked: boolean; expiresAt: string | null }>;
}

export interface ConsolePayment {
  id: string;
  at: string | null;
  gateway: string;
  gatewayPaymentId: string | null;
  amount: number;
  status: string;
  reason: string | null;
  companyId?: string;
  companyName?: string;
  companyCode?: string;
}
export interface ConsoleBilling {
  subscriptions: DashboardCompany[];
  invoices: Array<{ id: string; number: string; issuedAt: string | null; subtotal: number; tax: number; total: number; status: string; companyId: string; companyName: string; companyCode: string }>;
  payments: ConsolePayment[];
  months: Array<{ month: string; revenue: number; payments: number; failed: number; invoiced: number }>;
  refunds: unknown[];
}
export type ConsoleBillingSheet = 'subscriptions' | 'invoices' | 'payments' | 'months';

export type LogLevel = 'error' | 'warn' | 'info';
export interface ConsoleLogRow {
  id: number;
  at: string;
  service: string;
  level: LogLevel;
  kind: string;
  event: string | null;
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  companyId: string | null;
  companyCode: string | null;
  userId: string | null;
  count: number;
  version: string | null;
}
export interface ConsoleLogFilters {
  service?: string;
  level?: LogLevel | '';
  /** Company id or code. */
  company?: string;
  /** ISO date-times. */
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}
export interface ConsoleLogPage {
  total: number;
  page: number;
  pageSize: number;
  services: string[];
  retentionDays: number;
  rows: ConsoleLogRow[];
}

// ─── API + hooks ────────────────────────────────────────────────────────────

const clean = (q: Record<string, string | number | undefined>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const consoleDashboardKeys = {
  all: ['console'] as const,
  overview: ['console', 'overview'] as const,
  health: ['console', 'health'] as const,
  companies: ['console', 'dashboard', 'companies'] as const,
  company: (id: string) => ['console', 'dashboard', 'company', id] as const,
  users: (q: string, page: number) => ['console', 'users', q, page] as const,
  user: (kind: string, id: string) => ['console', 'user', kind, id] as const,
  billing: ['console', 'billing'] as const,
  logs: (f: ConsoleLogFilters) => ['console', 'logs', f.service ?? '', f.level ?? '', f.company ?? '', f.from ?? '', f.to ?? '', f.q ?? '', f.page ?? 1, f.pageSize ?? 50] as const,
};

export const consoleDashboardApi = {
  overview: () => platformApi.get<ConsoleOverview>('/console/overview'),
  health: () => platformApi.get<ConsoleHealth>('/console/health'),
  companies: () => platformApi.get<DashboardCompany[]>('/console/dashboard/companies'),
  company: (id: string) => platformApi.get<DashboardCompanyDetail>(`/console/dashboard/companies/${encodeURIComponent(id)}`),
  users: (q: string, page: number) => platformApi.get<ConsoleUsersPage>('/console/users', clean({ q, page, pageSize: 50 })),
  user: (kind: 'account' | 'login', id: string) => platformApi.get<ConsoleUserDetail>(`/console/users/${kind}/${encodeURIComponent(id)}`),
  billing: () => platformApi.get<ConsoleBilling>('/console/billing'),
  logs: (f: ConsoleLogFilters) =>
    platformApi.get<ConsoleLogPage>('/console/logs', clean({ service: f.service, level: f.level, company: f.company, from: f.from, to: f.to, q: f.q, page: f.page ?? 1, pageSize: f.pageSize ?? 50 })),
};

export function useConsoleOverview(enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.overview, queryFn: consoleDashboardApi.overview, enabled, refetchInterval: enabled ? 60_000 : false });
}
/** Each service up / down, version, the Tasks worker's last pass (every 30 s while the screen is open). */
export function useConsoleHealth(enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.health, queryFn: consoleDashboardApi.health, enabled, refetchInterval: enabled ? 30_000 : false });
}
export function useDashboardCompanies(enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.companies, queryFn: consoleDashboardApi.companies, enabled });
}
/** One company's people, subscription, invoices, payments, plan changes and staff actions (the view is audited). */
export function useDashboardCompany(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.company(id ?? ''), queryFn: () => consoleDashboardApi.company(id!), enabled: enabled && !!id, retry: false });
}
export function useConsoleUsers(q: string, page: number, enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.users(q, page), queryFn: () => consoleDashboardApi.users(q, page), enabled, placeholderData: keepPreviousData });
}
export function useConsoleUser(kind: 'account' | 'login' | undefined, id: string | undefined, enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.user(kind ?? '', id ?? ''), queryFn: () => consoleDashboardApi.user(kind!, id!), enabled: enabled && !!kind && !!id, retry: false });
}
export function useConsoleBilling(enabled = true) {
  return useQuery({ queryKey: consoleDashboardKeys.billing, queryFn: consoleDashboardApi.billing, enabled });
}
/** The production log, newest first; `autoRefresh` reloads it every 15 s. */
export function useConsoleLogs(filters: ConsoleLogFilters, enabled = true, autoRefresh = false) {
  return useQuery({
    queryKey: consoleDashboardKeys.logs(filters),
    queryFn: () => consoleDashboardApi.logs(filters),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: enabled && autoRefresh ? 15_000 : false,
  });
}

/** Downloads (PLAN.md §19.31): every matching row from the server, same filters as the screen. */
export const consoleExports = {
  users: (q: string): ExportTarget => ({ api: 'platform', path: '/console/users', query: { q: q || undefined } }),
  billing: (sheet: ConsoleBillingSheet): ExportTarget => ({ api: 'platform', path: '/console/billing', query: { sheet } }),
  logs: (f: ConsoleLogFilters): ExportTarget => ({ api: 'platform', path: '/console/logs', query: clean({ service: f.service, level: f.level, company: f.company, from: f.from, to: f.to, q: f.q }) }),
};
