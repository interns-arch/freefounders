/**
 * Public prices for the landing page (PLAN.md §24, §24.2): GET /api/platform/public/pricing (no sign-in). Until the
 * Platform answers (or when it is down), the §24 prices are used, so the calculator always works.
 */
import { useQuery } from '@tanstack/react-query';
import { platformApi } from './http';

export type PricedModuleKey = 'tasks' | 'attendance' | 'assets';

export interface PublicPricing {
  currency: 'INR';
  perUserMonth: boolean;
  gstPercent: number;
  modules: { key: PricedModuleKey; name: string; price: number; aiPrice: number }[];
  complete: { price: number; aiPrice: number; includes: string[] };
  trial: { days: number; maxUsers: number };
  /** The Calendly event link for "Book a demo"; null = not set (the button falls back to email). */
  calendlyUrl: string | null;
  aiHelper: boolean;
}

/** The founder's prices of 2026-10-27 (PLAN.md §24), per user per month, GST on top. */
export const FALLBACK_PRICING: PublicPricing = {
  currency: 'INR',
  perUserMonth: true,
  gstPercent: 18,
  modules: [
    { key: 'tasks', name: 'Tasks', price: 99, aiPrice: 129 },
    { key: 'attendance', name: 'Attendance', price: 99, aiPrice: 129 },
    { key: 'assets', name: 'Assets', price: 99, aiPrice: 129 },
  ],
  complete: { price: 349, aiPrice: 449, includes: ['Tasks', 'Attendance', 'Assets', 'Visitors', 'Payroll'] },
  trial: { days: 10, maxUsers: 3 },
  calendlyUrl: null,
  aiHelper: false,
};

export interface PriceChoice {
  /** All modules (Complete) instead of the picked ones. */
  complete: boolean;
  modules: PricedModuleKey[];
  ai: boolean;
  users: number;
}

export interface PriceQuote {
  perUser: number;
  /** Before GST. */
  monthly: number;
  gst: number;
  /** With GST. */
  total: number;
}

/** Monthly price for a choice: per-user price × users, GST on top (rounded to the paisa, as on the invoice). */
export function quotePrice(p: PublicPricing, c: PriceChoice): PriceQuote {
  const users = Math.max(0, Math.floor(c.users || 0));
  const perUser = c.complete
    ? c.ai
      ? p.complete.aiPrice
      : p.complete.price
    : p.modules.filter((m) => c.modules.includes(m.key)).reduce((sum, m) => sum + (c.ai ? m.aiPrice : m.price), 0);
  const monthly = perUser * users;
  const gst = Math.round(monthly * p.gstPercent) / 100;
  return { perUser, monthly, gst, total: Math.round((monthly + gst) * 100) / 100 };
}

/** The endpoint's answer, or the built-in prices while it loads / if it is not there. */
export function usePublicPricing(): { pricing: PublicPricing; live: boolean; isLoading: boolean } {
  const q = useQuery({
    queryKey: ['platform', 'public-pricing'],
    queryFn: () => platformApi.get<PublicPricing>('/public/pricing'),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const ok = !!q.data && Array.isArray(q.data.modules) && !!q.data.complete && !!q.data.trial;
  return { pricing: ok ? { ...FALLBACK_PRICING, ...q.data } : FALLBACK_PRICING, live: ok, isLoading: q.isLoading };
}
