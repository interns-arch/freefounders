import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CashfreeConfig, CheckoutCreated, CheckoutRequest, GatewayEvent, PaymentGateway } from './gateway';

/**
 * Cashfree Payments (PLAN.md §21.10): plain HTTPS calls, no SDK. One Cashfree order per checkout session (= one payment
 * attempt), paid on Cashfree's hosted checkout; renewals are new orders the owner pays on the Billing page.
 *
 * Endpoints used (base https://api.cashfree.com/pg, sandbox https://sandbox.cashfree.com/pg; headers `x-client-id`
 * (App ID), `x-client-secret` (Secret Key), `x-api-version: 2026-01-01`, JSON in and out):
 * - Create Order `POST /orders` (https://www.cashfree.com/docs/api-reference/payments/latest/orders/create):
 *   order_id (3–45 chars, letters, digits, _ and -; ours: `kp_<checkout session uuid>`), order_amount in RUPEES with up
 *   to 2 decimals (we keep paise: paise / 100), order_currency INR, customer_details {customer_id (letters and digits:
 *   our account id without dashes), customer_phone (required, 10 digits), customer_email, customer_name},
 *   order_meta {return_url (GET, ≤ 250 chars), notify_url (https, ≤ 250 chars)}, order_expiry_time (ISO 8601),
 *   order_note, order_tags. `x-idempotency-key` = the session id, so a retried request cannot make a second order.
 *   Answer: payment_session_id (for Cashfree.js), cf_order_id, order_status ACTIVE | PAID | EXPIRED | TERMINATED.
 * - Get Order `GET /orders/{order_id}` (https://www.cashfree.com/docs/api-reference/payments/latest/orders/get):
 *   order_status, order_amount.
 * - Get Payments for an Order `GET /orders/{order_id}/payments`
 *   (https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-order): cf_payment_id,
 *   payment_status SUCCESS | FAILED | USER_DROPPED | CANCELLED | VOID | PENDING | NOT_ATTEMPTED, payment_amount (rupees),
 *   payment_message, error_details.
 * - Checkout in the browser: Cashfree.js v3 (https://sdk.cashfree.com/js/v3/cashfree.js), `Cashfree({mode})
 *   .checkout({paymentSessionId, redirectTarget: '_self'})` (https://www.cashfree.com/docs/payments/online/web/redirect);
 *   Cashfree sends the person back to return_url, where the page asks the server to look the order up.
 * - Webhooks (https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks,
 *   https://www.cashfree.com/docs/payments/online/webhooks/signature-verification): `x-webhook-signature` =
 *   base64(HMAC-SHA256(x-webhook-timestamp + raw body, Secret Key)); types PAYMENT_SUCCESS_WEBHOOK,
 *   PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK (and the dashboard's newer names payment.success /
 *   payment.failed); body {type, event_time, data: {order: {order_id, order_amount, order_tags}, payment:
 *   {cf_payment_id, payment_status, payment_amount, payment_message}, error_details?}}. Anything else (a test event,
 *   PAYMENT_CHARGES_WEBHOOK) is stored once and answered 200.
 *
 * A payment counts only when the server saw it: a signed webhook, or the order looked up at Cashfree (return URL, the
 * billing clock for orders nobody came back from). Both give the same event id per payment and outcome, so whichever
 * comes second changes nothing. Refunds are not used (Kaampilot gives credit for unused time instead).
 * Never logged: the Secret Key, payment_session_id, card / UPI / bank details (we never read them).
 */

export const CASHFREE_SIGNATURE_HEADER = 'x-webhook-signature';
export const CASHFREE_TIMESTAMP_HEADER = 'x-webhook-timestamp';
const TIMEOUT_MS = 15_000;
/** Cashfree requires a 10-digit customer_phone; used when the account has no mobile number (email-only sign-up). */
export const CASHFREE_FALLBACK_PHONE = '9999999999';

const SUCCESS_TYPES = new Set(['PAYMENT_SUCCESS_WEBHOOK', 'payment.success', 'payment.captured', 'success.payment']);
const FAILED_TYPES = new Set(['PAYMENT_FAILED_WEBHOOK', 'payment.failed', 'failed.payment']);
const DROPPED_TYPES = new Set(['PAYMENT_USER_DROPPED_WEBHOOK', 'payment.user_dropped', 'payment.dropped', 'user_dropped.payment']);

/** A Cashfree API error: `status` and Cashfree's own message (never the request, which holds the keys). */
export class CashfreeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Json = Record<string, any>;

