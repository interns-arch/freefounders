// Razorpay as the payment gateway (PLAN.md §21.4), against a local stand-in for api.razorpay.com: no network, no real
// keys. Run with `npm test` (own process; shares the throwaway `ff_platform_test` database, adds its own rows only).
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
import { gatewayConfig } from './billing/gateway';
import { DbService } from './db/db.service';
import { billingEvents, checkoutSessions, gatewayPlans, invoices, otpCodes, payments, seatChanges, subscriptions } from './db/schema';
import { createApp } from './main';

const KEY_ID = 'rzp_test_FFstandIn0001';
const KEY_SECRET = 'test-key-secret-not-real-0123';
const WEBHOOK_SECRET = 'test-webhook-secret-not-real-0123';
const PASSWORD = 'Razor@2026';
let app: INestApplication;
let base = '';
let dbs: DbService;
let appsStandIn: Server;
let rzpStandIn: Server;
let nextUserId = 5000;

// ─── the Razorpay stand-in ──────────────────────────────────────────────────
interface RzpCall {
  method: string;
  path: string;
  body: any;
  auth: string;
}
const rzp = {
  calls: [] as RzpCall[],
  n: 0,
  /** PATCH /subscriptions/:id answers 400 like a UPI AutoPay subscription. */
  refuseUpdate: false,
  /** GET /subscriptions/:id status; GET /invoices items, per subscription. */
  status: new Map<string, string>(),
  invoices: new Map<string, any[]>(),
};
const rzpCalls = (method: string, prefix: string) => rzp.calls.filter((c) => c.method === method && c.path.startsWith(prefix));

