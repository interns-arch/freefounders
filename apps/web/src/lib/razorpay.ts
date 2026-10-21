/**
 * Razorpay Checkout (PLAN.md §21.4): https://checkout.razorpay.com/v1/checkout.js is loaded only on the payment step
 * (/billing/pay/:id), never on other screens. The gateway CSP allows checkout.razorpay.com / *.razorpay.com for it
 * (infra/deploy/Caddyfile, infra/gateway/Caddyfile).
 */
import type { RazorpayCheckoutOptions, RazorpayHandlerResponse } from '@freefounders/core/billing';

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayFailure {
  error?: { code?: string; description?: string; reason?: string; source?: string; step?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', fn: (r: RazorpayFailure) => void): void;
}

type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;

/** Loads checkout.js once (a failed load can be tried again). */
export function loadRazorpay(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not start.')));
    s.onerror = () => {
      s.remove();
      reject(new Error('Razorpay could not be loaded. Check the internet connection and try again.'));
    };
    document.head.appendChild(s);
  }).catch((err: Error) => {
    loading = null;
    throw err;
  });
  return loading;
}

export interface OpenCheckoutHandlers {
  onPaid: (r: RazorpayHandlerResponse) => void;
  onFailed: (message: string) => void;
  onDismiss: () => void;
}

/**
 * Opens Razorpay Checkout for a subscription. In the browser: a modal and the success handler. In the phone app
 * (`redirect`): Razorpay's pages load in the app and post the result to our callback, which shows the payment page
 * again (UPI apps open outside the app; apps/mobile handles upi:// and intent://).
 */
export async function openRazorpay(o: RazorpayCheckoutOptions, h: OpenCheckoutHandlers, opts: { redirect?: boolean } = {}) {
  const Razorpay = await loadRazorpay();
  const rzp = new Razorpay({
    key: o.keyId,
    subscription_id: o.subscriptionId,
    name: o.name,
    description: o.description,
    prefill: o.prefill,
    notes: o.notes,
    ...(opts.redirect ? { redirect: true, callback_url: new URL(o.callbackPath, window.location.origin).toString() } : { handler: h.onPaid }),
    modal: { ondismiss: h.onDismiss, confirm_close: true },
  });
  rzp.on('payment.failed', (r) => h.onFailed(r.error?.description || 'The payment did not go through.'));
  rzp.open();
}
