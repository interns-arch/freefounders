import { BadRequestException, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import {
  type CheckoutCreated,
  type CheckoutRequest,
  type GatewayEvent,
  type PaymentGateway,
  type RenewalCharge,
  type RenewalResult,
  sameHex,
} from './gateway';

/**
 * Razorpay (PLAN.md §20.6, §21.4): plain HTTPS calls with Basic auth (key id : key secret), no SDK.
 * https://razorpay.com/docs/api/payments/subscriptions/
 *
 * How our billing maps onto Razorpay Subscriptions:
 * - One Razorpay plan per (our plan, interval, price per seat with GST), made on demand and cached in `gateway_plans`.
 * - Checkout = a subscription with quantity = seats, `start_at` = the end of the first paid period and an upfront add-on
 *   = our checkout total (GST included, any upgrade credit and pending seat lines already in it). Razorpay then charges
 *   exactly that total at authorisation ("future start + upfront amount" = the upfront amount only) and the plan amount
 *   × quantity at every renewal. UPI AutoPay, cards, e-mandates and net banking all work this way.
 * - The checkout handler's signature = HMAC_SHA256(payment_id + "|" + subscription_id, key secret);
 *   webhooks: HMAC_SHA256(raw body, webhook secret) in X-Razorpay-Signature, event id in X-Razorpay-Event-Id.
 * - Our own GST invoice stays the tax invoice; Razorpay's subscription invoices are only payment records.
 */

export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';
const TIMEOUT_MS = 15_000;
/** Cycles a subscription runs for before Razorpay ends it (it must be finite): 10 years. */
const TOTAL_COUNT = { month: 120, year: 10 } as const;

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Where Razorpay plan ids are kept (the `gateway_plans` table; the service gives it). */
export interface GatewayPlanStore {
  find(key: { plan: string; interval: string; unitPrice: number; amount: number }): Promise<string | null>;
  save(key: { plan: string; interval: string; unitPrice: number; amount: number }, gatewayPlanId: string): Promise<string>;
}

/** A Razorpay API error: `status` and Razorpay's own description (never the request, which may hold keys). */
export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Json = Record<string, any>;

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const isoOf = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';
  private readonly log = new Logger('Razorpay');

  constructor(
    private readonly keys: RazorpayKeys,
    private readonly planStore: GatewayPlanStore,
  ) {}

  get keyId() {
    return this.keys.keyId;
  }

  /** RAZORPAY_API_BASE only for tests (a local stand-in); real calls go to api.razorpay.com. */
  private base() {
    return (process.env.RAZORPAY_API_BASE?.trim() || 'https://api.razorpay.com/v1').replace(/\/$/, '');
  }

  async api<T = Json>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.keys.keyId}:${this.keys.keySecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(this.base() + path, {
        method,
        headers: { authorization: `Basic ${auth}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new RazorpayError(0, `Razorpay could not be reached (${(err as Error).name === 'TimeoutError' ? 'timeout' : 'network'})`);
    }
    const text = await res.text();
    let data: Json = {};
    try {
      data = text ? (JSON.parse(text) as Json) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new RazorpayError(res.status, String(e.description || `Razorpay answered ${res.status}`), e.code);
    }
    return data as T;
  }

  /** The Razorpay plan for this price, created the first time and reused afterwards. */
  async planId(sub: NonNullable<CheckoutRequest['subscription']>): Promise<string> {
    const key = { plan: sub.planCode, interval: sub.interval, unitPrice: sub.unitPrice, amount: sub.unitAmount };
    const cached = await this.planStore.find(key);
    if (cached) return cached;
    const created = await this.api('POST', '/plans', {
      period: sub.interval === 'year' ? 'yearly' : 'monthly',
      interval: 1,
      item: {
        name: `Kaampilot ${sub.planName} (${sub.interval === 'year' ? 'yearly' : 'monthly'}, per user)`,
        amount: sub.unitAmount,
        currency: 'INR',
        description: `₹${(sub.unitPrice / 100).toFixed(2)} + 18% GST per user`,
      },
      notes: { plan: sub.planCode, interval: sub.interval, unit_price: String(sub.unitPrice) },
    });
    if (!str(created.id)) throw new RazorpayError(502, 'Razorpay did not return a plan id');
    // Two checkouts at once may both create one: the first saved wins and is used by both.
    return this.planStore.save(key, created.id);
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutCreated> {
    const sub = req.subscription;
    if (!sub) throw new BadRequestException('Razorpay checkout needs a plan');
    const planId = await this.planId(sub);
    const created = await this.api('POST', '/subscriptions', {
      plan_id: planId,
      total_count: TOTAL_COUNT[sub.interval],
      quantity: sub.seats,
      start_at: unix(sub.firstPeriodEnd),
      expire_by: unix(req.expiresAt),
      // Kaampilot sends its own GST invoice; Razorpay still mails payment receipts.
      customer_notify: true,
      addons: [{ item: { name: req.description.slice(0, 250), amount: req.amount, currency: 'INR' } }],
      notes: { companyId: req.companyId, sessionId: req.sessionId, plan: sub.planCode, interval: sub.interval, seats: String(sub.seats) },
    });
    if (!str(created.id)) throw new RazorpayError(502, 'Razorpay did not return a subscription id');
    return {
      checkoutUrl: `/billing/pay/${req.sessionId}`,
      ref: created.id,
      data: { planId, startAt: unix(sub.firstPeriodEnd), quantity: sub.seats, unitAmount: sub.unitAmount, shortUrl: str(created.short_url) ?? null },
    };
  }

  /** The Checkout handler's signature: HMAC_SHA256(payment_id|subscription_id, key secret), our own subscription id. */
  checkHandlerSignature(paymentId: string, subscriptionId: string, signature: string): boolean {
    const want = createHmac('sha256', this.keys.keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex');
    return sameHex(want, signature);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent {
    const given = String(headers[RAZORPAY_SIGNATURE_HEADER] ?? '');
    const want = createHmac('sha256', this.keys.webhookSecret).update(rawBody).digest('hex');
    if (!sameHex(want, given)) throw new BadRequestException('Invalid signature');
    let body: Json;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Json;
    } catch {
      throw new BadRequestException('Invalid event');
    }
    if (typeof body?.event !== 'string') throw new BadRequestException('Invalid event');
    const headerId = String(headers[RAZORPAY_EVENT_ID_HEADER] ?? '').trim();
    const id = headerId || `sha256_${createHash('sha256').update(rawBody).digest('hex')}`;
    return toEvent(id, body);
  }

  /**
   * Razorpay charges renewals by itself; this looks the charge up (for a missed webhook, or a server without a public
   * https address for webhooks). A paid invoice that ends after the old period → paid; the subscription pending or
   * halted → failed; otherwise not charged yet.
   */
  async chargeRenewal(charge: RenewalCharge): Promise<RenewalResult> {
    if (!charge.subscriptionId) return { ok: false, paymentId: '', reason: 'No Razorpay subscription' };
    const subscription = await this.api('GET', `/subscriptions/${encodeURIComponent(charge.subscriptionId)}`);
    const invoices = await this.api<{ items?: Json[] }>('GET', `/invoices?subscription_id=${encodeURIComponent(charge.subscriptionId)}&count=10`);
    const after = charge.periodEnd ? unix(charge.periodEnd) - 12 * 3600 : 0;
    const paid = (invoices.items ?? [])
      .filter((i) => i.status === 'paid' && str(i.payment_id) && Number(i.billing_start ?? i.paid_at ?? 0) >= after)
      .sort((a, b) => Number(b.billing_start ?? b.paid_at ?? 0) - Number(a.billing_start ?? a.paid_at ?? 0))[0];
    if (paid) {
      return {
        ok: true,
        paymentId: paid.payment_id,
        amount: Number(paid.amount_paid ?? paid.amount) || undefined,
        periodStart: isoOf(paid.billing_start) ?? isoOf(subscription.current_start),
        periodEnd: isoOf(paid.billing_end) ?? isoOf(subscription.current_end),
      };
    }
    if (['pending', 'halted'].includes(subscription.status)) return { ok: false, paymentId: '', reason: `Razorpay could not charge the renewal (${subscription.status})` };
    if (['cancelled', 'completed', 'expired'].includes(subscription.status)) return { ok: false, paymentId: '', reason: `The Razorpay subscription is ${subscription.status}` };
    return { ok: false, paymentId: '', pending: true };
  }

  /** Seats for the next cycles (cards only: Razorpay refuses UPI / e-mandate subscriptions). */
  async setQuantity(subscriptionId: string, quantity: number) {
    await this.api('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { quantity, schedule_change_at: 'cycle_end', customer_notify: false });
  }

  /** A one-off amount (GST included) added to the subscription's next invoice. */
  async addOn(subscriptionId: string, name: string, amount: number) {
    await this.api('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/addons`, { item: { name: name.slice(0, 250), amount, currency: 'INR' }, quantity: 1 });
  }

  /** No more renewals. Our period already paid keeps running on our side. */
  async cancel(subscriptionId: string) {
    try {
      await this.api('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: false });
    } catch (err) {
      // Already cancelled / expired: nothing left to stop.
      if (err instanceof RazorpayError && err.status === 400 && /cancel|expired|completed/i.test(err.message)) {
        this.log.warn(`Subscription ${subscriptionId}: ${err.message}`);
        return;
      }
      throw err;
    }
  }
}

/** A Razorpay webhook body → our event (anything we do not act on is 'ignored', still stored once). */
export function toEvent(id: string, body: Json): GatewayEvent {
  const name: string = body.event;
  const p = body.payload ?? {};
  const payment: Json | undefined = p.payment?.entity;
  const subscription: Json | undefined = p.subscription?.entity;
  const invoice: Json | undefined = p.invoice?.entity;
  const sessionId = str(payment?.notes?.sessionId) ?? str(subscription?.notes?.sessionId) ?? str(invoice?.notes?.sessionId) ?? '';
  const subscriptionId = str(subscription?.id) ?? str(invoice?.subscription_id) ?? str(payment?.subscription_id);
  const base = { id, sessionId, source: name, ...(subscriptionId ? { subscriptionId } : {}) };
  const paymentFields = payment ? { paymentId: str(payment.id), amount: typeof payment.amount === 'number' ? payment.amount : undefined } : {};
  switch (name) {
    case 'payment.captured':
      return { ...base, type: 'payment.captured', ...paymentFields };
    case 'payment.failed':
      return { ...base, type: 'payment.failed', ...paymentFields, reason: str(payment?.error_description) ?? 'Payment failed' };
    case 'subscription.charged':
      return { ...base, type: 'subscription.charged', ...paymentFields, periodStart: isoOf(subscription?.current_start), periodEnd: isoOf(subscription?.current_end) };
    case 'invoice.paid':
      if (!subscriptionId || !str(invoice?.payment_id)) return { ...base, type: 'ignored' };
      return {
        ...base,
        type: 'subscription.charged',
        paymentId: str(invoice?.payment_id),
        amount: Number(invoice?.amount_paid ?? invoice?.amount) || paymentFields.amount,
        periodStart: isoOf(invoice?.billing_start),
        periodEnd: isoOf(invoice?.billing_end),
      };
    case 'subscription.authenticated':
    case 'subscription.activated':
      // The upfront payment arrives with these (future start): it settles a checkout that is still open.
      return payment && ['captured', 'authorized'].includes(payment.status) ? { ...base, type: 'payment.captured', ...paymentFields } : { ...base, type: 'ignored' };
    case 'subscription.pending':
      return { ...base, type: 'subscription.pending', ...paymentFields, reason: str(payment?.error_description) ?? 'Renewal payment failed; Razorpay will retry' };
    case 'subscription.halted':
      return { ...base, type: 'subscription.halted', ...paymentFields, reason: str(payment?.error_description) ?? 'Renewal payment failed; Razorpay stopped retrying' };
    case 'subscription.cancelled':
    case 'subscription.completed':
      return { ...base, type: 'subscription.cancelled' };
    default:
      return { ...base, type: 'ignored' };
  }
}
