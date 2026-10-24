// Cashfree as the payment gateway (PLAN.md §21.10), against a local stand-in for api.cashfree.com/pg: no network, no
// real keys. Run with `npm test` (own process; shares the throwaway `ff_platform_test` database, adds its own rows only).
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { normaliseIdentifier } from './accounts/identifier';
import { BillingService } from './billing/billing.service';
import { cashfreePhone, paiseOf, rupeesOf, toCashfreeEvent } from './billing/cashfree.gateway';
import { CASHFREE_API_VERSION, gatewayConfig } from './billing/gateway';
import { DbService } from './db/db.service';
import { billingEvents, checkoutSessions, invoices, otpCodes, payments, subscriptions } from './db/schema';
import { createApp } from './main';

const APP_ID = 'TEST1000StandInAppId';
const SECRET = 'cfsk_ma_test_stand_in_not_real_0123456789';
const PASSWORD = 'Cash@2026';
let app: INestApplication;
let base = '';
let dbs: DbService;
let appsStandIn: Server;
let cfStandIn: Server;
let nextUserId = 7000;

// ─── the Cashfree stand-in ──────────────────────────────────────────────────
interface CfCall {
  method: string;
  path: string;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}
interface StandInOrder {
  order_id: string;
  order_amount: number;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED';
  payments: Array<{ cf_payment_id: string; payment_status: string; payment_amount: number; payment_time: string; payment_message?: string; error_details?: Record<string, string> }>;
}
const cf = { calls: [] as CfCall[], orders: new Map<string, StandInOrder>(), n: 0 };

function startCashfreeStandIn() {
  return createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url!, 'http://x');
    const path = url.pathname.replace(/^\/pg/, '');
    const body = raw ? JSON.parse(raw) : null;
    cf.calls.push({ method: req.method!, path, body, headers: req.headers });
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers['x-client-id'] !== APP_ID || req.headers['x-client-secret'] !== SECRET) {
      return json(401, { message: 'authentication Failed', code: 'request_failed', type: 'authentication_error' });
    }
    if (!req.headers['x-api-version']) return json(400, { message: 'x-api-version missing', code: 'request_failed', type: 'invalid_request_error' });
    if (req.method === 'POST' && path === '/orders') {
      if (cf.orders.has(body.order_id)) return json(409, { message: 'order with same id is already present', code: 'order_already_exists', type: 'invalid_request_error' });
      if (!/^\d{10}$|^\+\d+$/.test(body.customer_details?.customer_phone ?? '')) return json(400, { message: 'customer_details.customer_phone : invalid', code: 'customer_details.customer_phone_invalid', type: 'invalid_request_error' });
      cf.orders.set(body.order_id, { order_id: body.order_id, order_amount: body.order_amount, order_status: 'ACTIVE', payments: [] });
      return json(200, { cf_order_id: String(2000 + ++cf.n), order_id: body.order_id, order_status: 'ACTIVE', order_amount: body.order_amount, payment_session_id: `session_test_${randomBytes(6).toString('hex')}` });
    }
    let m = /^\/orders\/([^/]+)$/.exec(path);
    if (m && req.method === 'GET') {
      const o = cf.orders.get(decodeURIComponent(m[1]));
      return o ? json(200, { order_id: o.order_id, order_amount: o.order_amount, order_status: o.order_status, order_currency: 'INR' }) : json(404, { message: 'order not found', code: 'order_not_found' });
    }
    m = /^\/orders\/([^/]+)\/payments$/.exec(path);
    if (m && req.method === 'GET') {
      const o = cf.orders.get(decodeURIComponent(m[1]));
      return o ? json(200, o.payments) : json(404, { message: 'order not found', code: 'order_not_found' });
    }
    return json(404, { message: 'not found' });
  });
}

/** A payment as Cashfree records it on an order (what Get Payments then answers). */
function pay(orderId: string, status: 'SUCCESS' | 'FAILED' | 'USER_DROPPED', amount?: number) {
  const o = cf.orders.get(orderId)!;
  const p = {
    cf_payment_id: String(5_000_000_000 + ++cf.n),
    payment_status: status,
    payment_amount: amount ?? o.order_amount,
    payment_time: new Date(Date.now() + cf.n).toISOString(),
    payment_message: status === 'SUCCESS' ? 'Transaction successful' : 'Payment failed',
    ...(status === 'FAILED' ? { error_details: { error_code: 'TRANSACTION_DECLINED', error_description: 'issuer bank or payment service provider declined the transaction' } } : {}),
  };
  o.payments.push(p);
  if (status === 'SUCCESS') o.order_status = 'PAID';
  return p;
}

