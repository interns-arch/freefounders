// "Buy now" without the trial (PLAN.md §24.4) and the GST invoice email (§24.5). Run with `npm test` (shares the
// throwaway `ff_platform_test` database with the other tests; only adds its own rows). No network: the apps and Resend
// are local stand-ins; the Resend key is a dummy.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { normaliseIdentifier } from './accounts/identifier';
import { BillingService } from './billing/billing.service';
import { sellerProblem, TEST_SELLER_GSTIN } from './billing/gst';
import { invoiceEmail, recipients } from './billing/invoice-mail';
import { DbService } from './db/db.service';
import { accounts, companies, invoices, otpCodes, people, staffAudit, subscriptions } from './db/schema';
import { createApp } from './main';

const PASSWORD = 'Signup@2026';
const KEY = 're_dummy_key_for_tests_only';
let app: INestApplication;
let base = '';
let dbs: DbService;
let billing: BillingService;
let stand: Server;
/** What the app stand-ins received; a new company's POST /companies names it in the body (`companyId`). */
const appCalls: Array<{ app: string; path: string; cid: unknown; companyId?: string }> = [];
/** What the Resend stand-in received. */
const mails: Array<{ auth: string; body: any }> = [];
let resendStatus = 200;
let nextUserId = 5000;

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const tag = () => randomUUID().replace(/-/g, '').slice(0, 8);

async function signupToken(identifier: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.signupToken as string;
}

