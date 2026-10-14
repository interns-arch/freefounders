import { BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** What the gateway's checkout page needs. */
export interface CheckoutRequest {
  sessionId: string;
  companyId: string;
  /** paise, GST included */
  amount: number;
  description: string;
}

/** A gateway webhook, after its signature was checked. */
export interface GatewayEvent {
  /** The gateway's event id: stored once (a repeated delivery is ignored). */
  id: string;
  type: 'payment.captured' | 'payment.failed' | 'checkout.cancelled';
  sessionId: string;
  paymentId?: string;
  amount?: number;
  reason?: string;
}

/** A renewal charged on a saved mandate / card (Razorpay subscriptions later). */
export interface RenewalCharge {
  companyId: string;
  amount: number;
  /** Fake gateway only (dev tools): force the result. */
  outcome?: 'success' | 'failure';
}

/**
 * The payment gateway (PLAN.md §20.6/§21). `FakeGateway` now; `RazorpayGateway` later with the same events and states.
 * The apps never deal with money: the Platform turns paid plans into module switches.
 */
export interface PaymentGateway {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Checks the signature over the raw body and returns the event; throws on a bad signature. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
  chargeRenewal(charge: RenewalCharge): Promise<{ ok: boolean; paymentId: string; reason?: string }>;
}

export const FAKE_SIGNATURE_HEADER = 'x-fakepay-signature';

/** HMAC secret of the fake gateway: FAKE_GATEWAY_SECRET (dev default in scripts/dev.mjs; none in production). */
function fakeSecret(): string | null {
  const s = process.env.FAKE_GATEWAY_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

export const signFake = (rawBody: Buffer | string, secret = fakeSecret()) => {
  if (!secret) throw new BadRequestException('The test payment gateway is not configured (FAKE_GATEWAY_SECRET)');
  return createHmac('sha256', secret).update(rawBody).digest('hex');
};

/**
 * "FakePay · test mode": the checkout page is the web app's `/billing/pay/<session>`; Pay / Fail / Cancel there make
 * the Platform post itself a webhook signed with FAKE_GATEWAY_SECRET, checked like Razorpay's would be. Renewals
 * succeed unless the dev tools ask for a failure.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';

  async createCheckout(req: CheckoutRequest) {
    return { checkoutUrl: `/billing/pay/${req.sessionId}` };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent {
    const secret = fakeSecret();
    const given = String(headers[FAKE_SIGNATURE_HEADER] ?? '');
    if (!secret || !/^[0-9a-f]{64}$/.test(given)) throw new BadRequestException('Invalid signature');
    const want = Buffer.from(signFake(rawBody, secret), 'hex');
    if (!timingSafeEqual(want, Buffer.from(given, 'hex'))) throw new BadRequestException('Invalid signature');
    let event: GatewayEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
    } catch {
      throw new BadRequestException('Invalid event');
    }
    if (typeof event?.id !== 'string' || !['payment.captured', 'payment.failed', 'checkout.cancelled'].includes(event.type) || typeof event.sessionId !== 'string') {
      throw new BadRequestException('Invalid event');
    }
    return event;
  }

  async chargeRenewal(charge: RenewalCharge) {
    const ok = charge.outcome !== 'failure';
    return { ok, paymentId: `fakepay_${randomBytes(8).toString('hex')}`, ...(ok ? {} : { reason: 'Card declined (test)' }) };
  }
}