// ─── helpers ────────────────────────────────────────────────────────────────
interface Res {
  status: number;
  body: any;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string; at?: string } = {}): Promise<Res> {
  const res = await fetch((opts.at ?? base) + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function signup(identifier: string, name: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const res = await call('POST', '/signup/complete', {
    body: { signupToken: v.body.signupToken, fullName: 'Asha Owner', password: PASSWORD, username: `c${randomBytes(6).toString('hex')}`, company: { name, teamSize: '11-50', industry: 'Retail', state: 'Maharashtra', apps: ['tasks'] } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string };
}

const subOf = async (companyId: string) => (await dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0];
const sessionOf = async (id: string) => (await dbs.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)))[0];
const invoiceCount = async (companyId: string) => (await dbs.db.select().from(invoices).where(eq(invoices.companyId, companyId))).length;

/** A Cashfree webhook: body signed as base64(HMAC-SHA256(timestamp + raw body, Secret Key)). */
async function webhook(payload: Record<string, unknown>, opts: { secret?: string; at?: string; tamper?: (raw: string) => string; idempotencyKey?: string } = {}) {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now());
  const signature = createHmac('sha256', opts.secret ?? SECRET).update(ts + raw).digest('base64');
  return call('POST', '/billing/webhooks/cashfree', {
    raw: opts.tamper ? opts.tamper(raw) : raw,
    at: opts.at,
    // Like Cashfree: no CSRF header, no cookie.
    headers: { 'x-requested-with': '', 'x-webhook-signature': signature, 'x-webhook-timestamp': ts, 'x-webhook-version': '2026-01-01', ...(opts.idempotencyKey ? { 'x-idempotency-key': opts.idempotencyKey } : {}) },
  });
}
const paymentEvent = (type: string, orderId: string, p: ReturnType<typeof pay>, orderAmount: number) => ({
  type,
  event_time: new Date().toISOString(),
  data: {
    order: { order_id: orderId, order_amount: orderAmount, order_currency: 'INR', order_tags: null },
    payment: { cf_payment_id: p.cf_payment_id, payment_status: p.payment_status, payment_amount: p.payment_amount, payment_currency: 'INR', payment_message: p.payment_message, payment_group: 'upi' },
    customer_details: { customer_id: 'x', customer_phone: '9999999999' },
    ...(p.error_details ? { error_details: p.error_details } : {}),
  },
});

async function startCheckout(token: string, plan = 'tasks', seats = 5) {
  const co = await call('POST', '/billing/checkout', { token, body: { plan, interval: 'month', seats } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const s = await sessionOf(co.body.sessionId);
  return { sessionId: co.body.sessionId as string, orderId: s.gatewayRef!, total: s.total, session: s, response: co.body };
}

before(async () => {
  appsStandIn = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const app = req.url!.startsWith('/assets') ? 'assets' : 'tasks';
    const path = req.url!.replace(/^\/(tasks|assets)\/api\/internal/, '').split('?')[0];
    decodeJwt(String(req.headers.authorization).slice(7));
    const body = raw ? JSON.parse(raw) : null;
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.method === 'POST' && path === '/companies') return json(201, { companyId: body.companyId, schema: `co_${String(body.code).toLowerCase()}`, created: true });
    if (req.method === 'POST' && path === '/provision') return json(200, { userId: nextUserId++ });
    if (path === '/permissions') return json(200, { app, scopes: [], permissions: [{ key: `${app}.view`, label: 'See', group: 'All', scopes: null }] });
    if (req.method === 'GET' && path === '/access') return json(200, { version: 0, roles: [], people: [] });
    if (req.method === 'PUT' && path === '/access') return json(200, { applied: true, problems: [] });
    if (path === '/modules') return json(200, { app, modules: [{ key: 'm1', label: 'M1', description: '', default: true }] });
    if (req.method === 'PUT' && path === '/company') return json(200, { version: body.version, applied: true });
    if (req.method === 'GET' && path === '/people') return json(200, { departments: [], people: [] });
    if (req.method === 'PUT' && path === '/people') return json(200, { version: body.version, applied: true });
    if (path === '/events' || path === '/roles') return json(200, []);
    return json(404, { detail: 'not here' });
  });
  await new Promise<void>((r) => appsStandIn.listen(0, '127.0.0.1', r));
  cfStandIn = startCashfreeStandIn();
  await new Promise<void>((r) => cfStandIn.listen(0, '127.0.0.1', r));
  const appsPort = (appsStandIn.address() as AddressInfo).port;
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${appsPort}/tasks/api/internal`;
  process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${appsPort}/assets/api/internal`;
  process.env.OTP_DEV_ECHO = '1';
  process.env.OTP_IP_LIMIT = '0';
  process.env.SELLER_STATE = 'Maharashtra';
  process.env.PUBLIC_WEB_URL = 'https://kaampilot.test';
  delete process.env.BILLING_GATEWAY;
  process.env.PAYMENT_GATEWAY = 'cashfree';
  process.env.CASHFREE_APP_ID = APP_ID;
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_ENV = 'sandbox';
  process.env.CASHFREE_API_BASE = `http://127.0.0.1:${(cfStandIn.address() as AddressInfo).port}/pg`;
  delete process.env.FAKE_GATEWAY_SECRET;

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
});