/** Sign-up; with `buy` the "Buy now" path (PLAN.md §24.4). */
async function signup(email: string, name: string, buy?: Record<string, unknown>) {
  const token = await signupToken(email);
  const res = await call('POST', '/signup/complete', {
    body: { signupToken: token, fullName: 'Ravi Buyer', password: PASSWORD, username: `u${tag()}${tag()}`, company: { name, state: 'Maharashtra', apps: ['tasks'] }, ...(buy ? { buy } : {}) },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string; pendingPayment?: boolean; checkout: { sessionId: string; checkoutUrl: string; gateway: string } | null; checkoutError: string | null };
}

const sub = async (companyId: string) => (await dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0];
const pay = (token: string, sessionId: string, outcome: 'success' | 'failure' | 'cancel' = 'success') => call('POST', `/billing/fake/${sessionId}/complete`, { token, body: { outcome } });
const refreshToken = async (email: string) => {
  const r = await call('POST', '/auth/login', { body: { login: email, password: PASSWORD } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken as string;
};

before(async () => {
  // Stand-ins: the Tasks / Assets internal API (enough for a new company) and Resend's POST /emails.
  stand = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.url === '/resend/emails') {
      mails.push({ auth: String(req.headers.authorization), body: JSON.parse(raw) });
      return resendStatus === 200 ? json(200, { id: `re_${tag()}` }) : json(resendStatus, { statusCode: resendStatus, name: 'validation_error', message: 'The domain is not verified' });
    }
    const appName = req.url!.startsWith('/assets') ? 'assets' : 'tasks';
    const path = req.url!.replace(/^\/(tasks|assets)\/api\/internal/, '').split('?')[0];
    const body = raw ? JSON.parse(raw) : null;
    appCalls.push({ app: appName, path, cid: decodeJwt(String(req.headers.authorization).slice(7)).cid, companyId: body?.companyId });
    if (req.method === 'POST' && path === '/companies') return json(201, { companyId: body.companyId, schema: `co_${String(body.code).toLowerCase()}`, created: true });
    if (req.method === 'POST' && path === '/provision') return json(200, { userId: nextUserId++ });
    if (path === '/permissions') return json(200, { app: appName, scopes: [], permissions: [{ key: `${appName}.view`, label: 'See', group: 'All', scopes: null }] });
    if (req.method === 'GET' && path === '/access') return json(200, { version: 0, roles: [], people: [] });
    if (req.method === 'PUT' && path === '/access') return json(200, { applied: true, problems: [] });
    if (path === '/modules') return json(200, { app: appName, modules: [{ key: 'm1', label: 'M1', description: '', default: true }] });
    if (req.method === 'PUT' && path === '/company') return json(200, { version: body.version, applied: true });
    if (req.method === 'GET' && path === '/people') return json(200, { departments: [], people: [] });
    if (req.method === 'PUT' && path === '/people') return json(200, { version: body.version, applied: true });
    if (path === '/events' || path === '/roles') return json(200, []);
    return json(404, { detail: 'not here' });
  });
  await new Promise<void>((r) => stand.listen(0, '127.0.0.1', r));
  const port = (stand.address() as AddressInfo).port;
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${port}/tasks/api/internal`;
  process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${port}/assets/api/internal`;
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}/resend`;
  process.env.RESEND_API_KEY = KEY;
  process.env.RESEND_FROM = 'Kaampilot <billing@kaampilot.test>';
  process.env.OTP_DEV_ECHO = '1';
  process.env.OTP_IP_LIMIT = '0';
  process.env.BILLING_DEV_TOOLS = '1';
  process.env.FAKE_GATEWAY_SECRET = 'test-fakepay-secret-0123456789';
  process.env.SELLER_STATE = 'Maharashtra';
  process.env.PUBLIC_WEB_URL = 'https://app.kaampilot.test';
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
  billing = app.get(BillingService);
});

after(async () => {
  await app?.close();
  stand?.close();
});

beforeEach(() => {
  mails.length = 0;
  resendStatus = 200;
  process.env.RESEND_API_KEY = KEY;
});

describe('Buy now (PLAN.md §24.4)', () => {
  test('sign-up with a plan → pending payment (no trial, apps not set up, writes refused) → FakePay → active at once, apps set up, no trial', async () => {
    const t = tag();
    const email = `buy-${t}@buyer.test`;
    appCalls.length = 0;
    const out = await signup(email, `Buy Now ${t} Pvt Ltd`, { plan: 'modules', modules: ['tasks', 'attendance'], ai: false, seats: 5 });
    assert.equal(out.pendingPayment, true);
    assert.ok(out.checkout?.sessionId, JSON.stringify(out));
    assert.equal(out.checkout?.checkoutUrl, `/billing/pay/${out.checkout?.sessionId}`);
    assert.equal(out.checkoutError, null);

    let s = await sub(out.companyId);
    assert.equal(s.state, 'pending_payment');
    assert.equal(s.plan, 'modules');
    assert.deepEqual(s.modules, ['tasks', 'attendance']);
    assert.equal(s.seats, 5);
    assert.equal(s.trialEndsAt, null, 'no trial');
    assert.equal(s.setupPending, true);
    assert.ok(Math.abs(s.payBy!.getTime() - Date.now() - 7 * 86400_000) < 60_000, 'cleaned up after 7 days');
    const [c] = await dbs.db.select().from(companies).where(eq(companies.id, out.companyId));
    assert.deepEqual(c.enabledApps, ['tasks'], 'the plan’s apps');
    assert.ok(!appCalls.some((x) => x.cid === out.companyId || x.companyId === out.companyId), 'nothing set up in the apps before payment');

    // Signed in, waiting: /auth/me says so; changes are refused with "finish the payment"; Billing works.
    const me = await call('GET', '/auth/me', { token: out.accessToken });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.billing.state, 'pending_payment');
    assert.equal(me.body.billing.readOnly, true);
    assert.equal(me.body.billing.daysLeft, 7);
    const write = await call('POST', '/invites', { token: out.accessToken, body: { apps: ['tasks'], expiresInDays: 7, maxUses: 2 } });
    assert.equal(write.status, 402);
    assert.equal(write.body.message, 'Finish the payment to start using Kaampilot.');
    const view = await call('GET', '/billing', { token: out.accessToken });
    assert.equal(view.status, 200);
    assert.equal(view.body.state, 'pending_payment');
    assert.equal(view.body.pending.canStartTrial, true);
    assert.equal(view.body.pending.seats, 5);
    assert.equal(view.body.pending.perUser, 19800);
    assert.equal(view.body.pending.openCheckout.sessionId, out.checkout!.sessionId);
    const co = await call('GET', `/billing/checkout/${out.checkout!.sessionId}`, { token: out.accessToken });
    assert.equal(co.body.planName, 'Tasks + Attendance');
    assert.equal(co.body.seats, 5);
    assert.equal(co.body.total, Math.round(5 * 19800 * 1.18));

    // Paid: active from now for a month, apps set up with the plan, invoice made and emailed, no trial recorded.
    const paid = await pay(out.accessToken, out.checkout!.sessionId);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.status, 'paid');
    s = await sub(out.companyId);
    assert.equal(s.state, 'active');
    assert.equal(s.trialEndsAt, null, 'no trial recorded');
    assert.equal(s.setupPending, false);
    assert.equal(s.payBy, null);
    assert.ok(s.currentPeriodEnd && s.currentPeriodEnd.getTime() - s.currentPeriodStart!.getTime() > 27 * 86400_000);
    assert.ok(appCalls.some((x) => x.app === 'tasks' && x.path === '/companies' && x.companyId === out.companyId), 'set up in Tasks after payment');
    assert.ok(appCalls.some((x) => x.app === 'tasks' && x.path === '/provision' && x.cid === out.companyId), 'the owner gets Tasks');
    assert.ok(!appCalls.some((x) => x.app === 'assets' && x.cid === out.companyId), 'only the plan’s apps');
    const token = await refreshToken(email);
    assert.deepEqual(Object.keys((decodeJwt(token) as { apps: Record<string, string> }).apps), ['tasks'], 'the owner has the app now');
    const me2 = await call('GET', '/auth/me', { token });
    assert.equal(me2.body.billing.state, 'active');
    assert.equal(me2.body.billing.readOnly, false);
    assert.deepEqual(me2.body.billing.modules, ['tasks', 'attendance']);

    // The GST invoice by email, with the PDF attached (PLAN.md §24.5).
    const list = await call('GET', '/billing/invoices', { token });
    assert.equal(list.body.length, 1);
    const inv = list.body[0];
    assert.ok(inv.emailedAt, JSON.stringify(inv));
    assert.deepEqual(inv.emailedTo, [email]);
    assert.equal(inv.emailError, null);
    assert.equal(mails.length, 1);
    const m = mails[0];
    assert.equal(m.auth, `Bearer ${KEY}`);
    assert.equal(m.body.from, 'Kaampilot <billing@kaampilot.test>');
    assert.deepEqual(m.body.to, [email]);
    assert.match(m.body.subject, new RegExp(`^Kaampilot invoice ${inv.number.replace(/\//g, '\\/')} for \\d+ \\w{3} \\d{4} – \\d+ \\w{3} \\d{4}$`));
    assert.equal(m.body.attachments.length, 1);
    assert.equal(m.body.attachments[0].filename, `invoice-${inv.number.replace(/\//g, '-')}.pdf`);
    assert.equal(Buffer.from(m.body.attachments[0].content, 'base64').subarray(0, 5).toString(), '%PDF-', 'a PDF, base64');
    assert.match(m.body.text, /https:\/\/app\.kaampilot\.test\/billing/);
  });

  test('payment not finished: Pay again, then "Start the free trial instead" (once); the plan from the URL is refused when bad', async () => {
    const t = tag();
    const email = `retry-${t}@buyer.test`;
    const out = await signup(email, `Retry Buyer ${t}`, { plan: 'complete', ai: true, seats: 3 });
    const failed = await pay(out.accessToken, out.checkout!.sessionId, 'failure');
    assert.equal(failed.status, 200);
    assert.equal((await sub(out.companyId)).state, 'pending_payment', 'a failed payment changes nothing');
    const view = await call('GET', '/billing', { token: out.accessToken });
    assert.equal(view.body.pending.openCheckout, null);
    assert.equal(view.body.planName, 'Complete with AI');
    // Pay again: a new checkout with the chosen plan.
    const again = await call('POST', '/billing/checkout', { token: out.accessToken, body: { plan: 'complete', ai: true, interval: 'month', seats: 3 } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    // …or the free trial instead: the apps are set up now.
    appCalls.length = 0;
    const trial = await call('POST', '/billing/start-trial', { token: out.accessToken });
    assert.equal(trial.status, 200, JSON.stringify(trial.body));
    assert.equal(trial.body.state, 'trialing');
    assert.equal(trial.body.setupIncomplete, false);
    const s = await sub(out.companyId);
    assert.equal(s.plan, 'complete');
    assert.equal(s.setupPending, false);
    assert.equal(s.payBy, null);
    assert.ok(s.trialEndsAt && s.trialEndsAt.getTime() > Date.now() + 9 * 86400_000);
    assert.ok(appCalls.some((x) => x.path === '/companies' && x.companyId === out.companyId));
    const twice = await call('POST', '/billing/start-trial', { token: await refreshToken(email) });
    assert.equal(twice.status, 400);

    // A bad plan in "Buy now" is refused before anything is made.
    const token = await signupToken(`bad-${t}@buyer.test`);
    const bad = await call('POST', '/signup/complete', {
      body: { signupToken: token, fullName: 'Bad Plan', password: PASSWORD, username: `u${tag()}${tag()}`, company: { name: `Bad Plan ${t}`, apps: ['tasks'] }, buy: { plan: 'suite', seats: 2 } },
    });
    assert.equal(bad.status, 400);
    assert.equal((await dbs.db.select().from(companies).where(eq(companies.name, `Bad Plan ${t}`))).length, 0);
  });

  test('a trial company that pays: the trial ends at once', async () => {
    const t = tag();
    const out = await signup(`trial-${t}@buyer.test`, `Trial Payer ${t}`);
    assert.equal((await sub(out.companyId)).state, 'trialing');
    const co = await call('POST', '/billing/checkout', { token: out.accessToken, body: { plan: 'complete', interval: 'month', seats: 3 } });
    assert.equal(co.status, 200, JSON.stringify(co.body));
    await pay(out.accessToken, co.body.sessionId);
    const view = await call('GET', '/billing', { token: out.accessToken });
    assert.equal(view.body.state, 'active');
    assert.equal(view.body.seats.limit, 3, 'paid seats, no trial limit');
  });

  test('not paid within 7 days: the billing clock removes the company and its new account; a company with more data is kept', async () => {
    const t = tag();
    const email = `gone-${t}@buyer.test`;
    const out = await signup(email, `Gone Buyer ${t}`, { plan: 'modules', modules: ['assets'], seats: 2 });
    const [{ accountId }] = await dbs.db.select({ accountId: people.accountId }).from(people).where(eq(people.companyId, out.companyId));
    await dbs.db.update(subscriptions).set({ clockOffsetDays: 6 }).where(eq(subscriptions.companyId, out.companyId));
    await billing.tick(out.companyId);
    assert.ok(await sub(out.companyId), 'day 6: still waiting');
    await dbs.db.update(subscriptions).set({ clockOffsetDays: 8 }).where(eq(subscriptions.companyId, out.companyId));
    await billing.tick(out.companyId);
    assert.equal(await sub(out.companyId), undefined);
    assert.equal((await dbs.db.select().from(companies).where(eq(companies.id, out.companyId))).length, 0, 'company removed');
    assert.equal((await dbs.db.select().from(accounts).where(eq(accounts.id, accountId!))).length, 0, 'its new account too');
    // The name is free again: sign up with it.
    const back = await signup(email, `Gone Buyer ${t}`);
    assert.ok(back.companyId);

    const kept = await signup(`kept-${t}@buyer.test`, `Kept Buyer ${t}`, { plan: 'complete', seats: 2 });
    await dbs.db.insert(people).values({ companyId: kept.companyId, fullName: 'Someone Else' });
    await dbs.db.update(subscriptions).set({ clockOffsetDays: 8 }).where(eq(subscriptions.companyId, kept.companyId));
    await billing.runAll();
    assert.equal((await sub(kept.companyId)).state, 'pending_payment', 'more than the owner: kept for staff');
  });

  test('console: pending companies listed with their plan; extend; mark paid sets up the apps; billing email; send again (audited)', async () => {
    const t = tag();
    const out = await signup(`pend-${t}@buyer.test`, `Pending Co ${t}`, { plan: 'modules', modules: ['tasks'], ai: true, seats: 4 });
    const staffEmail = `staff-${t}@kaampilot.test`;
    const staff = await signup(staffEmail, `Staff Co ${t}`);
    await dbs.db.update(accounts).set({ isStaff: true }).where(eq(accounts.email, staffEmail));
    const sum = await call('GET', '/console/summary', { token: staff.accessToken });
    assert.ok(sum.body.pendingPayment >= 1);
    assert.equal(sum.body.invoiceEmail, null, 'emails can go out here');
    const list = await call('GET', '/console/companies', { token: staff.accessToken });
    const row = list.body.find((c: { id: string }) => c.id === out.companyId);
    assert.equal(row.state, 'pending_payment');
    assert.equal(row.planName, 'Tasks with AI');
    assert.equal(row.seats.paid, 4);
    assert.ok(row.payBy);
    const ext = await call('POST', `/console/companies/${out.companyId}/pending-extend`, { token: staff.accessToken, body: { days: 3 } });
    assert.equal(ext.status, 200, JSON.stringify(ext.body));
    assert.ok(new Date(ext.body.payBy).getTime() - new Date(row.payBy).getTime() >= 3 * 86400_000 - 1000);
    const notStaff = await call('POST', `/console/companies/${out.companyId}/mark-paid`, { token: out.accessToken });
    assert.equal(notStaff.status, 403);
    appCalls.length = 0;
    const paid = await call('POST', `/console/companies/${out.companyId}/mark-paid`, { token: staff.accessToken });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.state, 'active');
    const s = await sub(out.companyId);
    assert.equal(s.setupPending, false);
    assert.equal(s.trialEndsAt, null);
    assert.deepEqual(s.modules, ['tasks']);
    assert.equal(s.ai, true);
    assert.ok(appCalls.some((x) => x.path === '/companies' && x.companyId === out.companyId), 'apps set up');
    const again = await call('POST', `/console/companies/${out.companyId}/mark-paid`, { token: staff.accessToken });
    assert.equal(again.status, 400);

    // Billing email (console) → invoices go to the owner and there; "Send again" from the console and from Billing.
    const be = await call('PUT', `/console/companies/${out.companyId}/billing-email`, { token: staff.accessToken, body: { email: 'Accounts@Pending.test' } });
    assert.equal(be.status, 200, JSON.stringify(be.body));
    const owner = await refreshToken(`pend-${t}@buyer.test`);
    const co = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'modules', modules: ['tasks'], ai: true, interval: 'month', seats: 4 } });
    await pay(owner, co.body.sessionId);
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].body.to, [`pend-${t}@buyer.test`, 'accounts@pending.test']);
    const [inv] = await dbs.db.select().from(invoices).where(eq(invoices.companyId, out.companyId));
    mails.length = 0;
    const resend = await call('POST', `/console/invoices/${inv.id}/email`, { token: staff.accessToken });
    assert.equal(resend.status, 200, JSON.stringify(resend.body));
    assert.equal(resend.body.sent, true);
    assert.equal(mails.length, 1);
    const audit = await dbs.db.select().from(staffAudit).where(eq(staffAudit.companyId, out.companyId));
    assert.deepEqual(audit.map((a) => a.action).sort(), ['billing.email', 'invoice.email', 'pending.extend', 'pending.mark_paid']);
    const detail = await call('GET', `/console/dashboard/companies/${out.companyId}`, { token: staff.accessToken });
    assert.equal(detail.status, 200);
    assert.ok(detail.body.invoices[0].emailedAt);
    assert.equal(detail.body.billingProfile.email, 'accounts@pending.test');
  });

  test('Send again (Billing → Invoices): owner only for its own invoices; Resend errors are stored, never fail the payment', async () => {
    const t = tag();
    const email = `again-${t}@buyer.test`;
    const out = await signup(email, `Send Again ${t}`, { plan: 'complete', seats: 1 });
    resendStatus = 403;
    const paid = await pay(out.accessToken, out.checkout!.sessionId);
    assert.equal(paid.body.status, 'paid', 'the payment stands');
    const token = await refreshToken(email);
    let [inv] = (await call('GET', '/billing/invoices', { token })).body;
    assert.equal(inv.emailedAt, null);
    assert.match(inv.emailError, /Resend 403/);
    resendStatus = 200;
    mails.length = 0;
    const again = await call('POST', `/billing/invoices/${inv.id}/email`, { token });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.to, [email]);
    assert.equal(mails.length, 1);
    [inv] = (await call('GET', '/billing/invoices', { token })).body;
    assert.ok(inv.emailedAt);
    assert.equal(inv.emailError, null);
    // Another company's invoice: not found.
    const other = await signup(`other-${t}@buyer.test`, `Other Co ${t}`);
    const nope = await call('POST', `/billing/invoices/${inv.id}/email`, { token: other.accessToken });
    assert.equal(nope.status, 404);
  });

  test('no Resend key: not sent, the reason stored; production with the test seller: not sent, "Seller GST details not set"', async () => {
    const t = tag();
    const email = `nokey-${t}@buyer.test`;
    const out = await signup(email, `No Key ${t}`, { plan: 'complete', seats: 1 });
    delete process.env.RESEND_API_KEY;
    await pay(out.accessToken, out.checkout!.sessionId);
    assert.equal(mails.length, 0);
    const [inv] = await dbs.db.select().from(invoices).where(eq(invoices.companyId, out.companyId));
    assert.equal(inv.emailedAt, null);
    assert.equal(inv.emailError, 'Email is not set up (RESEND_API_KEY)');

    process.env.RESEND_API_KEY = KEY;
    const saved = { NODE_ENV: process.env.NODE_ENV, SELLER_GSTIN: process.env.SELLER_GSTIN };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SELLER_GSTIN;
      const r = await billing.emailInvoice(inv.id);
      assert.equal(r.sent, false);
      assert.match(r.error!, /^Seller GST details not set/);
      assert.equal(mails.length, 0, 'nothing sent');
      assert.match(billing.invoiceEmailProblem()!, /^Seller GST details not set/);
    } finally {
      process.env.NODE_ENV = saved.NODE_ENV;
      if (saved.SELLER_GSTIN === undefined) delete process.env.SELLER_GSTIN;
      else process.env.SELLER_GSTIN = saved.SELLER_GSTIN;
    }
  });
});

