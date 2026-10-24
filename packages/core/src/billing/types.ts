/** Billing: plans, subscription, checkout, GST invoices, owner console (PLAN.md §21.2). Amounts are integers in paise. */
import type { SubscriptionState } from '../access';
import type { AppKey } from '../session';

export type { SubscriptionState };

/** Billing period of a paid plan. */
export type BillingInterval = 'month' | 'year';

/** A line of an order, a next charge or an invoice. */
export interface BillingLine {
  description: string;
  quantity?: number;
  /** Price of one (paise). */
  unitPrice?: number;
  /** quantity × unitPrice (paise). */
  amount: number;
  /** HSN / SAC code of the service, when the server sends it per line. */
  sac?: string;
  hsn?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
}

/** GST details of the buyer (PUT billing/profile). */
export interface BillingProfile {
  legalName: string;
  gstin: string | null;
  state: string;
  address: string;
  email: string;
}

export interface NextCharge {
  date: string;
  lines: BillingLine[];
  subtotal: number;
  tax: number;
  total: number;
}

/** GET billing. */
export interface BillingSummary {
  plan: string;
  planName?: string;
  /** Null on Free / Complimentary. */
  interval: BillingInterval | null;
  state: SubscriptionState;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seats: { used: number; paid: number; limit: number | null };
  nextCharge: NextCharge | null;
  profile: BillingProfile | null;
  /** BILLING_DEV_TOOLS=1: advance the billing clock, simulate renewals. */
  devTools: boolean;
  /** The billing clock (moved by the dev tools). */
  now: string;
  /** Who took the last payment (PLAN.md §21.10). */
  gateway?: PaymentGatewayName;
  /** The gateway new payments use; null = payments are not set up on this server yet. */
  checkoutGateway?: PaymentGatewayName | null;
  canResume?: boolean;
  /** Cashfree: nothing renews by itself; the owner pays each period on the Billing page (past due until then). */
  paysEachPeriod?: boolean;
}

export type PaymentGatewayName = 'fake' | 'cashfree';

/** GET billing/plans. Business data on the server (§21), so the screen reads whatever plans it lists. */
export interface Plan {
  /** "free" | "tasks" | "assets" | "suite" | "complimentary"… (the server's `code`; `billingApi.plans` fills `key`). */
  key: string;
  code?: string;
  name: string;
  description?: string | null;
  apps: AppKey[];
  /** Price per user (paise) for each interval. Free plans: 0 or missing. */
  prices?: Partial<Record<BillingInterval, number>>;
  pricePerSeat?: Partial<Record<BillingInterval, number>>;
  priceMonthly?: number;
  priceYearly?: number;
  monthly?: number;
  yearly?: number;
  minSeats?: number;
  maxSeats?: number | null;
  /** False for plans only staff can give (Complimentary). */
  public?: boolean;
  selfServe?: boolean;
}

export interface CheckoutInput {
  plan: string;
  interval: BillingInterval;
  seats: number;
}

export interface CheckoutStarted {
  sessionId: string;
  checkoutUrl: string;
  gateway?: PaymentGatewayName;
}

/** What Cashfree.js needs (GET billing/checkout/:id while a Cashfree checkout is open). Never logged. */
export interface CashfreeCheckoutOptions {
  /** payment_session_id of the Cashfree order (the Secret Key never leaves the server). */
  paymentSessionId: string;
  /** Cashfree.js mode. */
  mode: 'production' | 'sandbox';
  orderId?: string | null;
}

/** POST billing/cashfree/check: what happened to the latest attempt at Cashfree. */
export type CashfreeAttempt = 'paid' | 'failed' | 'pending' | 'expired';

export type CheckoutStatus = 'open' | 'pending' | 'paid' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | string;

/** GET billing/checkout/:id: what the payment page shows. */
export interface CheckoutSession {
  plan: string;
  planName?: string;
  interval: BillingInterval;
  seats: number;
  lines: BillingLine[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  companyName: string;
  status: CheckoutStatus;
  gateway?: PaymentGatewayName;
  /** null: the order has no payment session (try again from Billing). */
  cashfree?: CashfreeCheckoutOptions | null;
  /** Only from POST billing/cashfree/check. */
  attempt?: CashfreeAttempt;
}

export type FakeOutcome = 'success' | 'failure' | 'cancel';

export interface FakeResult {
  status?: CheckoutStatus;
  state?: SubscriptionState;
  invoiceId?: string | null;
  message?: string;
}

export interface Party {
  name?: string;
  legalName?: string;
  gstin?: string | null;
  address?: string | null;
  state?: string | null;
  stateCode?: string | null;
  email?: string | null;
  pan?: string | null;
}

/** GET billing/invoices: one row. */
export interface InvoiceSummary {
  id: string;
  number: string;
  date?: string;
  issuedAt?: string;
  total: number;
  status?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
}

/** GET billing/invoices/:id: every field of a GST tax invoice. */
export interface Invoice extends InvoiceSummary {
  seller: Party;
  buyer: Party;
  placeOfSupply?: string | null;
  sac?: string | null;
  hsnSac?: string | null;
  lines: BillingLine[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** GST rates in per cent, when sent (default 9 + 9 or 18). */
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  totalInWords?: string | null;
  reverseCharge?: boolean;
  notes?: string | null;
}

/** GET console/summary (Kaampilot staff). */
export interface ConsoleSummary {
  mrr: number;
  /** Paid and active (the server may call it `active`). */
  activePaid?: number;
  active?: number;
  trialing: number;
  pastDue: number;
  readOnly: number;
  suspended: number;
  companies: number;
}

/** GET console/companies: one row. */
export interface ConsoleCompany {
  id: string;
  name: string;
  code?: string;
  owner?: string | null;
  plan: string;
  planName?: string;
  state: SubscriptionState;
  seats: number | { used: number; paid: number; limit?: number | null };
  mrr: number;
  trialEndsAt: string | null;
  createdAt: string;
}

/** POST billing/free: the Billing view plus when Free starts (PLAN.md §21.7). */
export type SwitchToFreeResult = BillingSummary & { freeFrom: 'now' | 'period_end' };

/** Owner console actions written to the staff audit log (PLAN.md §21.7). */
export type ConsoleAuditAction = 'trial.extend' | 'plan.set' | 'company.suspend' | 'company.reactivate' | 'view.company' | 'view.user' | 'view.users' | 'view.billing' | 'view.logs';

/** GET console/audit: one staff action. */
export interface ConsoleAuditRow {
  id: string;
  at: string;
  staffAccountId: string | null;
  staffEmail: string | null;
  action: ConsoleAuditAction | string;
  companyId: string | null;
  companyCode: string | null;
  companyName: string | null;
  /** `{input, before, after}`: what was asked and the company's plan before and after. */
  details: { input?: Record<string, unknown>; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } & Record<string, unknown>;
  ip: string | null;
}

export interface ConsoleAuditFilters {
  /** Company id or code. */
  company?: string;
  action?: ConsoleAuditAction | '';
  page?: number;
  pageSize?: number;
}

export interface ConsoleAuditPage {
  total: number;
  page: number;
  pageSize: number;
  actions: ConsoleAuditAction[];
  rows: ConsoleAuditRow[];
}