after(async () => {
  await app?.close();
  appsStandIn?.close();
  cfStandIn?.close();
});

describe('PAYMENT_GATEWAY and the Cashfree keys (checked at start-up)', () => {
  test('fake by default in dev; production needs cashfree with both keys; razorpay (removed) is "not set up", never a crash', () => {
    const keys = { CASHFREE_APP_ID: APP_ID, CASHFREE_SECRET_KEY: 'super-secret-value' };
    assert.equal(gatewayConfig({ NODE_ENV: 'development' }).name, 'fake');
    assert.equal(gatewayConfig({ NODE_ENV: 'production', DEMO_MODE: '1' }).name, 'fake');
    assert.equal(gatewayConfig({ NODE_ENV: 'production' }).name, null);
    assert.equal(gatewayConfig({ NODE_ENV: 'production', PAYMENT_GATEWAY: 'fake' }).name, null, 'FakePay never takes real customers');
    const ok = gatewayConfig({ NODE_ENV: 'production', PAYMENT_GATEWAY: 'Cashfree', ...keys });
    assert.equal(ok.name, 'cashfree');
    assert.equal(ok.cashfree?.env, 'sandbox', 'sandbox unless told otherwise');
    assert.equal(ok.cashfree?.apiVersion, CASHFREE_API_VERSION);
    assert.equal(gatewayConfig({ PAYMENT_GATEWAY: 'cashfree', ...keys, CASHFREE_ENV: 'production' }).cashfree?.env, 'production');
    assert.equal(gatewayConfig({ PAYMENT_GATEWAY: 'cashfree', ...keys, CASHFREE_ENV: 'live' }).name, null);
    assert.equal(gatewayConfig({ BILLING_GATEWAY: 'cashfree', ...keys }).name, 'cashfree', 'the older variable name still works');
    const missing = gatewayConfig({ PAYMENT_GATEWAY: 'cashfree', CASHFREE_APP_ID: APP_ID });
    assert.equal(missing.name, null);
    assert.equal(missing.problem, 'PAYMENT_GATEWAY=cashfree but CASHFREE_SECRET_KEY is not set');
    const rzp = gatewayConfig({ NODE_ENV: 'production', PAYMENT_GATEWAY: 'razorpay', RAZORPAY_KEY_SECRET: 'super-secret-value' });
    assert.equal(rzp.name, null);
    assert.match(rzp.problem!, /Razorpay was removed/);
    assert.equal(gatewayConfig({ BILLING_GATEWAY: 'razorpay' }).name, null, 'an old server .env: payments off, not a crash');
    for (const c of [missing, rzp]) assert.ok(!c.problem!.includes('super-secret-value'), 'never a secret value in the message');
  });

  test('amounts and phone numbers as Cashfree wants them', () => {
    assert.equal(rupeesOf(59000), 590);
    assert.equal(rupeesOf(58999), 589.99);
    assert.equal(paiseOf(589.99), 58999);
    assert.equal(paiseOf('590.00'), 59000);
    assert.equal(paiseOf(1.1), 110, 'no float drift');
    assert.equal(cashfreePhone('+919876543210'), '9876543210');
    assert.equal(cashfreePhone('98765 43210'), '9876543210');
    assert.equal(cashfreePhone('+14155550123'), '+14155550123');
    assert.equal(cashfreePhone(null), '9999999999', 'email-only account: the documented placeholder');
    assert.equal(toCashfreeEvent({ type: 'WEBHOOK_TEST', data: { test_object: { test: 'ok' } } }, 'k1').type, 'ignored');
  });

  test('missing keys: checkout answers 503 "Payments are not set up yet", the rest keeps working; the webhook says 503 (Cashfree retries)', async () => {
    const saved = process.env.CASHFREE_SECRET_KEY;
    delete process.env.CASHFREE_SECRET_KEY;
    const off = await createApp();
    try {
      await off.listen(0, '127.0.0.1');
      const at = `http://127.0.0.1:${(off.getHttpServer().address() as AddressInfo).port}/api/platform`;
      const { accessToken } = await signup('asha@nokeys.test', 'No Keys Traders');
      const co = await call('POST', '/billing/checkout', { at, token: accessToken, body: { plan: 'tasks', interval: 'month', seats: 5 } });
      assert.equal(co.status, 503);
      assert.match(co.body.message, /Payments are not set up yet/);
      const view = await call('GET', '/billing', { at, token: accessToken });
      assert.equal(view.status, 200);
      assert.equal(view.body.checkoutGateway, null);
      assert.equal((await call('GET', '/auth/me', { at, token: accessToken })).status, 200);
      const hook = await webhook({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }, { at });
      assert.equal(hook.status, 503);
    } finally {
      await off.close();
      process.env.CASHFREE_SECRET_KEY = saved;
    }
  });
});