function startRazorpayStandIn() {
  return createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url!, 'http://x');
    const path = url.pathname.replace(/^\/v1/, '');
    const body = raw ? JSON.parse(raw) : null;
    rzp.calls.push({ method: req.method!, path: path + url.search, body, auth: String(req.headers.authorization) });
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`) {
      return json(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    }
    const id = (p: string) => `${p}_${String(++rzp.n).padStart(14, '0')}`;
    if (req.method === 'POST' && path === '/plans') return json(200, { id: id('plan'), entity: 'plan', ...body });
    if (req.method === 'POST' && path === '/subscriptions') return json(200, { id: id('sub'), entity: 'subscription', status: 'created', short_url: 'https://rzp.io/i/test', ...body });
    let m = /^\/subscriptions\/(sub_\w+)$/.exec(path);
    if (m && req.method === 'PATCH') {
      if (rzp.refuseUpdate) return json(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Subscription cannot be updated as the payment method is UPI' } });
      return json(200, { id: m[1], entity: 'subscription', quantity: body.quantity, has_scheduled_changes: true });
    }
    if (m && req.method === 'GET') return json(200, { id: m[1], entity: 'subscription', status: rzp.status.get(m[1]) ?? 'active' });
    m = /^\/subscriptions\/(sub_\w+)\/addons$/.exec(path);
    if (m && req.method === 'POST') return json(200, { id: id('ao'), entity: 'addon', item: body.item });
    m = /^\/subscriptions\/(sub_\w+)\/cancel$/.exec(path);
    if (m && req.method === 'POST') return json(200, { id: m[1], entity: 'subscription', status: 'cancelled' });
    if (req.method === 'GET' && path === '/invoices') return json(200, { entity: 'collection', items: rzp.invoices.get(url.searchParams.get('subscription_id') ?? '') ?? [] });
    return json(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'The requested URL was not found on the server.' } });
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────
interface Res {
  status: number;
  body: any;
  headers: Headers;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string; at?: string } = {}): Promise<Res> {
  const res = await fetch((opts.at ?? base) + path, {
    method,
    redirect: 'manual',
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
  return { status: res.status, body, headers: res.headers };
}

async function signup(identifier: string, name: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const res = await call('POST', '/signup/complete', {
    body: { signupToken: v.body.signupToken, fullName: 'Ravi Owner', password: PASSWORD, company: { name, teamSize: '11-50', industry: 'Retail', state: 'Maharashtra', apps: ['tasks'] } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string };
}

const subOf = async (companyId: string) => (await dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0];
const invoiceCount = async (companyId: string) => (await dbs.db.select().from(invoices).where(eq(invoices.companyId, companyId))).length;
const handlerSignature = (paymentId: string, subscriptionId: string, secret = KEY_SECRET) => createHmac('sha256', secret).update(`${paymentId}|${subscriptionId}`).digest('hex');
const payId = () => `pay_${randomBytes(7).toString('hex')}`;

/** A Razorpay webhook body, signed with the webhook secret (or `secret`). */
async function webhook(event: string, payload: Record<string, unknown>, opts: { id?: string; secret?: string; at?: string } = {}) {
  const raw = JSON.stringify({ entity: 'event', account_id: 'acc_test', event, contains: Object.keys(payload), payload, created_at: Math.floor(Date.now() / 1000) });
  const signature = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(raw).digest('hex');
  return call('POST', '/billing/webhook/razorpay', {
    raw,
    at: opts.at,
    headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': opts.id ?? `evt_${randomBytes(8).toString('hex')}` },
  });
}
const subEntity = (id: string, extra: Record<string, unknown> = {}) => ({ subscription: { entity: { id, entity: 'subscription', status: 'active', ...extra } } });
const payEntity = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({ payment: { entity: { id, entity: 'payment', amount, currency: 'INR', status: 'captured', ...extra } } });

/** Checkout through Razorpay: our session + the Razorpay subscription it made. */
async function startCheckout(token: string, plan = 'tasks', seats = 5, interval: 'month' | 'year' = 'month') {
  const co = await call('POST', '/billing/checkout', { token, body: { plan, interval, seats } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const [s] = await dbs.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, co.body.sessionId));
  assert.ok(s.gatewayRef?.startsWith('sub_'));
  return { sessionId: co.body.sessionId as string, subscriptionId: s.gatewayRef!, total: s.total, session: s, response: co.body };
}

/** A paid Razorpay plan (checkout + the handler's verify). */
async function buy(token: string, plan = 'tasks', seats = 5) {
  const c = await startCheckout(token, plan, seats);
  const paymentId = payId();
  const v = await call('POST', '/billing/razorpay/verify', {
    token,
    body: { sessionId: c.sessionId, razorpay_payment_id: paymentId, razorpay_subscription_id: c.subscriptionId, razorpay_signature: handlerSignature(paymentId, c.subscriptionId) },
  });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, 'paid');
  return { ...c, paymentId };
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
  rzpStandIn = startRazorpayStandIn();
  await new Promise<void>((r) => rzpStandIn.listen(0, '127.0.0.1', r));
  const appsPort = (appsStandIn.address() as AddressInfo).port;
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${appsPort}/tasks/api/internal`;
  process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${appsPort}/assets/api/internal`;
  process.env.OTP_DEV_ECHO = '1';
  process.env.OTP_IP_LIMIT = '0';
  process.env.SELLER_STATE = 'Maharashtra';
  process.env.BILLING_GATEWAY = 'razorpay';
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(rzpStandIn.address() as AddressInfo).port}/v1`;
  delete process.env.FAKE_GATEWAY_SECRET;

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
});

after(async () => {
  await app?.close();
  appsStandIn?.close();
  rzpStandIn?.close();
});

