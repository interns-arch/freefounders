import { BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Who pays (Cashfree needs a customer id and a phone number on every order). */
export interface CheckoutCustomer {
  /** Our account id (Cashfree customer_id). */
  id: string;
  name?: string | null;
  email?: string | null;
  /** Mobile number as stored on the account (+91…), if any. */
  phone?: string | null;
}

/** What the gateway's checkout page needs. */
export interface CheckoutRequest {
  sessionId: string;
  companyId: string;
  /** paise, GST included */
  amount: number;
  description: string;
  /** The checkout link stops working after this. */
  expiresAt: Date;
  customer?: CheckoutCustomer;
}

export interface CheckoutCreated {
  checkoutUrl: string;
  /** The gateway's object for this checkout (Cashfree: our order_id). */
  ref?: string;
  data?: Record<string, unknown>;
}

export type GatewayEventType =
  | 'payment.captured'
  | 'payment.failed'
  | 'checkout.cancelled'
  /** Stored once, nothing to do (a test event, charges, an event type we do not use). */
  | 'ignored';

/** A gateway webhook (after its signature was checked) or a payment status the server looked up itself. */
export interface GatewayEvent {
  /** Stored once (a repeated delivery is ignored). Cashfree: one id per payment and outcome, webhook or status check. */
  id: string;
  type: GatewayEventType;
  /** Our checkout session ('' when the event does not name one). */
  sessionId: string;
  paymentId?: string;
  /** paise */
  amount?: number;
  reason?: string;
  /** The gateway's original event name (e.g. "PAYMENT_SUCCESS_WEBHOOK", "order.status"). */
  source?: string;
  /** Cashfree: a payment event we could not read in full; the service looks the order up at the gateway. */
  check?: boolean;
}

/** A renewal charged on a saved card (FakePay only: Cashfree renewals are paid by the owner on the Billing page). */
export interface RenewalCharge {
  companyId: string;
  amount: number;
  /** Fake gateway only (dev tools): force the result. */
  outcome?: 'success' | 'failure';
}

export interface RenewalResult {
  ok: boolean;
  paymentId: string;
  reason?: string;
}

/**
 * The payment gateway (PLAN.md §20.6/§21/§21.10): `FakeGateway` (dev, open demo) or `CashfreeGateway`, chosen by
 * PAYMENT_GATEWAY. Both end in the same events and the same subscription states. The apps never deal with money: the
 * Platform turns paid plans into module switches.
 */
export interface PaymentGateway {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutCreated>;
  /** Checks the signature over the raw body and returns the event; throws on a bad signature. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
}

export const FAKE_SIGNATURE_HEADER = 'x-fakepay-signature';

/**
 * HMAC secret of the fake gateway: FAKE_GATEWAY_SECRET (dev default in scripts/dev.mjs; none in production).
 * A production build uses it only on an open demo server (DEMO_MODE=1), so a stray secret cannot switch FakePay on.
 */
function fakeSecret(): string | null {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== '1') return null;
  const s = process.env.FAKE_GATEWAY_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

export const signFake = (rawBody: Buffer | string, secret = fakeSecret()) => {
  if (!secret) throw new BadRequestException('The test payment gateway is not configured (FAKE_GATEWAY_SECRET)');
  return createHmac('sha256', secret).update(rawBody).digest('hex');
};

/** Constant-time compare of two hex signatures (false for anything that is not the same length of hex). */
export function sameHex(want: string, given: string): boolean {
  if (!/^[0-9a-f]+$/i.test(given) || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(given.toLowerCase(), 'hex'));
}

const FAKE_TYPES: GatewayEventType[] = ['payment.captured', 'payment.failed', 'checkout.cancelled'];

/**
 * "FakePay · test mode": the checkout page is the web app's `/billing/pay/<session>`; Pay / Fail / Cancel there make
 * the Platform post itself a webhook signed with FAKE_GATEWAY_SECRET, checked like Cashfree's is. Renewals succeed
 * unless the dev tools ask for a failure.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';

  async createCheckout(req: CheckoutRequest): Promise<CheckoutCreated> {
    return { checkoutUrl: `/billing/pay/${req.sessionId}` };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent {
    const secret = fakeSecret();
    const given = String(headers[FAKE_SIGNATURE_HEADER] ?? '');
    if (!secret || !/^[0-9a-f]{64}$/.test(given)) throw new BadRequestException('Invalid signature');
    if (!sameHex(signFake(rawBody, secret), given)) throw new BadRequestException('Invalid signature');
    let event: GatewayEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
    } catch {
      throw new BadRequestException('Invalid event');
    }
    if (typeof event?.id !== 'string' || !FAKE_TYPES.includes(event.type) || typeof event.sessionId !== 'string') {
      throw new BadRequestException('Invalid event');
    }
    return event;
  }

  async chargeRenewal(charge: RenewalCharge): Promise<RenewalResult> {
    // Test payments are off (production without DEMO_MODE): a fake renewal is never "paid".
    const ok = !!fakeSecret() && charge.outcome !== 'failure';
    return { ok, paymentId: `fakepay_${randomBytes(8).toString('hex')}`, ...(ok ? {} : { reason: fakeSecret() ? 'Card declined (test)' : 'Test payments are off' }) };
  }
}

// ─── which gateway (env, checked at start-up) ────────────────────────────────

export type GatewayName = 'fake' | 'cashfree';

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  env: 'production' | 'sandbox';
  apiVersion: string;
}

export interface GatewayConfig {
  /** The gateway new checkouts use; null = checkout answers 503 "Payments are not set up yet". */
  name: GatewayName | null;
  /** Why checkout is off (for the log; never contains a secret value). */
  problem: string | null;
  cashfree?: CashfreeConfig;
}

export const PAYMENTS_OFF_MESSAGE = 'Payments are not set up yet. Please try again later or contact Kaampilot support.';
/** Cashfree's current documented API version (https://www.cashfree.com/docs/api-reference/payments/latest/orders/create). */
export const CASHFREE_API_VERSION = '2026-01-01';

/**
 * PAYMENT_GATEWAY=fake|cashfree (BILLING_GATEWAY, its older name, is still read when PAYMENT_GATEWAY is not set).
 * Default: fake in dev and on the open demo (DEMO_MODE=1); a production build without DEMO_MODE must say cashfree and
 * have CASHFREE_APP_ID and CASHFREE_SECRET_KEY, or checkout stays off (503) while the rest of the app runs.
 * "razorpay" (removed on 2026-10-24, PLAN.md §21.10) is treated as not set up: logged, never a crash.
 */
export function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const named = (env.PAYMENT_GATEWAY ?? '').trim() ? 'PAYMENT_GATEWAY' : 'BILLING_GATEWAY';
  const raw = (env[named] ?? '').trim().toLowerCase();
  const production = env.NODE_ENV === 'production' && env.DEMO_MODE !== '1';
  if (raw === 'cashfree') {
    const appId = (env.CASHFREE_APP_ID ?? '').trim();
    const secretKey = (env.CASHFREE_SECRET_KEY ?? '').trim();
    const missing = [!appId && 'CASHFREE_APP_ID', !secretKey && 'CASHFREE_SECRET_KEY'].filter(Boolean);
    if (missing.length) return { name: null, problem: `${named}=cashfree but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set` };
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(appId)) return { name: null, problem: 'CASHFREE_APP_ID does not look like a Cashfree App ID (letters and digits)' };
    const e = (env.CASHFREE_ENV ?? '').trim().toLowerCase() || 'sandbox';
    if (e !== 'production' && e !== 'sandbox') return { name: null, problem: `CASHFREE_ENV="${e}" is not known (use production or sandbox)` };
    const apiVersion = (env.CASHFREE_API_VERSION ?? '').trim() || CASHFREE_API_VERSION;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) return { name: null, problem: 'CASHFREE_API_VERSION must look like 2026-01-01' };
    return { name: 'cashfree', problem: null, cashfree: { appId, secretKey, env: e, apiVersion } };
  }
  if (raw === 'razorpay') return { name: null, problem: `${named}=razorpay: Razorpay was removed (PLAN.md §21.10); switch to Cashfree with infra/deploy/set-cashfree.sh` };
  if (raw === '' || raw === 'fake') {
    if (production) return { name: null, problem: 'production needs PAYMENT_GATEWAY=cashfree with its keys (FakePay is for dev and the open demo only)' };
    return { name: 'fake', problem: null };
  }
  return { name: null, problem: `${named}="${raw}" is not known (use fake or cashfree)` };
}