const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);
/** Rupees (number or "590.00") → paise. */
export const paiseOf = (rupees: unknown): number | undefined => {
  const n = typeof rupees === 'number' ? rupees : typeof rupees === 'string' && rupees.trim() ? Number(rupees) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
/** Paise → the rupee number Cashfree wants (two decimals at most). */
export const rupeesOf = (paise: number) => Math.round(paise) / 100;

/** Our order id for a checkout session, and back. */
export const orderIdOf = (sessionId: string) => `kp_${sessionId}`;
export const sessionOfOrder = (orderId: unknown): string => {
  const m = typeof orderId === 'string' ? /^kp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(orderId) : null;
  return m ? m[1].toLowerCase() : '';
};

/** A stored mobile number → Cashfree's customer_phone (10 digits for India, "+<country><number>" otherwise). */
export function cashfreePhone(mobile: string | null | undefined): string {
  const digits = (mobile ?? '').replace(/[^\d+]/g, '');
  const india = /^(?:\+?91)?([6-9]\d{9})$/.exec(digits);
  if (india) return india[1];
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return CASHFREE_FALLBACK_PHONE;
}

/** The outcome of looking an order up (return URL, the billing clock). */
export type OrderCheck =
  | { status: 'paid'; event: GatewayEvent }
  | { status: 'failed'; event: GatewayEvent }
  | { status: 'pending' }
  | { status: 'expired'; event: GatewayEvent };

const eventId = (paymentId: string, outcome: 'paid' | 'failed') => `cf_${outcome}_${paymentId}`;

export class CashfreeGateway implements PaymentGateway {
  readonly name = 'cashfree';

  constructor(private readonly cfg: CashfreeConfig) {}

  get mode() {
    return this.cfg.env;
  }

  /** CASHFREE_API_BASE only for tests (a local stand-in); real calls go to api.cashfree.com / sandbox.cashfree.com. */
  private base() {
    const real = this.cfg.env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
    return (process.env.CASHFREE_API_BASE?.trim() || real).replace(/\/$/, '');
  }

  async api<T = Json>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base() + path, {
        method,
        headers: {
          accept: 'application/json',
          'x-client-id': this.cfg.appId,
          'x-client-secret': this.cfg.secretKey,
          'x-api-version': this.cfg.apiVersion,
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new CashfreeError(0, `Cashfree could not be reached (${(err as Error).name === 'TimeoutError' ? 'timeout' : 'network'})`);
    }
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new CashfreeError(res.status, String(data?.message || `Cashfree answered ${res.status}`), str(data?.code));
    return data as T;
  }

  private publicUrl() {
    return (process.env.PUBLIC_WEB_URL?.trim() || 'http://localhost:8080').replace(/\/+$/, '');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutCreated> {
    const orderId = orderIdOf(req.sessionId);
    const web = this.publicUrl();
    const notifyUrl = `${web}/api/platform/billing/webhooks/cashfree`;
    const c = req.customer;
    const body = {
      order_id: orderId,
      order_amount: rupeesOf(req.amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: (c?.id ?? req.companyId).replace(/[^A-Za-z0-9]/g, '').slice(0, 50),
        customer_phone: cashfreePhone(c?.phone),
        ...(c?.email && c.email.length >= 3 && c.email.length <= 100 ? { customer_email: c.email } : {}),
        ...(c?.name && c.name.trim().length >= 3 ? { customer_name: c.name.trim().slice(0, 100) } : {}),
      },
      order_meta: {
        // The payment page asks the server to look the order up when the person is back (never trusts the redirect).
        return_url: `${web}/billing/pay/${req.sessionId}?order_id=${orderId}`,
        // Cashfree wants https here; a plain-http dev address relies on the return URL and the billing clock instead.
        ...(notifyUrl.startsWith('https://') ? { notify_url: notifyUrl } : {}),
      },
      order_expiry_time: req.expiresAt.toISOString(),
      order_note: req.description.slice(0, 200).padEnd(3, '.'),
      order_tags: { sessionId: req.sessionId, companyId: req.companyId },
    };
    const created = await this.api('POST', '/orders', body, req.sessionId);
    const paymentSessionId = str(created.payment_session_id);
    if (!paymentSessionId) throw new CashfreeError(502, 'Cashfree did not return a payment session');
    return {
      checkoutUrl: `/billing/pay/${req.sessionId}`,
      ref: orderId,
      data: { paymentSessionId, cfOrderId: str(created.cf_order_id) ?? null, mode: this.cfg.env },
    };
  }

  /**
   * The order as Cashfree has it: PAID → the successful payment; still ACTIVE → the last attempt failed / was dropped
   * (the person may try again until the order expires) or nothing yet; EXPIRED / TERMINATED → closed.
   */
  async checkOrder(orderId: string): Promise<OrderCheck> {
    const sessionId = sessionOfOrder(orderId);
    const order = await this.api('GET', `/orders/${encodeURIComponent(orderId)}`);
    const status = String(order.order_status ?? '');
    const list = await this.api<Json[] | Json>('GET', `/orders/${encodeURIComponent(orderId)}/payments`).catch((err) => {
      if (err instanceof CashfreeError && err.status === 404) return [] as Json[];
      throw err;
    });
    const attempts = (Array.isArray(list) ? list : []).filter((p) => str(p?.cf_payment_id));
    const ok = attempts.find((p) => p.payment_status === 'SUCCESS');
    if (ok) {
      const paymentId = str(ok.cf_payment_id)!;
      return {
        status: 'paid',
        event: { id: eventId(paymentId, 'paid'), type: 'payment.captured', sessionId, paymentId, amount: paiseOf(ok.payment_amount ?? order.order_amount), source: 'order.status' },
      };
    }
    if (status === 'PAID') {
      // Paid, but the payment list does not show it (yet): the order's own status is Cashfree's word for it.
      return { status: 'paid', event: { id: `cf_paid_${orderId}`, type: 'payment.captured', sessionId, amount: paiseOf(order.order_amount), source: 'order.status' } };
    }
    if (status === 'EXPIRED' || status === 'TERMINATED' || status === 'TERMINATION_REQUESTED') {
      return { status: 'expired', event: { id: `cf_closed_${orderId}`, type: 'checkout.cancelled', sessionId, source: `order.${status.toLowerCase()}` } };
    }
    const last = attempts
      .filter((p) => ['FAILED', 'USER_DROPPED', 'CANCELLED', 'VOID'].includes(p.payment_status))
      .sort((a, b) => String(b.payment_time ?? '').localeCompare(String(a.payment_time ?? '')))[0];
    if (last) {
      const paymentId = str(last.cf_payment_id)!;
      return {
        status: 'failed',
        event: { id: eventId(paymentId, 'failed'), type: 'payment.failed', sessionId, paymentId, amount: paiseOf(last.payment_amount), reason: reasonOf(last, last.error_details), source: 'order.status' },
      };
    }
    return { status: 'pending' };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent {
    const given = String(headers[CASHFREE_SIGNATURE_HEADER] ?? '').trim();
    const timestamp = String(headers[CASHFREE_TIMESTAMP_HEADER] ?? '').trim();
    if (!given || !timestamp) throw new BadRequestException('Invalid signature');
    const want = createHmac('sha256', this.cfg.secretKey).update(timestamp).update(rawBody).digest();
    const got = Buffer.from(given, 'base64');
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new BadRequestException('Invalid signature');
    let body: Json;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Json;
    } catch {
      throw new BadRequestException('Invalid event');
    }
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid event');
    const fallbackId = str(headers['x-idempotency-key']) ?? `sha256_${createHash('sha256').update(rawBody).digest('hex')}`;
    return toCashfreeEvent(body, fallbackId);
  }
}

function reasonOf(payment: Json | undefined, error: Json | undefined): string {
  return str(error?.error_description) ?? str(payment?.payment_message) ?? 'Payment failed';
}

/**
 * A Cashfree webhook body → our event. Success / failed / dropped name the payment, so the event id is the same one
 * the order look-up gives (stored once). Everything else (test events, charges, unknown types) → 'ignored'.
 * `check` asks the service to look the order up when a success / failure event lacks the payment details.
 */
export function toCashfreeEvent(body: Json, fallbackId: string): GatewayEvent {
  const type = String(body.type ?? body.event ?? body.event_type ?? '');
  const data: Json = body.data && typeof body.data === 'object' ? body.data : {};
  const order: Json = data.order ?? {};
  const payment: Json = data.payment ?? {};
  const orderId = str(order.order_id) ?? str(data.order_id) ?? str(payment.order_id);
  const sessionId = sessionOfOrder(orderId);
  const paymentId = str(payment.cf_payment_id) ?? str(data.cf_payment_id);
  const status = str(payment.payment_status) ?? str(data.payment_status);
  const amount = paiseOf(payment.payment_amount ?? data.payment_amount);
  const base = { sessionId, source: type || 'unknown' };
  const success = SUCCESS_TYPES.has(type);
  const failed = FAILED_TYPES.has(type) || DROPPED_TYPES.has(type);
  if (!success && !failed) return { ...base, id: fallbackId, type: 'ignored' };
  if (!sessionId) return { ...base, id: fallbackId, type: 'ignored' }; // not one of our orders
  if (success && paymentId && status === 'SUCCESS' && typeof amount === 'number') {
    return { ...base, id: eventId(paymentId, 'paid'), type: 'payment.captured', paymentId, amount };
  }
  if (failed && paymentId && status !== 'SUCCESS') {
    return { ...base, id: eventId(paymentId, 'failed'), type: 'payment.failed', paymentId, amount, reason: DROPPED_TYPES.has(type) ? 'Payment not completed' : reasonOf(payment, data.error_details) };
  }
  // A success / failure we cannot read in full: stored once, then the order is looked up at Cashfree.
  return { ...base, id: fallbackId, type: 'ignored', check: true };
}
