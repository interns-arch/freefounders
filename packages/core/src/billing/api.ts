/** Billing, fake gateway and owner console (Platform /api/platform, PLAN.md §21.2). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClaims } from '../access';
import { platformApi } from '../http';
import { session } from '../session';
import type {
  BillingProfile,
  BillingSummary,
  CheckoutInput,
  CheckoutSession,
  CheckoutStarted,
  ConsoleAuditFilters,
  ConsoleAuditPage,
  ConsoleCompany,
  ConsoleSummary,
  FakeOutcome,
  FakeResult,
  Invoice,
  InvoiceSummary,
  Plan,
  SwitchToFreeResult,
} from './types';

export const billingKeys = {
  all: ['billing'] as const,
  summary: (cid?: string) => ['billing', 'summary', cid ?? null] as const,
  plans: ['billing', 'plans'] as const,
  checkout: (id: string) => ['billing', 'checkout', id] as const,
  invoices: (cid?: string) => ['billing', 'invoices', cid ?? null] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  console: ['console'] as const,
  consoleSummary: ['console', 'summary'] as const,
  consoleCompanies: ['console', 'companies'] as const,
  consoleAudit: (f: ConsoleAuditFilters) => ['console', 'audit', f.company ?? '', f.action ?? '', f.page ?? 1, f.pageSize ?? 25] as const,
};

export const billingApi = {
  summary: () => platformApi.get<BillingSummary>('/billing'),
  plans: () => platformApi.get<Plan[]>('/billing/plans').then((rows) => rows.map((p) => ({ ...p, key: p.key ?? p.code ?? '' }))),
  saveProfile: (body: BillingProfile) => platformApi.put<BillingProfile>('/billing/profile', body),
  checkout: (body: CheckoutInput) => platformApi.post<CheckoutStarted>('/billing/checkout', body),
  checkoutSession: (id: string) => platformApi.get<CheckoutSession>(`/billing/checkout/${encodeURIComponent(id)}`),
  fakeComplete: (id: string, outcome: FakeOutcome) => platformApi.post<FakeResult>(`/billing/fake/${encodeURIComponent(id)}/complete`, { outcome }),
  cashfreeCheck: (sessionId: string) => platformApi.post<CheckoutSession>('/billing/cashfree/check', { sessionId }),
  setSeats: (seats: number) => platformApi.post<unknown>('/billing/seats', { seats }),
  cancel: () => platformApi.post<unknown>('/billing/cancel'),
  resume: () => platformApi.post<unknown>('/billing/resume'),
  /** The Free plan without payment (now, or at the end of a paid period); 400 with what to switch off when it does not fit. */
  switchToFree: () => platformApi.post<SwitchToFreeResult>('/billing/free'),
  invoices: () => platformApi.get<InvoiceSummary[]>('/billing/invoices'),
  invoice: (id: string) => platformApi.get<Invoice>(`/billing/invoices/${encodeURIComponent(id)}`),
  devAdvance: (days: number) => platformApi.post<unknown>('/billing/dev/advance', { days }),
  devRenew: (outcome: 'success' | 'failure') => platformApi.post<unknown>('/billing/dev/renew', { outcome }),

  consoleSummary: () => platformApi.get<ConsoleSummary>('/console/summary'),
  consoleCompanies: () => platformApi.get<ConsoleCompany[]>('/console/companies'),
  consoleAudit: (f: ConsoleAuditFilters) => {
    const q = new URLSearchParams();
    if (f.company) q.set('company', f.company);
    if (f.action) q.set('action', f.action);
    q.set('page', String(f.page ?? 1));
    q.set('pageSize', String(f.pageSize ?? 25));
    return platformApi.get<ConsoleAuditPage>(`/console/audit?${q.toString()}`);
  },
  consoleTrial: (id: string, days: number) => platformApi.post<unknown>(`/console/companies/${encodeURIComponent(id)}/trial`, { days }),
  consolePlan: (id: string, plan: string, seats: number) => platformApi.post<unknown>(`/console/companies/${encodeURIComponent(id)}/plan`, { plan, seats }),
  consoleStatus: (id: string, status: string) => platformApi.post<unknown>(`/console/companies/${encodeURIComponent(id)}/status`, { status }),
};

/**
 * A billing change moves the subscription: reload Billing, and who-am-I (banners, read-only) — the access token
 * carries `ro`, so it is renewed too.
 */
function useAfterBillingChange() {
  const qc = useQueryClient();
  return async () => {
    await session.refresh();
    await Promise.all([qc.invalidateQueries({ queryKey: billingKeys.all }), qc.invalidateQueries({ queryKey: ['platform', 'me'] }), qc.invalidateQueries({ queryKey: billingKeys.console })]);
  };
}

