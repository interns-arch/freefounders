/**
 * Cashfree.js v3 (PLAN.md §21.10; https://www.cashfree.com/docs/payments/online/web/redirect):
 * https://sdk.cashfree.com/js/v3/cashfree.js is loaded only on the payment step (/billing/pay/:id), never on other
 * screens. The gateway CSP allows sdk.cashfree.com and Cashfree's pages for it (infra/deploy/Caddyfile,
 * infra/gateway/Caddyfile). The payment always opens in the same window (redirectTarget '_self'): it works the same in a
 * browser and in the Android app's WebView, and Cashfree sends the person back to our return URL, where the page asks
 * the server what Cashfree says (never trusting the redirect itself).
 */
import type { CashfreeCheckoutOptions } from '@freefounders/core/billing';

const SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

interface CashfreeResult {
  error?: { message?: string };
  redirect?: boolean;
  paymentDetails?: { paymentMessage?: string };
}

interface CashfreeInstance {
  checkout(options: { paymentSessionId: string; redirectTarget: '_self' | '_blank' | '_top' | '_modal' }): Promise<CashfreeResult>;
}

type CashfreeFactory = (options: { mode: 'production' | 'sandbox' }) => CashfreeInstance;

declare global {
  interface Window {
    Cashfree?: CashfreeFactory;
  }
}

let loading: Promise<CashfreeFactory> | null = null;

/** Loads cashfree.js once (a failed load can be tried again). */
export function loadCashfree(): Promise<CashfreeFactory> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (loading) return loading;
  loading = new Promise<CashfreeFactory>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree did not start.')));
    s.onerror = () => {
      s.remove();
      reject(new Error('Cashfree could not be loaded. Check the internet connection and try again.'));
    };
    document.head.appendChild(s);
  }).catch((err: Error) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Opens Cashfree's payment page in this window; resolves only if it could not open (an error message). */
export async function openCashfree(o: CashfreeCheckoutOptions): Promise<string | null> {
  const Cashfree = await loadCashfree();
  const result = await Cashfree({ mode: o.mode }).checkout({ paymentSessionId: o.paymentSessionId, redirectTarget: '_self' });
  return result?.error?.message ?? null;
}
