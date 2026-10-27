/** The plan picker's live total (PLAN.md §24.1): per user per month × users, GST on top. Paise throughout. */
import type { BillingModuleKey, BillingPricing } from './types';

export interface PlanChoice {
  /** Complete (every module) instead of the picked ones. */
  complete: boolean;
  modules: BillingModuleKey[];
  ai: boolean;
  users: number;
}

export interface PlanQuote {
  /** Per user per month (paise). */
  perUser: number;
  /** Before GST (paise). */
  monthly: number;
  gst: number;
  /** With GST (paise). The payment page shows the exact CGST + SGST or IGST split. */
  total: number;
  /** The picked modules cost more than Complete would. */
  completeIsCheaper: boolean;
}

export function quotePlan(p: BillingPricing, c: PlanChoice): PlanQuote {
  const users = Math.max(0, Math.floor(c.users || 0));
  const picked = p.modules.filter((m) => c.modules.includes(m.key));
  const modulesPrice = picked.reduce((sum, m) => sum + (c.ai ? m.aiPrice : m.price), 0);
  const completePrice = c.ai ? p.complete.aiPrice : p.complete.price;
  const perUser = c.complete ? completePrice : modulesPrice;
  const monthly = perUser * users;
  const gst = Math.round((monthly * p.gstPercent) / 100);
  return { perUser, monthly, gst, total: monthly + gst, completeIsCheaper: !c.complete && modulesPrice > completePrice };
}

/** "Tasks + Attendance with AI", "Complete". */
export function choiceName(p: BillingPricing, c: Pick<PlanChoice, 'complete' | 'modules' | 'ai'>): string {
  const name = c.complete
    ? p.complete.name
    : p.modules
        .filter((m) => c.modules.includes(m.key))
        .map((m) => m.name)
        .join(' + ') || 'No module';
  return c.ai ? `${name} with AI` : name;
}
