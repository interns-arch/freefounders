/** Money, GST and plan helpers for the billing screens (pure: no DOM, no requests). */
import type { SubscriptionState } from '../access';
import type { BillingInterval, Plan } from './types';

/** ₹ with Indian grouping (₹1,49,000). Whole rupees without decimals unless `decimals` (invoices: always 2). */
export function formatInr(paise: number | null | undefined, decimals?: boolean): string {
  const p = Math.round(paise ?? 0);
  const showPaise = decimals ?? p % 100 !== 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: showPaise ? 2 : 0, maximumFractionDigits: showPaise ? 2 : 0 }).format(p / 100);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}
/** Whole number in Indian words (crore, lakh, thousand). */
export function numberInWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
/** "Rupees One Thousand Seven Hundred Fifty Eight and Forty Paise Only" (invoice total in words). */
export function inrInWords(paise: number): string {
  const p = Math.round(Math.abs(paise));
  const rupees = Math.floor(p / 100);
  const rest = p % 100;
  return `Rupees ${numberInWords(rupees)}${rest ? ` and ${below100(rest)} Paise` : ''} Only`;
}

/** GSTIN format: 2-digit state code, PAN (5 letters, 4 digits, letter), entity number, Z, check character. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isGstin = (v: string) => GSTIN_RE.test(v.trim().toUpperCase());

/** States and union territories with their GST state codes (place of supply). */
export const INDIAN_STATES: Array<{ name: string; code: string }> = [
  { name: 'Andaman and Nicobar Islands', code: '35' },
  { name: 'Andhra Pradesh', code: '37' },
  { name: 'Arunachal Pradesh', code: '12' },
  { name: 'Assam', code: '18' },
  { name: 'Bihar', code: '10' },
  { name: 'Chandigarh', code: '04' },
  { name: 'Chhattisgarh', code: '22' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: '26' },
  { name: 'Delhi', code: '07' },
  { name: 'Goa', code: '30' },
  { name: 'Gujarat', code: '24' },
  { name: 'Haryana', code: '06' },
  { name: 'Himachal Pradesh', code: '02' },
  { name: 'Jammu and Kashmir', code: '01' },
  { name: 'Jharkhand', code: '20' },
  { name: 'Karnataka', code: '29' },
  { name: 'Kerala', code: '32' },
  { name: 'Ladakh', code: '38' },
  { name: 'Lakshadweep', code: '31' },
  { name: 'Madhya Pradesh', code: '23' },
  { name: 'Maharashtra', code: '27' },
  { name: 'Manipur', code: '14' },
  { name: 'Meghalaya', code: '17' },
  { name: 'Mizoram', code: '15' },
  { name: 'Nagaland', code: '13' },
  { name: 'Odisha', code: '21' },
  { name: 'Puducherry', code: '34' },
  { name: 'Punjab', code: '03' },
  { name: 'Rajasthan', code: '08' },
  { name: 'Sikkim', code: '11' },
  { name: 'Tamil Nadu', code: '33' },
  { name: 'Telangana', code: '36' },
  { name: 'Tripura', code: '16' },
  { name: 'Uttar Pradesh', code: '09' },
  { name: 'Uttarakhand', code: '05' },
  { name: 'West Bengal', code: '19' },
];

/** The GSTIN's first two digits must be the state's code. */
export function gstinMatchesState(gstin: string, state: string): boolean {
  const s = INDIAN_STATES.find((x) => x.name === state);
  return !s || gstin.trim().slice(0, 2) === s.code;
}

export const GST_RATE = 18;

/** Price per user (paise) of a plan for an interval, whatever field the server used. Yearly falls back to 10 × monthly. */
export function planPrice(plan: Plan, interval: BillingInterval): number {
  const v = plan.prices?.[interval] ?? plan.pricePerSeat?.[interval] ?? (interval === 'month' ? (plan.priceMonthly ?? plan.monthly) : (plan.priceYearly ?? plan.yearly));
  if (typeof v === 'number') return v;
  if (interval === 'year') {
    const m = plan.prices?.month ?? plan.pricePerSeat?.month ?? plan.priceMonthly ?? plan.monthly;
    if (typeof m === 'number') return m * 10;
  }
  return 0;
}
export const isPaidPlan = (plan: Plan) => planPrice(plan, 'month') > 0 || planPrice(plan, 'year') > 0;
/** Paid plans have a minimum of 5 seats unless the plan says otherwise. */
export const planMinSeats = (plan: Plan) => plan.minSeats ?? (isPaidPlan(plan) ? 5 : 1);
/** Free: up to 3 users unless the plan data says otherwise. */
export const planMaxSeats = (plan: Plan): number | null => (plan.maxSeats !== undefined ? plan.maxSeats : plan.key === 'free' ? 3 : null);

export const STATE_LABELS: Record<SubscriptionState, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment failed',
  read_only: 'Read-only',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export const INTERVAL_LABELS: Record<BillingInterval, string> = { month: 'Monthly', year: 'Yearly' };

/** "Free", "Suite"… from a plan key. */
export const planLabel = (key: string | null | undefined, plans?: Plan[]) =>
  plans?.find((p) => p.key === key)?.name ?? (key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ') : '—');

/** Whole days from `now` to `iso` (never negative). */
export function daysUntil(iso: string | null | undefined, now: string | number | Date = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - new Date(now).getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
