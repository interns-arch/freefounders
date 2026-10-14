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
}

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
}

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

/** GET console/summary (FreeFounders staff). */
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