describe('invoice email pieces (PLAN.md §24.5)', () => {
  test('seller check only in production; real-looking values pass', () => {
    assert.equal(sellerProblem({ NODE_ENV: 'test' }), null);
    assert.match(sellerProblem({ NODE_ENV: 'production' })!, /SELLER_GSTIN is empty or the test value/);
    assert.match(sellerProblem({ NODE_ENV: 'production', SELLER_GSTIN: TEST_SELLER_GSTIN })!, /test value/);
    assert.match(sellerProblem({ NODE_ENV: 'production', SELLER_GSTIN: 'NOTAGSTIN' })!, /not a valid GSTIN/);
    const ok = { NODE_ENV: 'production', SELLER_GSTIN: '29ABCDE1234F1Z5', SELLER_NAME: 'Seller Pvt Ltd', SELLER_ADDRESS: 'Somewhere 560001', SELLER_STATE: 'Karnataka' };
    assert.equal(sellerProblem(ok), null);
    assert.match(sellerProblem({ ...ok, SELLER_STATE: 'Atlantis' })!, /SELLER_STATE/);
  });

  test('recipients: lower-cased, valid, no repeats; subject and body', () => {
    assert.deepEqual(recipients(['A@x.test', 'a@x.test', null, 'bad', ' b@y.test ']), ['a@x.test', 'b@y.test']);
    const party = { name: 'Buyer <Co>', gstin: null, state: 'Maharashtra', address: null };
    const mail = invoiceEmail(
      { number: 'FF/2026-27/000007', issuedAt: '2026-10-28T06:00:00Z', periodStart: '2026-10-28T06:00:00Z', periodEnd: '2026-11-28T06:00:00Z', seller: { ...party, name: 'Kaampilot (test)' }, buyer: party, placeOfSupply: 'Maharashtra', reverseCharge: false, lines: [], subtotal: 10000, cgstRate: 9, cgst: 900, sgstRate: 9, sgst: 900, igstRate: 0, igst: 0, total: 11800, status: 'paid' },
      { webUrl: 'https://kaampilot.com/' },
    );
    assert.equal(mail.subject, 'Kaampilot invoice FF/2026-27/000007 for 28 Oct 2026 – 28 Nov 2026');
    assert.match(mail.text, /Rs\. 118\.00/);
    assert.match(mail.html, /Buyer &lt;Co&gt;/, 'escaped');
    assert.match(mail.text, /https:\/\/kaampilot\.com\/billing/);
  });
});