describe('Cashfree checkout (PLAN.md §21.10)', () => {
  test('creates one order per checkout: headers, rupees, customer, return and notify URLs; the page gets the payment session', async () => {
    cf.calls.length = 0;
    const { accessToken, companyId } = await signup('asha@order.test', 'Order Traders');
    const c = await startCheckout(accessToken, 'tasks', 5);
    assert.equal(c.response.gateway, 'cashfree');
    assert.equal(c.orderId, `kp_${c.sessionId}`);
    const create = cf.calls.find((x) => x.method === 'POST' && x.path === '/orders')!;
    assert.equal(create.headers['x-client-id'], APP_ID);
    assert.equal(create.headers['x-client-secret'], SECRET);
    assert.equal(create.headers['x-api-version'], CASHFREE_API_VERSION);
    assert.equal(create.headers['x-idempotency-key'], c.sessionId);
    const b = create.body;
    assert.equal(b.order_id, c.orderId);
    assert.equal(b.order_currency, 'INR');
    assert.equal(b.order_amount, c.total / 100, 'paise → rupees');
    assert.match(b.customer_details.customer_id, /^[A-Za-z0-9]{3,50}$/);
    assert.equal(b.customer_details.customer_phone, '9999999999', 'email sign-up: no mobile');
    assert.equal(b.customer_details.customer_email, 'asha@order.test');
    assert.equal(b.order_meta.return_url, `https://kaampilot.test/billing/pay/${c.sessionId}?order_id=${c.orderId}`);
    assert.equal(b.order_meta.notify_url, 'https://kaampilot.test/api/platform/billing/webhooks/cashfree');
    assert.ok(Date.parse(b.order_expiry_time) > Date.now() + 30 * 60_000);
    assert.deepEqual(b.order_tags, { sessionId: c.sessionId, companyId });

    const page = await call('GET', `/billing/checkout/${c.sessionId}`, { token: accessToken });
    assert.equal(page.status, 200);
    assert.equal(page.body.gateway, 'cashfree');
    assert.match(page.body.cashfree.paymentSessionId, /^session_test_/);
    assert.equal(page.body.cashfree.mode, 'sandbox');
    // Nothing paid yet: the look-up says pending and changes nothing.
    const pending = await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    assert.equal(pending.body.attempt, 'pending');
    assert.equal((await subOf(companyId)).state, 'trialing');
  });

  test('paid via the status check (return URL): applied once; the webhook for the same payment afterwards is a duplicate', async () => {
    const { accessToken, companyId } = await signup('asha@return.test', 'Return Traders');
    const c = await startCheckout(accessToken);
    const p = pay(c.orderId, 'SUCCESS');
    const r = await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.attempt, 'paid');
    assert.equal(r.body.status, 'paid');
    const s = await subOf(companyId);
    assert.equal(s.state, 'active');
    assert.equal(s.plan, 'tasks');
    assert.equal(s.gateway, 'cashfree');
    assert.equal(await invoiceCount(companyId), 1);
    const again = await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    assert.equal(again.body.attempt, 'paid');
    const hook = await webhook(paymentEvent('PAYMENT_SUCCESS_WEBHOOK', c.orderId, p, c.total / 100));
    assert.equal(hook.status, 200);
    assert.deepEqual(hook.body, { ok: true, duplicate: true });
    assert.equal(await invoiceCount(companyId), 1, 'paid once');
    const view = await call('GET', '/billing', { token: accessToken });
    assert.equal(view.body.gateway, 'cashfree');
    assert.equal(view.body.paysEachPeriod, true);
    const captured = await dbs.db.select().from(payments).where(and(eq(payments.checkoutSessionId, c.sessionId), eq(payments.status, 'captured')));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].gatewayPaymentId, p.cf_payment_id);
  });

  test('paid via the webhook (valid signature, also the dashboard name payment.success); a repeat is a duplicate; the return check then finds it paid', async () => {
    const { accessToken, companyId } = await signup('asha@hook.test', 'Hook Traders');
    const c = await startCheckout(accessToken);
    const p = pay(c.orderId, 'SUCCESS');
    const first = await webhook(paymentEvent('payment.success', c.orderId, p, c.total / 100));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body, { ok: true, duplicate: false });
    assert.equal((await subOf(companyId)).state, 'active');
    const second = await webhook(paymentEvent('PAYMENT_SUCCESS_WEBHOOK', c.orderId, p, c.total / 100));
    assert.deepEqual(second.body, { ok: true, duplicate: true });
    const check = await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    assert.equal(check.body.attempt, 'paid');
    assert.equal(await invoiceCount(companyId), 1);
  });

  test('signature: wrong secret, changed body or no headers → 400 and nothing changes; a test event with a good signature → 200', async () => {
    const { accessToken, companyId } = await signup('asha@sig.test', 'Signature Traders');
    const c = await startCheckout(accessToken);
    const p = pay(c.orderId, 'SUCCESS');
    const ev = paymentEvent('PAYMENT_SUCCESS_WEBHOOK', c.orderId, p, c.total / 100);
    assert.equal((await webhook(ev, { secret: 'not-the-secret-key' })).status, 400);
    assert.equal((await webhook(ev, { tamper: (raw) => raw.replace(`"payment_amount":${p.payment_amount}`, '"payment_amount":1') })).status, 400);
    const unsigned = await call('POST', '/billing/webhooks/cashfree', { raw: JSON.stringify(ev), headers: { 'x-requested-with': '' } });
    assert.equal(unsigned.status, 400);
    assert.equal((await subOf(companyId)).state, 'trialing');
    const ping = await webhook({ type: 'WEBHOOK', data: { test_object: { test: 'test-message' } }, event_time: new Date().toISOString() }, { idempotencyKey: `ping-${randomBytes(4).toString('hex')}` });
    assert.equal(ping.status, 200, JSON.stringify(ping.body));
    const unknown = await webhook({ type: 'PAYMENT_CHARGES_WEBHOOK', data: { order: { order_id: c.orderId } } });
    assert.equal(unknown.status, 200);
    // The older route spelling still answers.
    const raw = JSON.stringify({ type: 'SOMETHING_NEW', data: {} });
    const ts = String(Date.now());
    const sig = createHmac('sha256', SECRET).update(ts + raw).digest('base64');
    const old = await call('POST', '/billing/webhook/cashfree', { raw, headers: { 'x-requested-with': '', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts } });
    assert.equal(old.status, 200);
  });

  test('failed / dropped attempts keep the checkout open for another try; the clock closes it after it expires', async () => {
    const { accessToken, companyId } = await signup('asha@failed.test', 'Failed Traders');
    const c = await startCheckout(accessToken);
    const f = pay(c.orderId, 'FAILED');
    const hook = await webhook(paymentEvent('payment.failed', c.orderId, f, c.total / 100));
    assert.equal(hook.status, 200);
    assert.equal((await sessionOf(c.sessionId)).status, 'open');
    const fp = await dbs.db.select().from(payments).where(and(eq(payments.checkoutSessionId, c.sessionId), eq(payments.status, 'failed')));
    assert.equal(fp.length, 1);
    assert.match(fp[0].reason!, /declined/);
    // The return URL after the failure: the same payment, recorded once.
    const check = await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    assert.equal(check.body.attempt, 'failed');
    assert.equal(check.body.status, 'open');
    assert.equal((await dbs.db.select().from(payments).where(and(eq(payments.checkoutSessionId, c.sessionId), eq(payments.status, 'failed')))).length, 1);
    // The person gives up (no webhook comes for a dropped payment); after the checkout expires the clock closes it.
    pay(c.orderId, 'USER_DROPPED');
    await dbs.db.update(checkoutSessions).set({ expiresAt: new Date(Date.now() - 10 * 60_000) }).where(eq(checkoutSessions.id, c.sessionId));
    await app.get(BillingService).sweepCashfree();
    assert.equal((await sessionOf(c.sessionId)).status, 'failed');
    assert.equal((await subOf(companyId)).state, 'trialing');
    assert.equal(await invoiceCount(companyId), 0);
  });

  test('an order nobody came back from is found paid by the billing clock; an expired order closes the checkout', async () => {
    const { accessToken, companyId } = await signup('asha@sweep.test', 'Sweep Traders');
    const c = await startCheckout(accessToken);
    pay(c.orderId, 'SUCCESS');
    await dbs.db.update(checkoutSessions).set({ expiresAt: new Date(Date.now() - 10 * 60_000) }).where(eq(checkoutSessions.id, c.sessionId));
    await app.get(BillingService).sweepCashfree();
    assert.equal((await sessionOf(c.sessionId)).status, 'paid');
    assert.equal((await subOf(companyId)).state, 'active');

    const { accessToken: t2 } = await signup('asha@expired.test', 'Expired Traders');
    const d = await startCheckout(t2);
    cf.orders.get(d.orderId)!.order_status = 'EXPIRED';
    const r = await call('POST', '/billing/cashfree/check', { token: t2, body: { sessionId: d.sessionId } });
    assert.equal(r.body.attempt, 'expired');
    assert.equal((await sessionOf(d.sessionId)).status, 'cancelled');
    void accessToken;
  });

  test('amount mismatch is refused (nothing applied, logged); the session stays unpaid', async () => {
    const { accessToken, companyId } = await signup('asha@amount.test', 'Amount Traders');
    const c = await startCheckout(accessToken);
    const p = pay(c.orderId, 'SUCCESS', c.total / 100 - 1);
    const hook = await webhook(paymentEvent('PAYMENT_SUCCESS_WEBHOOK', c.orderId, p, c.total / 100));
    assert.equal(hook.status, 200);
    assert.equal((await sessionOf(c.sessionId)).status, 'open');
    assert.equal((await subOf(companyId)).state, 'trialing');
    assert.equal(await invoiceCount(companyId), 0);
    void accessToken;
  });

  test('another company cannot look up a checkout; the payment session is not in any log row', async () => {
    const a = await signup('asha@owner-a.test', 'Owner A Traders');
    const b = await signup('asha@owner-b.test', 'Owner B Traders');
    const c = await startCheckout(a.accessToken);
    const r = await call('POST', '/billing/cashfree/check', { token: b.accessToken, body: { sessionId: c.sessionId } });
    assert.equal(r.status, 404);
    const stored = await dbs.db.select().from(billingEvents);
    assert.ok(!JSON.stringify(stored).includes(SECRET), 'never the secret key');
    assert.ok(!JSON.stringify(stored).includes(String(c.session.gatewayData?.paymentSessionId)), 'never the payment session id');
  });

  test('renewals: nothing charges by itself; at the period end the plan is past due until the owner pays a new order', async () => {
    const { accessToken, companyId } = await signup('asha@renew.test', 'Renewal Traders');
    const c = await startCheckout(accessToken);
    pay(c.orderId, 'SUCCESS');
    await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: c.sessionId } });
    const s = await subOf(companyId);
    await dbs.db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 60_000), currentPeriodStart: new Date(Date.now() - 31 * 86_400_000) }).where(eq(subscriptions.companyId, companyId));
    await app.get(BillingService).tick(companyId);
    const due = await subOf(companyId);
    assert.equal(due.state, 'past_due');
    assert.equal(await invoiceCount(companyId), 1, 'no invoice without a payment');
    const d = await startCheckout(accessToken);
    pay(d.orderId, 'SUCCESS');
    await call('POST', '/billing/cashfree/check', { token: accessToken, body: { sessionId: d.sessionId } });
    const back = await subOf(companyId);
    assert.equal(back.state, 'active');
    assert.ok(back.currentPeriodEnd! > new Date());
    assert.equal(await invoiceCount(companyId), 2);
    void s;
  });
});