describe('BILLING_GATEWAY and the Razorpay keys (checked at start-up)', () => {
  test('fake by default in dev and on the open demo; production needs razorpay with all three keys', () => {
    const keys = { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' };
    assert.equal(gatewayConfig({ NODE_ENV: 'development' }).name, 'fake');
    assert.equal(gatewayConfig({ NODE_ENV: 'production', DEMO_MODE: '1' }).name, 'fake');
    const prod = gatewayConfig({ NODE_ENV: 'production' });
    assert.equal(prod.name, null);
    assert.match(prod.problem!, /BILLING_GATEWAY=razorpay/);
    assert.equal(gatewayConfig({ NODE_ENV: 'production', BILLING_GATEWAY: 'fake' }).name, null, 'FakePay never takes real customers');
    const ok = gatewayConfig({ NODE_ENV: 'production', BILLING_GATEWAY: 'razorpay', ...keys });
    assert.equal(ok.name, 'razorpay');
    assert.equal(ok.razorpay?.mode, 'test');
    assert.equal(gatewayConfig({ NODE_ENV: 'production', BILLING_GATEWAY: 'Razorpay', ...keys, RAZORPAY_KEY_ID: 'rzp_live_ABC123' }).razorpay?.mode, 'live');
    const missing = gatewayConfig({ BILLING_GATEWAY: 'razorpay', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: 'super-secret-value' });
    assert.equal(missing.name, null);
    assert.equal(missing.problem, 'BILLING_GATEWAY=razorpay but RAZORPAY_WEBHOOK_SECRET is not set');
    assert.ok(!missing.problem!.includes('super-secret-value'), 'never a secret value in the message');
    assert.equal(gatewayConfig({ BILLING_GATEWAY: 'razorpay', ...keys, RAZORPAY_KEY_ID: 'abc' }).name, null, 'not a key id');
    assert.equal(gatewayConfig({ BILLING_GATEWAY: 'stripe' }).name, null);
  });

  test('missing keys: checkout answers 503 "Payments are not set up yet", the rest of the app keeps working', async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const off = await createApp();
    try {
      await off.listen(0, '127.0.0.1');
      const at = `http://127.0.0.1:${(off.getHttpServer().address() as AddressInfo).port}/api/platform`;
      const { accessToken } = await signup('ravi@nokeys.test', 'No Keys Traders');
      const co = await call('POST', '/billing/checkout', { at, token: accessToken, body: { plan: 'tasks', interval: 'month', seats: 5 } });
      assert.equal(co.status, 503);
      assert.match(co.body.message, /Payments are not set up yet/);
      const view = await call('GET', '/billing', { at, token: accessToken });
      assert.equal(view.status, 200);
      assert.equal(view.body.checkoutGateway, null);
      assert.equal((await call('GET', '/auth/me', { at, token: accessToken })).status, 200);
      assert.equal((await call('GET', '/health', { at })).status, 200);
      const hook = await webhook('payment.captured', payEntity(payId(), 100), { at });
      assert.equal(hook.status, 503, 'Razorpay retries later');
    } finally {
      await off.close();
      process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    }
  });
});