// ─── queries ────────────────────────────────────────────────────────────────

/** GET billing (owner / "Manage billing"). */
export function useBilling(enabled = true) {
  const claims = useClaims();
  return useQuery({ queryKey: billingKeys.summary(claims?.cid), queryFn: billingApi.summary, enabled: enabled && !!claims, placeholderData: undefined });
}
export function usePlans() {
  return useQuery({ queryKey: billingKeys.plans, queryFn: billingApi.plans, staleTime: 5 * 60_000 });
}
/** GET billing/checkout/:id (the payment page). */
export function useCheckoutSession(id: string | undefined) {
  return useQuery({ queryKey: billingKeys.checkout(id ?? ''), queryFn: () => billingApi.checkoutSession(id!), enabled: !!id, retry: false, placeholderData: undefined });
}
export function useInvoices(enabled = true) {
  const claims = useClaims();
  return useQuery({ queryKey: billingKeys.invoices(claims?.cid), queryFn: billingApi.invoices, enabled: enabled && !!claims });
}
export function useInvoice(id: string | undefined) {
  return useQuery({ queryKey: billingKeys.invoice(id ?? ''), queryFn: () => billingApi.invoice(id!), enabled: !!id, placeholderData: undefined });
}

// ─── changes ────────────────────────────────────────────────────────────────

export function useSaveBillingProfile() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.saveProfile, onSuccess: after });
}
/** POST billing/checkout → {sessionId, checkoutUrl}: the screen then opens the payment page. */
export function useStartCheckout() {
  return useMutation({ mutationFn: billingApi.checkout });
}
/** The fake gateway's Pay / Fail / Cancel. */
export function useFakeComplete() {
  const after = useAfterBillingChange();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: FakeOutcome }) => billingApi.fakeComplete(id, outcome),
    onSuccess: async (_r, v) => {
      await qc.invalidateQueries({ queryKey: billingKeys.checkout(v.id) });
      await after();
    },
  });
}
/**
 * Back from Cashfree (or waiting): the server looks the order up at Cashfree and applies it. Answers the checkout with
 * `attempt` (paid / failed / pending / expired). The browser's redirect itself proves nothing.
 */
export function useCashfreeCheck() {
  const after = useAfterBillingChange();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => billingApi.cashfreeCheck(id),
    onSuccess: async (r, id) => {
      qc.setQueryData(billingKeys.checkout(id), r);
      if (r.attempt === 'paid') await after();
    },
  });
}
export function useSetSeats() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.setSeats, onSuccess: after });
}
export function useCancelSubscription() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.cancel, onSuccess: after });
}
/** Switch to the Free plan (no payment): `freeFrom` says whether it is now or at the end of the paid period. */
export function useSwitchToFree() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.switchToFree, onSuccess: after });
}
export function useResumeSubscription() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.resume, onSuccess: after });
}
/** Dev tools: move this company's billing clock N days (runs what falls due). */
export function useDevAdvance() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.devAdvance, onSuccess: after });
}
/** Dev tools: run the next renewal now, succeeding or failing. */
export function useDevRenew() {
  const after = useAfterBillingChange();
  return useMutation({ mutationFn: billingApi.devRenew, onSuccess: after });
}

// ─── owner console (Kaampilot staff) ─────────────────────────────────────

export function useConsoleSummary(enabled = true) {
  return useQuery({ queryKey: billingKeys.consoleSummary, queryFn: billingApi.consoleSummary, enabled });
}
export function useConsoleCompanies(enabled = true) {
  return useQuery({ queryKey: billingKeys.consoleCompanies, queryFn: billingApi.consoleCompanies, enabled });
}
/** The owner console's "Recent actions" (staff audit log), newest first. */
export function useConsoleAudit(filters: ConsoleAuditFilters, enabled = true) {
  return useQuery({ queryKey: billingKeys.consoleAudit(filters), queryFn: () => billingApi.consoleAudit(filters), enabled, placeholderData: (prev) => prev });
}
export function useConsoleAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string } & ({ kind: 'trial'; days: number } | { kind: 'plan'; plan: string; seats: number } | { kind: 'status'; status: 'suspended' | 'active' | string })) =>
      a.kind === 'trial' ? billingApi.consoleTrial(a.id, a.days) : a.kind === 'plan' ? billingApi.consolePlan(a.id, a.plan, a.seats) : billingApi.consoleStatus(a.id, a.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.console }),
  });
}
