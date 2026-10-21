import { BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A recurring plan behind a checkout (Razorpay creates a subscription for it). */
export interface CheckoutSubscription {
  planCode: string;
  planName: string;
  interval: 'month' | 'year';
  seats: number;
  /** paise per seat before GST */
  unitPrice: number;
  /** paise per seat with GST: what the gateway charges per seat at each renewal */
  unitAmount: number;
  /** When the first paid period ends = the first renewal charge. */
  firstPeriodEnd: Date;
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
  subscription?: CheckoutSubscription;
}

export interface CheckoutCreated {
  checkoutUrl: string;
  /** The gateway's object for this checkout (Razorpay: sub_…). */
  ref?: string;
  data?: Record<string, unknown>;
}

export type GatewayEventType =
  | 'payment.captured'
  | 'payment.failed'
  | 'checkout.cancelled'
  /** A recurring charge succeeded (a renewal, or the first payment when the checkout is still open). */
  | 'subscription.charged'
  /** A renewal failed: the gateway retries (pending) or gave up (halted). Our state: past_due. */
  | 'subscription.pending'
  | 'subscription.halted'
  /** Cancelled or completed at the gateway: no more renewals. */
  | 'subscription.cancelled'
  /** Stored once, nothing to do. */
  | 'ignored';

/** A gateway webhook, after its signature was checked. */
export interface GatewayEvent {
  /** The gateway's event id: stored once (a repeated delivery is ignored). */
  id: string;
  type: GatewayEventType;
  /** Our checkout session ('' when the event does not name one). */
  sessionId: string;
  paymentId?: string;
  amount?: number;
  reason?: string;
  /** The gateway's subscription (Razorpay sub_…). */
  subscriptionId?: string;
  /** The paid billing cycle, when the gateway says it. */
  periodStart?: string;
  periodEnd?: string;
  /** The gateway's original event name (e.g. "invoice.paid"). */
  source?: string;
}

/** A renewal charged on a saved mandate / card. */
export interface RenewalCharge {
  companyId: string;
  amount: number;
  /** Fake gateway only (dev tools): force the result. */
  outcome?: 'success' | 'failure';
  /** Razorpay: the subscription that charges by itself; the renewal is looked up, not charged. */
  subscriptionId?: string | null;
  /** The end of the paid period: a charge for the next one is on or after it. */
  periodEnd?: Date | null;
}

export interface RenewalResult {
  ok: boolean;
  paymentId: string;
  reason?: string;
  /** Nothing charged yet (Razorpay charges a little after the period ends): ask again later. */
  pending?: boolean;
  amount?: number;
  periodStart?: string;
  periodEnd?: string;
}

/**
 * The payment gateway (PLAN.md §20.6/§21/§21.4): `FakeGateway` (dev, open demo) or `RazorpayGateway`, chosen by
 * BILLING_GATEWAY. Both end in the same events and the same subscription states. The apps never deal with money: the
 * Platform turns paid plans into module switches.
 */
export interface PaymentGateway {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutCreated>;
  /** Checks the signature over the raw body and returns the event; throws on a bad signature. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
  chargeRenewal(charge: RenewalCharge): Promise<RenewalResult>;
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
 * the Platform post itself a webhook signed with FAKE_GATEWAY_SECRET, checked like Razorpay's would be. Renewals
 * succeed unless the dev tools ask for a failure.
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

export type GatewayName = 'fake' | 'razorpay';

export interface GatewayConfig {
  /** The gateway new checkouts use; null = checkout answers 503 "Payments are not set up yet". */
  name: GatewayName | null;
  /** Why checkout is off (for the log; never contains a secret value). */
  problem: string | null;
  razorpay?: { keyId: string; keySecret: string; webhookSecret: string; mode: 'test' | 'live' };
}

export const PAYMENTS_OFF_MESSAGE = 'Payments are not set up yet. Please try again later or contact FreeFounders support.';

/**
 * BILLING_GATEWAY=fake|razorpay. Default: fake in dev and on the open demo (DEMO_MODE=1); a production build without
 * DEMO_MODE must say razorpay and have RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET, or checkout
 * stays off (503) while the rest of the app runs.
 */
export function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const raw = (env.BILLING_GATEWAY ?? '').trim().toLowerCase();
  const production = env.NODE_ENV === 'production' && env.DEMO_MODE !== '1';
  if (raw === 'razorpay') {
    const keyId = (env.RAZORPAY_KEY_ID ?? '').trim();
    const keySecret = (env.RAZORPAY_KEY_SECRET ?? '').trim();
    const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET ?? '').trim();
    const missing = [!keyId && 'RAZORPAY_KEY_ID', !keySecret && 'RAZORPAY_KEY_SECRET', !webhookSecret && 'RAZORPAY_WEBHOOK_SECRET'].filter(Boolean);
    if (missing.length) return { name: null, problem: `BILLING_GATEWAY=razorpay but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set` };
    const m = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(keyId);
    if (!m) return { name: null, problem: 'RAZORPAY_KEY_ID does not look like a Razorpay key id (rzp_test_… or rzp_live_…)' };
    return { name: 'razorpay', problem: null, razorpay: { keyId, keySecret, webhookSecret, mode: m[1] as 'test' | 'live' } };
  }
  if (raw === '' || raw === 'fake') {
    if (production) return { name: null, problem: 'production needs BILLING_GATEWAY=razorpay with its keys (FakePay is for dev and the open demo only)' };
    return { name: 'fake', problem: null };
  }
  return { name: null, problem: `BILLING_GATEWAY="${raw}" is not known (use fake or razorpay)` };
}