describe('Razorpay checkout (PLAN.md §21.4)', () => {
  test('creates the plan once (cached by plan + interval + price) and a subscription: quantity = seats, upfront = our GST total', async () => {
    rzp.calls.length = 0;
    const { accessToken, companyId } = await signup('ravi@plans.test', 'Plan Cache Traders');
    const a = await startCheckout(accessToken, 'tasks', 5);
    assert.equal(a.response.gateway, 'razorpay');
    assert.equal(a.response.checkoutUrl, `/billing/pay/${a.sessionId}`);
    // Tasks ₹99 × 5 = ₹495 + 18% GST (CGST + SGST, Maharashtra) = ₹584.10
    assert.equal(a.total, 58_410);
    const plansMade = rzpCalls('POST', '/plans');
    assert.equal(plansMade.length, 1);
    assert.deepEqual(plansMade[0].body.item.amount, 11_682, '₹99 + 18% GST per user');
    assert.equal(plansMade[0].body.period, 'monthly');
    const [sub] = rzpCalls('POST', '/subscriptions');
    assert.equal(sub.body.quantity, 5);
    assert.equal(sub.body.total_count, 120);
    assert.equal(sub.body.addons[0].item.amount, 58_410, 'the first period is the upfront add-on');
    assert.equal(sub.body.notes.sessionId, a.sessionId);
    assert.equal(sub.body.notes.companyId, companyId);
    assert.ok(Math.abs(sub.body.start_at - (Date.now() / 1000 + 30.5 * 86400)) < 2 * 86400, 'renewals start after the first month');
    assert.ok(sub.auth.startsWith('Basic '));

    // Same price again → the cached plan; yearly → a new one.
    await startCheckout(accessToken, 'tasks', 7);
    assert.equal(rzpCalls('POST', '/plans').length, 1);
    await startCheckout(accessToken, 'tasks', 5, 'year');
    assert.equal(rzpCalls('POST', '/plans').length, 2);
    const cached = await dbs.db.select().from(gatewayPlans).where(and(eq(gatewayPlans.plan, 'tasks'), eq(gatewayPlans.gateway, 'razorpay')));
    assert.deepEqual(cached.map((p) => `${p.interval}:${p.unitPrice}:${p.amount}`).sort(), ['month:9900:11682', 'year:99000:116820']);

    // What the pay page hands to Razorpay Checkout.
    const page = await call('GET', `/billing/checkout/${a.sessionId}`, { token: accessToken });
    assert.equal(page.status, 200);
    assert.equal(page.body.gateway, 'razorpay');
    assert.equal(page.body.razorpay.keyId, KEY_ID);
    assert.equal(page.body.razorpay.subscriptionId, a.subscriptionId);
    assert.equal(page.body.razorpay.amount, 58_410);
    assert.equal(page.body.razorpay.prefill.email, 'ravi@plans.test');
    assert.deepEqual(page.body.razorpay.notes, { companyId, sessionId: a.sessionId });
    assert.equal(page.body.razorpay.callbackPath, `/api/platform/billing/razorpay/callback?session=${a.sessionId}`);
    assert.ok(!JSON.stringify(page.body).includes(KEY_SECRET), 'never the key secret');
  });

  test('verify: a wrong signature is refused; the right one pays once (invoice, active, Razorpay renews); repeats change nothing', async () => {
    const { accessToken, companyId } = await signup('ravi@verify.test', 'Verify Traders');
    const c = await startCheckout(accessToken);
    const paymentId = payId();
    const bad = await call('POST', '/billing/razorpay/verify', {
      token: accessToken,
      body: { sessionId: c.sessionId, razorpay_payment_id: paymentId, razorpay_subscription_id: c.subscriptionId, razorpay_signature: handlerSignature(paymentId, c.subscriptionId, 'wrong-secret') },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /could not be verified/);
    // Signed for another subscription than ours: refused too.
    const other = await call('POST', '/billing/razorpay/verify', {
      token: accessToken,
      body: { sessionId: c.sessionId, razorpay_payment_id: paymentId, razorpay_subscription_id: 'sub_someoneelse', razorpay_signature: handlerSignature(paymentId, 'sub_someoneelse') },
    });
    assert.equal(other.status, 400);
    assert.equal((await subOf(companyId)).state, 'trialing');

    const body = { sessionId: c.sessionId, razorpay_payment_id: paymentId, razorpay_subscription_id: c.subscriptionId, razorpay_signature: handlerSignature(paymentId, c.subscriptionId) };
    const ok = await call('POST', '/billing/razorpay/verify', { token: accessToken, body });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'paid');
    const s = await subOf(companyId);
    assert.equal(s.plan, 'tasks');
    assert.equal(s.state, 'active');
    assert.equal(s.seats, 5);
    assert.equal(s.gateway, 'razorpay');
    assert.equal(s.gatewaySubscriptionId, c.subscriptionId);
    assert.equal(Math.floor(s.currentPeriodEnd!.getTime() / 1000), c.session.gatewayData!.startAt, 'our period ends when Razorpay first renews');
    assert.equal(await invoiceCount(companyId), 1);

    // The same handler again, and the webhooks for the same payment: nothing more.
    assert.equal((await call('POST', '/billing/razorpay/verify', { token: accessToken, body })).status, 200);
    const captured = await webhook('payment.captured', payEntity(paymentId, c.total, { notes: { sessionId: c.sessionId, companyId } }));
    assert.equal(captured.status, 200);
    const authd = await webhook('subscription.authenticated', { ...subEntity(c.subscriptionId, { status: 'authenticated', notes: { sessionId: c.sessionId } }), ...payEntity(paymentId, c.total) });
    assert.equal(authd.status, 200);
    const paidInvoice = await webhook('invoice.paid', { invoice: { entity: { id: 'inv_1', subscription_id: c.subscriptionId, payment_id: paymentId, amount_paid: c.total, status: 'paid' } } });
    assert.equal(paidInvoice.status, 200);
    assert.equal(await invoiceCount(companyId), 1, 'paid once');
    const view = await call('GET', '/billing', { token: accessToken });
    assert.equal(view.body.gateway, 'razorpay');
    assert.equal(view.body.checkoutGateway, 'razorpay');
    assert.equal(view.body.canResume, false);
  });

  test('the webhook alone pays a checkout (verify never came): subscription.charged with the upfront payment', async () => {
    const { accessToken, companyId } = await signup('ravi@hookonly.test', 'Hook Only Traders');
    const c = await startCheckout(accessToken);
    const r = await webhook('subscription.charged', { ...subEntity(c.subscriptionId, { notes: { sessionId: c.sessionId } }), ...payEntity(payId(), c.total) });
    assert.equal(r.status, 200);
    assert.equal((await subOf(companyId)).state, 'active');
    assert.equal(await invoiceCount(companyId), 1);
  });

  test('a failed attempt keeps the checkout open for another try; the redirect-mode callback (phone app) verifies and redirects', async () => {
    const { accessToken, companyId } = await signup('ravi@callback.test', 'Callback Traders');
    const c = await startCheckout(accessToken);
    const failed = await webhook('payment.failed', payEntity(payId(), c.total, { status: 'failed', error_description: 'Payment declined by bank', notes: { sessionId: c.sessionId } }));
    assert.equal(failed.status, 200);
    const [s1] = await dbs.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, c.sessionId));
    assert.equal(s1.status, 'open');
    const fp = await dbs.db.select().from(payments).where(and(eq(payments.checkoutSessionId, c.sessionId), eq(payments.status, 'failed')));
    assert.equal(fp[0].reason, 'Payment declined by bank');

    const form = (fields: Record<string, string>) =>
      fetch(`${base}/billing/razorpay/callback?session=${c.sessionId}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    const wrong = await form({ razorpay_payment_id: 'pay_x1', razorpay_subscription_id: c.subscriptionId, razorpay_signature: 'a'.repeat(64) });
    assert.equal(wrong.status, 303);
    assert.equal(wrong.headers.get('location'), `/billing/pay/${c.sessionId}?result=failed`);
    const errorForm = await form({ 'error[code]': 'BAD_REQUEST_ERROR', 'error[description]': 'Payment failed' });
    assert.equal(errorForm.headers.get('location'), `/billing/pay/${c.sessionId}?result=failed`);
    assert.equal((await subOf(companyId)).state, 'trialing');
    const paymentId = payId();
    const good = await form({ razorpay_payment_id: paymentId, razorpay_subscription_id: c.subscriptionId, razorpay_signature: handlerSignature(paymentId, c.subscriptionId) });
    assert.equal(good.status, 303);
    assert.equal(good.headers.get('location'), `/billing/pay/${c.sessionId}?result=paid`);
    assert.equal((await subOf(companyId)).state, 'active');
  });
});

describe('Razorpay webhooks (the source of truth)', () => {
  test('signature: wrong secret or a changed body → 400; the same event id twice is stored once', async () => {
    const bad = await webhook('payment.captured', payEntity(payId(), 100), { secret: 'not-the-webhook-secret' });
    assert.equal(bad.status, 400);
    const raw = JSON.stringify({ entity: 'event', event: 'payment.captured', payload: {} });
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const tampered = await call('POST', '/billing/webhook/razorpay', { raw: raw.replace('captured', 'failed'), headers: { 'x-razorpay-signature': sig } });
    assert.equal(tampered.status, 400);
    const unsigned = await call('POST', '/billing/webhook/razorpay', { raw });
    assert.equal(unsigned.status, 400);

    const id = `evt_dup_${randomBytes(4).toString('hex')}`;
    const first = await webhook('subscription.updated', subEntity('sub_unknown'), { id });
    assert.deepEqual(first.body, { ok: true, duplicate: false });
    const again = await webhook('subscription.updated', subEntity('sub_unknown'), { id });
    assert.deepEqual(again.body, { ok: true, duplicate: true });
    assert.equal((await dbs.db.select().from(billingEvents).where(eq(billingEvents.eventId, id))).length, 1);
  });

  test('renewal: subscription.charged → a new period + GST invoice; invoice.paid for the same payment adds nothing', async () => {
    const { accessToken, companyId } = await signup('ravi@renew.test', 'Renewal Traders');
    const c = await buy(accessToken);
    const start = Math.floor(Date.now() / 1000) + 30 * 86400;
    const end = start + 31 * 86400;
    const paymentId = payId();
    const r = await webhook('subscription.charged', { ...subEntity(c.subscriptionId, { current_start: start, current_end: end, paid_count: 1 }), ...payEntity(paymentId, 58_410) });
    assert.equal(r.status, 200);
    const s = await subOf(companyId);
    assert.equal(s.state, 'active');
    assert.equal(s.currentPeriodStart!.getTime(), start * 1000);
    assert.equal(s.currentPeriodEnd!.getTime(), end * 1000);
    assert.equal(await invoiceCount(companyId), 2);
    const [latest] = await dbs.db.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(invoices.seq).then((rows) => rows.slice(-1));
    assert.equal(latest.total, 58_410);
    assert.equal(latest.cgst + latest.sgst, 8_910);
    const dup = await webhook('invoice.paid', { invoice: { entity: { id: 'inv_2', subscription_id: c.subscriptionId, payment_id: paymentId, amount_paid: 58_410, billing_start: start, billing_end: end, status: 'paid' } } });
    assert.equal(dup.status, 200);
    assert.equal(await invoiceCount(companyId), 2);
    // Another company's subscription id changes nothing here.
    await webhook('subscription.charged', { ...subEntity('sub_notours'), ...payEntity(payId(), 58_410) });
    assert.equal(await invoiceCount(companyId), 2);
  });

  test('pending / halted → past_due; a later charge → active again; cancelled at Razorpay → cancelled at the period end', async () => {
    const { accessToken, companyId } = await signup('ravi@pastdue.test', 'Past Due Traders');
    const c = await buy(accessToken);
    const p = await webhook('subscription.pending', { ...subEntity(c.subscriptionId, { status: 'pending' }), ...payEntity(payId(), 58_410, { status: 'failed', error_description: 'Insufficient funds' }) });
    assert.equal(p.status, 200);
    assert.equal((await subOf(companyId)).state, 'past_due');
    const failedPayments = await dbs.db.select().from(payments).where(and(eq(payments.companyId, companyId), eq(payments.status, 'failed')));
    assert.equal(failedPayments[0].reason, 'Insufficient funds');
    await webhook('subscription.halted', subEntity(c.subscriptionId, { status: 'halted' }));
    assert.equal((await subOf(companyId)).state, 'past_due');
    await webhook('subscription.charged', { ...subEntity(c.subscriptionId), ...payEntity(payId(), 58_410) });
    assert.equal((await subOf(companyId)).state, 'active');

    // halted straight from active
    await webhook('subscription.halted', subEntity(c.subscriptionId, { status: 'halted' }));
    assert.equal((await subOf(companyId)).state, 'past_due');
    await webhook('subscription.charged', { ...subEntity(c.subscriptionId), ...payEntity(payId(), 58_410) });

    await webhook('subscription.cancelled', subEntity(c.subscriptionId, { status: 'cancelled' }));
    const s = await subOf(companyId);
    assert.equal(s.state, 'cancelled');
    assert.equal(s.cancelAtPeriodEnd, true);
  });
});

describe('Razorpay seats, cancel and the billing clock', () => {
  test('more users: quantity from the next cycle + the pro-rata amount with GST as an add-on; UPI refusal changes nothing', async () => {
    const { accessToken, companyId } = await signup('ravi@seats.test', 'Seat Change Traders');
    const c = await buy(accessToken);
    rzp.calls.length = 0;
    const more = await call('POST', '/billing/seats', { token: accessToken, body: { seats: 8 } });
    assert.equal(more.status, 200, JSON.stringify(more.body));
    const [patch] = rzpCalls('PATCH', `/subscriptions/${c.subscriptionId}`);
    assert.deepEqual({ quantity: patch.body.quantity, when: patch.body.schedule_change_at }, { quantity: 8, when: 'cycle_end' });
    const [addon] = rzpCalls('POST', `/subscriptions/${c.subscriptionId}/addons`);
    const [change] = await dbs.db.select().from(seatChanges).where(eq(seatChanges.companyId, companyId));
    assert.ok(change.amount > 0);
    assert.equal(addon.body.item.amount, change.amount + 2 * Math.round((change.amount * 18) / 200), 'pro rata + GST');
    assert.equal((await subOf(companyId)).seats, 8);

    const fewer = await call('POST', '/billing/seats', { token: accessToken, body: { seats: 6 } });
    assert.equal(fewer.status, 200);
    assert.equal(rzpCalls('PATCH', `/subscriptions/${c.subscriptionId}`).slice(-1)[0].body.quantity, 6);
    assert.equal((await subOf(companyId)).nextPeriodSeats, 6);

    rzp.refuseUpdate = true;
    try {
      const refused = await call('POST', '/billing/seats', { token: accessToken, body: { seats: 12 } });
      assert.equal(refused.status, 400);
      assert.match(refused.body.message, /UPI AutoPay/);
      assert.equal((await subOf(companyId)).seats, 8, 'nothing kept');
      assert.equal((await dbs.db.select().from(seatChanges).where(eq(seatChanges.companyId, companyId))).length, 1);
    } finally {
      rzp.refuseUpdate = false;
    }
  });

  test('cancel stops Razorpay at once and keeps the paid period; resume says to choose the plan again; buying again cancels the old one', async () => {
    const { accessToken, companyId } = await signup('ravi@cancel.test', 'Cancel Traders');
    const c = await buy(accessToken);
    rzp.calls.length = 0;
    const res = await call('POST', '/billing/cancel', { token: accessToken });
    assert.equal(res.status, 200);
    assert.deepEqual(rzpCalls('POST', `/subscriptions/${c.subscriptionId}/cancel`)[0].body, { cancel_at_cycle_end: false });
    assert.equal(res.body.state, 'cancelled');
    assert.equal(res.body.cancelAtPeriodEnd, true);
    const resume = await call('POST', '/billing/resume', { token: accessToken });
    assert.equal(resume.status, 400);
    assert.match(resume.body.message, /Choose the plan again/);

    // Choosing it again: a new subscription; the old one is cancelled (again) once the new one is paid.
    rzp.calls.length = 0;
    const again = await buy(accessToken, 'tasks', 6);
    assert.notEqual(again.subscriptionId, c.subscriptionId);
    assert.equal(rzpCalls('POST', `/subscriptions/${c.subscriptionId}/cancel`).length, 1);
    const s = await subOf(companyId);
    assert.equal(s.gatewaySubscriptionId, again.subscriptionId);
    assert.equal(s.state, 'active');
  });

  test('billing clock without webhooks: looks the renewal up at Razorpay (paid → new period; not yet → waits; halted → past_due)', async () => {
    const billing = app.get(BillingService);
    const { accessToken, companyId } = await signup('ravi@clock.test', 'Clock Traders');
    const c = await buy(accessToken);
    const ended = new Date(Date.now() - 3600_000);
    await dbs.db.update(subscriptions).set({ currentPeriodEnd: ended }).where(eq(subscriptions.companyId, companyId));

    // Not charged yet (within the grace): nothing changes.
    assert.equal(await billing.tick(companyId), false);
    assert.equal((await subOf(companyId)).state, 'active');

    const start = Math.floor(ended.getTime() / 1000);
    const paymentId = payId();
    rzp.invoices.set(c.subscriptionId, [{ id: 'inv_c1', status: 'paid', payment_id: paymentId, amount_paid: 58_410, billing_start: start, billing_end: start + 30 * 86400 }]);
    assert.equal(await billing.tick(companyId), true);
    const s = await subOf(companyId);
    assert.equal(s.state, 'active');
    assert.equal(s.currentPeriodEnd!.getTime(), (start + 30 * 86400) * 1000);
    assert.equal(await invoiceCount(companyId), 2);
    // The webhook for that same charge arrives late: counted once.
    await webhook('subscription.charged', { ...subEntity(c.subscriptionId), ...payEntity(paymentId, 58_410) });
    assert.equal(await invoiceCount(companyId), 2);

    // Next period ends, Razorpay halted: past due.
    await dbs.db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 3600_000) }).where(eq(subscriptions.companyId, companyId));
    rzp.invoices.delete(c.subscriptionId);
    rzp.status.set(c.subscriptionId, 'halted');
    await billing.tick(companyId);
    assert.equal((await subOf(companyId)).state, 'past_due');
    // Ticking again does not pile up failed payments.
    const failedBefore = (await dbs.db.select().from(payments).where(and(eq(payments.companyId, companyId), eq(payments.status, 'failed')))).length;
    await billing.tick(companyId);
    assert.equal((await dbs.db.select().from(payments).where(and(eq(payments.companyId, companyId), eq(payments.status, 'failed')))).length, failedBefore);
  });
});
