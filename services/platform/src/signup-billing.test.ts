// Sign-up, accounts, invites and billing with the fake payment gateway (PLAN.md §21). Run with `npm test` (shares the
// throwaway `ff_platform_test` database with integration.test.ts; only adds its own rows).
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { hashPassword } from './auth/auth.service';
import { BillingService } from './billing/billing.service';
import { financialYear, gst } from './billing/gst';
import { normaliseIdentifier } from './accounts/identifier';
import { resetUsernameChecks } from './accounts/username';
import { resetCompanyNameChecks } from './company/company-name';
import { DbService } from './db/db.service';
import { accounts, billingProfiles, checkoutSessions, companies, invites, otpCodes, people, personApps, seatChanges, staffAudit, subscriptions } from './db/schema';
import { createApp } from './main';

const SECRET = 'test-fakepay-secret-0123456789';
const PASSWORD = 'Signup@2026';
let app: INestApplication;
let base = '';
let dbs: DbService;
let fake: Server;
/** What the stand-in apps received: [app, method, path, cid]. */
const appCalls: Array<{ app: string; method: string; path: string; cid: unknown; body: any }> = [];
let nextUserId = 100;

interface Res {
  status: number;
  body: any;
  cookie?: string;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {}): Promise<Res> {
  const res = await fetch(base + path, {
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
  const m = /ff_refresh=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: m?.[1] ? `ff_refresh=${m[1]}` : undefined };
}

/** Sign-up start + verify: a sign-up token for this identifier. */
async function verified(identifier: string) {
  // Codes for one identifier are 30 s apart: make earlier ones old.
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.match(start.body.devCode, /^[0-9]{6}$/, 'OTP_DEV_ECHO shows the code');
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body as { signupToken: string; accountExists: boolean };
}

/** A fresh account username (PLAN.md §21.5). */
const uname = () => `u${randomUUID().replace(/-/g, '').slice(0, 12)}`;

async function signup(identifier: string, company: Record<string, unknown>, password = PASSWORD, fullName = 'Asha Founder', username = uname()) {
  const { signupToken } = await verified(identifier);
  const res = await call('POST', '/signup/complete', { body: { signupToken, fullName, password, username, company: { apps: ['tasks'], ...company } } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string; provisionMs: number };
}

async function login(loginId: string, password = PASSWORD) {
  return call('POST', '/auth/login', { body: { login: loginId, password } });
}

const sub = async (companyId: string) => (await dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0];
const company = async (companyId: string) => (await dbs.db.select().from(companies).where(eq(companies.id, companyId)))[0];

/** A company with N active people holding Tasks (seats), the owner signing in by account. */
async function addSeatHolders(companyId: string, n: number, app = 'tasks') {
  for (let i = 0; i < n; i++) {
    const [p] = await dbs.db.insert(people).values({ companyId, fullName: `Seat ${randomUUID().slice(0, 6)}` }).returning();
    await dbs.db.insert(personApps).values({ personId: p.id, app, localUserId: String(nextUserId++) });
  }
}

/** A paid, active plan bought through FakePay. */
async function buy(token: string, plan = 'tasks', seats = 5, interval: 'month' | 'year' = 'month') {
  const co = await call('POST', '/billing/checkout', { token, body: { plan, interval, seats } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const done = await call('POST', `/billing/fake/${co.body.sessionId}/complete`, { token, body: { outcome: 'success' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, 'paid');
  return co.body.sessionId as string;
}

before(async () => {
  // Stand-ins for Tasks and Assets: enough of /internal for a new company (set-up, roles, modules, profile, people).
  fake = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const app = req.url!.startsWith('/assets') ? 'assets' : 'tasks';
    const path = req.url!.replace(/^\/(tasks|assets)\/api\/internal/, '').split('?')[0];
    const cid = decodeJwt(String(req.headers.authorization).slice(7)).cid;
    const body = raw ? JSON.parse(raw) : null;
    appCalls.push({ app, method: req.method!, path, cid, body });
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
    if (path === '/events') return json(200, []);
    if (path === '/roles') return json(200, []);
    return json(404, { detail: 'not here' });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as AddressInfo).port;
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${port}/tasks/api/internal`;
  process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${port}/assets/api/internal`;
  process.env.OTP_DEV_ECHO = '1';
  process.env.BILLING_DEV_TOOLS = '1';
  process.env.FAKE_GATEWAY_SECRET = SECRET;
  process.env.OTP_IP_LIMIT = '0';
  process.env.SELLER_STATE = 'Maharashtra';
  process.env.PUBLIC_WEB_URL = 'https://app.freefounders.test';

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
});

after(async () => {
  await app?.close();
  fake?.close();
});

describe('identifiers', () => {
  test('email or Indian mobile, normalised; anything else refused', () => {
    assert.deepEqual(normaliseIdentifier(' Asha@Example.COM '), { kind: 'email', value: 'asha@example.com', channel: 'email' });
    for (const m of ['9876543210', '+91 98765 43210', '09876543210', '919876543210', '98765-43210']) {
      assert.equal(normaliseIdentifier(m)?.value, '+919876543210', m);
    }
    for (const bad of ['12345', '5876543210', '+1 9876543210', 'not an email', 'a@b']) assert.equal(normaliseIdentifier(bad), null, bad);
  });
});

describe('sign-up (PLAN.md §21)', () => {
  test('email → code → name, password, company: a company with its owner, a 14-day Suite trial, set up in the apps', async () => {
    appCalls.length = 0;
    const out = await signup('asha@bright.test', { name: 'Bright Traders Pvt Ltd', teamSize: '11-50', industry: 'Retail', state: 'Karnataka', apps: ['tasks'] });
    assert.ok(out.accessToken && out.companyId);
    assert.ok(out.provisionMs >= 0);
    const c = await company(out.companyId);
    assert.equal(c.code, 'BRIGHTTRADERSPVT', 'code from the name');
    assert.deepEqual(c.enabledApps, ['tasks']);
    const s = await sub(out.companyId);
    assert.equal(s.plan, 'suite');
    assert.equal(s.state, 'trialing');
    assert.ok(Math.abs(s.trialEndsAt!.getTime() - Date.now() - 14 * 86400_000) < 60_000);
    const [profile] = await dbs.db.select().from(billingProfiles).where(eq(billingProfiles.companyId, out.companyId));
    assert.equal(profile.state, 'Karnataka');
    // Same steps as `company -- create`: set up in Tasks, Admin and Member made, the owner gets Tasks (Admin + the Owner role).
    assert.ok(appCalls.some((x) => x.app === 'tasks' && x.path === '/companies' && x.body.code === 'BRIGHTTRADERSPVT'));
    assert.ok(appCalls.some((x) => x.app === 'tasks' && x.path === '/provision' && x.cid === out.companyId));
    assert.ok(!appCalls.some((x) => x.app === 'assets'), 'only the chosen apps');
    const me = await call('GET', '/auth/me', { token: out.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.person.role, 'owner');
    assert.equal(me.body.account.email, 'asha@bright.test');
    assert.equal(me.body.account.isStaff, false);
    assert.deepEqual({ ...me.body.billing, trialEndsAt: undefined }, { plan: 'suite', state: 'trialing', trialEndsAt: undefined, readOnly: false, daysLeft: 14 });
    assert.deepEqual(me.body.apps.map((a: { app: string }) => a.app), ['tasks']);
    // A new company has exactly the two built-in roles; the owner holds Admin (and the hidden Owner role) (PLAN.md §19.28).
    const roleList = await call('GET', '/roles', { token: out.accessToken });
    assert.deepEqual(roleList.body.map((r: { code: string }) => r.code).sort(), ['ff_admin', 'ff_member']);
    const ppl = await call('GET', '/people', { token: out.accessToken });
    assert.equal(ppl.body.length, 1, 'only the owner in People');
    assert.deepEqual(ppl.body[0].roleIds, [roleList.body.find((r: { code: string }) => r.code === 'ff_admin').id]);
    // The account signs in by email (one company: straight in).
    const again = await login('ASHA@bright.test');
    assert.equal(again.status, 200);
    assert.ok(again.body.accessToken && again.cookie, 'refresh cookie like any sign-in');
  });

  test('a mobile number works the same; the same identifier again means the existing account (its password)', async () => {
    const out = await signup('98111 22333', { name: 'Mobile Works' });
    const [a] = await dbs.db.select().from(accounts).where(eq(accounts.mobile, '+919811122333'));
    assert.ok(a && !a.email);
    const v = await verified('+91 9811122333');
    assert.equal(v.accountExists, true);
    const wrong = await call('POST', '/signup/complete', { body: { signupToken: v.signupToken, fullName: 'x', password: 'Wrong@pass1', company: { name: 'Second Co', apps: ['tasks'] } } });
    assert.equal(wrong.status, 401);
    const ok = await call('POST', '/signup/complete', { body: { signupToken: v.signupToken, fullName: 'x', password: PASSWORD, company: { name: 'Second Co', apps: ['tasks'] } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.notEqual(ok.body.companyId, out.companyId);
    const reuse = await call('POST', '/signup/complete', { body: { signupToken: v.signupToken, fullName: 'x', password: PASSWORD, company: { name: 'Third Co', apps: ['tasks'] } } });
    assert.equal(reuse.status, 400, 'a sign-up token works once');
  });

  test('an email that already signs in with a company login cannot become an account; bad input refused', async () => {
    const [co] = await dbs.db.insert(companies).values({ name: 'Legacy Co', code: 'LEGACYSIGNUP', enabledApps: [] }).returning();
    const [p] = await dbs.db.insert(people).values({ companyId: co.id, fullName: 'Lee Legacy', email: 'lee@legacy.test' }).returning();
    await dbs.db.execute(sql`insert into platform.logins (person_id, password_hash) values (${p.id}, ${await hashPassword(PASSWORD)})`);
    const start = await call('POST', '/signup/start', { body: { identifier: 'lee@legacy.test' } });
    const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
    assert.equal(v.status, 409);
    assert.equal((await call('POST', '/signup/start', { body: { identifier: '12345' } })).status, 400);
    const t = await verified('weak@pw.test');
    const weak = await call('POST', '/signup/complete', { body: { signupToken: t.signupToken, fullName: 'W', password: 'short', company: { name: 'Weak Co', apps: ['tasks'] } } });
    assert.equal(weak.status, 400);
    const noApps = await call('POST', '/signup/complete', { body: { signupToken: t.signupToken, fullName: 'W', password: PASSWORD, company: { name: 'Weak Co', apps: [] } } });
    assert.equal(noApps.status, 400);
    const badState = await call('POST', '/signup/complete', { body: { signupToken: t.signupToken, fullName: 'W', password: PASSWORD, company: { name: 'Weak Co', apps: ['tasks'], state: 'Atlantis' } } });
    assert.equal(badState.status, 400);
  });

  test('codes: wrong (tries left), at most 5 tries, expired, used once, resend throttled', async () => {
    const start = await call('POST', '/signup/start', { body: { identifier: 'otp@codes.test' } });
    const otpId = start.body.otpId;
    const wrongCode = start.body.devCode === '000000' ? '111111' : '000000';
    const first = await call('POST', '/signup/verify', { body: { otpId, code: wrongCode } });
    assert.equal(first.status, 400);
    assert.match(first.body.message, /4 tries left/);
    for (let i = 0; i < 4; i++) await call('POST', '/signup/verify', { body: { otpId, code: wrongCode } });
    const right = await call('POST', '/signup/verify', { body: { otpId, code: start.body.devCode } });
    assert.equal(right.status, 400, 'after 5 tries even the right code is refused');
    assert.match(right.body.message, /expired or was tried too many times/);
    // Resend at once: refused (30 s gap); later a new code works once; an expired one does not.
    assert.equal((await call('POST', '/signup/start', { body: { identifier: 'otp@codes.test' } })).status, 429);
    await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, 'otp@codes.test'));
    const second = await call('POST', '/signup/start', { body: { identifier: 'otp@codes.test' } });
    assert.equal(second.status, 200);
    assert.equal((await call('POST', '/signup/verify', { body: { otpId: second.body.otpId, code: second.body.devCode } })).status, 200);
    assert.equal((await call('POST', '/signup/verify', { body: { otpId: second.body.otpId, code: second.body.devCode } })).status, 400, 'used once');
    await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, 'otp@codes.test'));
    const third = await call('POST', '/signup/start', { body: { identifier: 'otp@codes.test' } });
    await dbs.db.update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(otpCodes.id, third.body.otpId));
    assert.equal((await call('POST', '/signup/verify', { body: { otpId: third.body.otpId, code: third.body.devCode } })).status, 400, 'expired');
    // Per IP address.
    process.env.OTP_IP_LIMIT = '3';
    try {
      const statuses: number[] = [];
      // A real network address (the dev echo mode does not limit this machine's own loopback address).
      const headers = { 'x-forwarded-for': '203.0.113.9' };
      for (const n of [1, 2, 3, 4, 5]) statuses.push((await call('POST', '/signup/start', { headers, body: { identifier: `ip${n}-${randomUUID().slice(0, 4)}@limit.test` } })).status);
      assert.ok(statuses.includes(429), `per-IP limit: ${statuses}`);
    } finally {
      process.env.OTP_IP_LIMIT = '0';
    }
    const rows = await dbs.db.select().from(otpCodes).where(eq(otpCodes.target, 'otp@codes.test'));
    assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash)), 'only a hash of the code is stored');
  });
});

describe('accounts in several companies (PLAN.md §21)', () => {
  const ids: Record<string, string> = {};

  test('sign-in asks which company; the ticket works once; the switcher and New company', async () => {
    const one = await signup('multi@co.test', { name: 'Multi One' });
    ids.one = one.companyId;
    const two = await call('POST', '/companies', { token: one.accessToken, body: { name: 'Multi Two', apps: ['tasks', 'assets'], state: 'Maharashtra' } });
    assert.equal(two.status, 200, JSON.stringify(two.body));
    assert.ok(two.cookie, 'new company: refresh cookie set like a sign-in');
    ids.two = two.body.companyId;
    assert.equal(decodeJwt(two.body.accessToken).cid, ids.two);
    assert.equal((await call('GET', '/auth/me', { token: one.accessToken })).status, 401, 'the old session ended');

    const choose = await login('multi@co.test');
    assert.equal(choose.status, 200);
    assert.equal(choose.cookie, undefined, 'no session before a company is chosen');
    assert.deepEqual(choose.body.chooseCompany.map((c: { name: string }) => c.name).sort(), ['Multi One', 'Multi Two']);
    assert.ok(choose.body.chooseCompany.every((c: { role: string }) => c.role === 'owner'));
    const pick = await call('POST', '/auth/login', { body: { ticket: choose.body.ticket, companyId: ids.one } });
    assert.equal(pick.status, 200);
    assert.ok(pick.cookie);
    assert.equal(decodeJwt(pick.body.accessToken).cid, ids.one);
    assert.equal((await call('POST', '/auth/login', { body: { ticket: choose.body.ticket, companyId: ids.one } })).status, 401, 'once');
    const other = await login('multi@co.test');
    assert.equal((await call('POST', '/auth/login', { body: { ticket: other.body.ticket, companyId: randomUUID() } })).status, 401, 'not their company');

    const list = await call('GET', '/auth/companies', { token: pick.body.accessToken });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((c: { name: string; current: boolean }) => [c.name, c.current]), [['Multi One', true], ['Multi Two', false]]);
    const sw = await call('POST', '/auth/switch', { token: pick.body.accessToken, body: { companyId: ids.two } });
    assert.equal(sw.status, 200);
    assert.ok(sw.cookie, 'switch sets the refresh cookie');
    assert.equal(decodeJwt(sw.body.accessToken).cid, ids.two);
    assert.equal((await call('GET', '/auth/me', { token: pick.body.accessToken })).status, 401, 'the old company session ended');
    const refreshed = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: sw.cookie!, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(decodeJwt(((await refreshed.json()) as { accessToken: string }).accessToken).cid, ids.two, 'a reload stays in the new company');
    const mobile = await call('POST', '/auth/switch', { token: sw.body.accessToken, body: { companyId: ids.one, client: 'mobile' } });
    assert.ok(mobile.body.refreshToken, 'mobile gets the refresh token in the body');
    assert.equal((await call('POST', '/auth/switch', { token: mobile.body.accessToken, body: { companyId: randomUUID() } })).status, 403);
  });

  test('an admin-made login cannot make companies; its switcher shows its one company', async () => {
    const [co] = await dbs.db.insert(companies).values({ name: 'Old Login Co', code: 'OLDLOGINCO', enabledApps: [] }).returning();
    const [p] = await dbs.db.insert(people).values({ companyId: co.id, fullName: 'Olga Old', platformRole: 'owner' }).returning();
    await dbs.db.execute(sql`insert into platform.logins (person_id, username, password_hash) values (${p.id}, 'olga.old', ${await hashPassword(PASSWORD)})`);
    const res = await login('olga.old');
    assert.equal(res.status, 200);
    const list = await call('GET', '/auth/companies', { token: res.body.accessToken });
    assert.deepEqual(list.body.map((c: { name: string }) => c.name), ['Old Login Co']);
    assert.equal((await call('POST', '/companies', { token: res.body.accessToken, body: { name: 'Nope', apps: ['tasks'] } })).status, 403);
  });

  test('forgot / reset by code: same answer for unknown identifiers; the new password works, sessions end', async () => {
    const before = await login('multi@co.test');
    const pick = await call('POST', '/auth/login', { body: { ticket: before.body.ticket, companyId: ids.one } });
    await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, 'multi@co.test'));
    const unknown = await call('POST', '/auth/forgot', { body: { identifier: 'nobody@nowhere.test' } });
    const known = await call('POST', '/auth/forgot', { body: { identifier: 'multi@co.test' } });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(known.body).sort(), 'no account enumeration');
    const noAccount = await call('POST', '/auth/reset', { body: { otpId: unknown.body.otpId, code: unknown.body.devCode, newPassword: 'Brand@New99' } });
    assert.equal(noAccount.status, 400);
    const reset = await call('POST', '/auth/reset', { body: { otpId: known.body.otpId, code: known.body.devCode, newPassword: 'Brand@New99' } });
    assert.equal(reset.status, 200);
    assert.equal((await login('multi@co.test')).status, 401, 'old password');
    assert.equal((await login('multi@co.test', 'Brand@New99')).status, 200);
    assert.equal((await call('GET', '/auth/me', { token: pick.body.accessToken })).status, 401, 'sessions ended');
    await dbs.db.update(accounts).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(accounts.email, 'multi@co.test'));
  });

  test('no account lockout (founder, 2026-10-19): 10 wrong passwords, then the right one signs in', async () => {
    await signup('lock@co.test', { name: 'Lock Co' });
    for (let i = 0; i < 10; i++) {
      const res = await login('lock@co.test', 'Wrong@pass1');
      assert.equal(res.status, 401);
      assert.doesNotMatch(res.body.message, /Too many/);
    }
    assert.equal((await login('lock@co.test')).status, 200);
  });

  test('LOGIN_MAX_FAILED=3: the old account lockout still works', async () => {
    await signup('lock3@co.test', { name: 'Lock Three Co' });
    process.env.LOGIN_MAX_FAILED = '3';
    try {
      for (let i = 0; i < 3; i++) assert.equal((await login('lock3@co.test', 'Wrong@pass1')).status, 401);
      const locked = await login('lock3@co.test');
      assert.equal(locked.status, 401);
      assert.match(locked.body.message, /Too many failed attempts/);
    } finally {
      delete process.env.LOGIN_MAX_FAILED;
    }
  });

  test('change password for an account: one password for all its companies', async () => {
    const { accessToken } = await signup('pw@co.test', { name: 'Pw Co' });
    const res = await call('POST', '/auth/change-password', { token: accessToken, body: { currentPassword: PASSWORD, newPassword: 'Changed@123' } });
    assert.equal(res.status, 200);
    assert.equal((await login('pw@co.test', 'Changed@123')).status, 200);
  });
});

describe('invites (PLAN.md §21.2)', () => {
  const ids: Record<string, string> = {};
  let owner = '';

  test('the owner makes a link (only roles and apps it may give); anyone sees what it offers', async () => {
    const out = await signup('owner@invite.test', { name: 'Invite Co', apps: ['tasks'] });
    ids.company = out.companyId;
    owner = out.accessToken;
    const bad = await call('POST', '/invites', { token: owner, body: { apps: ['assets'] } });
    assert.equal(bad.status, 400, 'not in the plan');
    const res = await call('POST', '/invites', { token: owner, body: { apps: ['tasks'], expiresInDays: 7, maxUses: 2 } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.url, /^https:\/\/app\.freefounders\.test\/join\/[A-Za-z0-9_-]{43}$/);
    ids.token = res.body.token;
    ids.invite = res.body.id;
    const [row] = await dbs.db.select().from(invites).where(eq(invites.id, res.body.id));
    assert.notEqual(row.tokenHash, res.body.token, 'only a hash is stored');
    const info = await call('GET', `/invites/${ids.token}`);
    assert.deepEqual(info.body, { companyName: 'Invite Co', roles: [], apps: ['tasks'], expiresAt: info.body.expiresAt, valid: true });
    assert.equal((await call('GET', '/invites/not-a-real-token-at-all-xxxxxxxx')).status, 404);
    const list = await call('GET', '/invites', { token: owner });
    assert.equal(list.body[0].status, 'active');
    assert.equal(list.body[0].revoked, false);
  });

  test('a new person joins with a sign-up token: account, membership, Tasks given; an existing member just signs in', async () => {
    appCalls.length = 0;
    const { signupToken } = await verified('joiner@invite.test');
    const res = await call('POST', `/invites/${ids.token}/accept`, { body: { signupToken, fullName: 'Jo Joiner', password: PASSWORD, username: uname() } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.cookie);
    assert.equal(res.body.companyId, ids.company);
    const me = await call('GET', '/auth/me', { token: res.body.accessToken });
    assert.equal(me.body.person.role, 'member');
    assert.deepEqual(me.body.apps.map((a: { app: string }) => a.app), ['tasks']);
    assert.ok(appCalls.some((x) => x.path === '/provision' && x.body.fullName === 'Jo Joiner'), 'provisioned into Tasks');
    // Signed in again with the link: nothing is used up, they land in the company.
    const again = await call('POST', `/invites/${ids.token}/accept`, { token: res.body.accessToken, body: {} });
    assert.equal(again.status, 200);
    const [row] = await dbs.db.select().from(invites).where(eq(invites.id, ids.invite));
    assert.equal(row.uses, 1);
    // A member without Manage people cannot make links.
    assert.equal((await call('POST', '/invites', { token: res.body.accessToken, body: {} })).status, 403);
  });

  test('an existing account (other company) joins with {signupToken, password}', async () => {
    await signup('elsewhere@invite.test', { name: 'Elsewhere Co' });
    const { signupToken, accountExists } = await verified('elsewhere@invite.test');
    assert.equal(accountExists, true);
    const res = await call('POST', `/invites/${ids.token}/accept`, { body: { signupToken, password: PASSWORD } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(decodeJwt(res.body.accessToken).cid, ids.company);
    const used = await call('GET', `/invites/${ids.token}`);
    assert.equal(used.body.valid, false, 'max 2 uses reached');
    assert.equal(used.body.reason, 'used_up');
    assert.equal((await call('GET', '/invites', { token: owner })).body[0].status, 'used_up');
  });

  test('expired, switched-off links are refused (410)', async () => {
    const mk = async () => (await call('POST', '/invites', { token: owner, body: { apps: ['tasks'] } })).body;
    const expired = await mk();
    await dbs.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, expired.id));
    const t1 = await verified('late@invite.test');
    const lateRes = await call('POST', `/invites/${expired.token}/accept`, { body: { signupToken: t1.signupToken, fullName: 'Late', password: PASSWORD } });
    assert.equal(lateRes.status, 410);
    assert.match(lateRes.body.message, /has expired/);
    assert.equal((await call('GET', `/invites/${expired.token}`)).body.reason, 'expired');
    const revoked = await mk();
    assert.equal((await call('DELETE', `/invites/${revoked.id}`, { token: owner })).status, 200);
    const revokedInfo = (await call('GET', `/invites/${revoked.token}`)).body;
    assert.deepEqual([revokedInfo.valid, revokedInfo.reason], [false, 'revoked']);
    assert.match(revokedInfo.message, /switched off/);
    const revokedRes = await call('POST', `/invites/${revoked.token}/accept`, { body: { signupToken: t1.signupToken, fullName: 'Late', password: PASSWORD } });
    assert.equal(revokedRes.status, 410);
    assert.match(revokedRes.body.message, /switched off/);
  });

  test('no free seat: 402 with the owner hint (Free plan: 3 people)', async () => {
    await dbs.db.update(subscriptions).set({ plan: 'free', state: 'active', trialEndsAt: null }).where(eq(subscriptions.companyId, ids.company));
    // owner + 2 joiners = 3 seats used
    const link = (await call('POST', '/invites', { token: owner, body: { apps: ['tasks'] } })).body;
    const t = await verified('fourth@invite.test');
    const res = await call('POST', `/invites/${link.token}/accept`, { body: { signupToken: t.signupToken, fullName: 'Fourth', password: PASSWORD, username: uname() } });
    assert.equal(res.status, 402);
    assert.equal(res.body.message, 'The Free plan is for up to 3 users and all 3 are in use. The owner can upgrade in Billing to add more people.');
    // The same limit when an admin gives someone their first app.
    const p = await call('POST', '/people', { token: owner, body: { fullName: 'No Seat' } });
    assert.equal((await call('PUT', `/people/${p.body.person.id}/apps/tasks`, { token: owner, body: {} })).status, 402);
    await dbs.db.update(subscriptions).set({ plan: 'suite', state: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 86400_000) }).where(eq(subscriptions.companyId, ids.company));
  });
});

describe('billing with the fake gateway (PLAN.md §21)', () => {
  const ids: Record<string, string> = {};
  let owner = '';

  test('plans and the Billing page; only the owner (Manage billing)', async () => {
    const out = await signup('owner@pay.test', { name: 'Pay Co', state: 'Karnataka', apps: ['tasks', 'assets'] });
    ids.company = out.companyId;
    owner = out.accessToken;
    const plans = await call('GET', '/billing/plans', { token: owner });
    assert.deepEqual(plans.body.map((p: { code: string; priceMonthly: number; priceYearly: number }) => [p.code, p.priceMonthly, p.priceYearly]), [
      ['free', 0, 0],
      ['tasks', 9900, 99000],
      ['assets', 7900, 79000],
      ['suite', 14900, 149000],
    ]);
    assert.equal(plans.body[0].maxSeats, 3, 'Free: up to 3 people');
    assert.equal(plans.body[1].minSeats, 5);
    const view = await call('GET', '/billing', { token: owner });
    assert.equal(view.status, 200);
    assert.equal(view.body.plan, 'suite');
    assert.equal(view.body.state, 'trialing');
    assert.deepEqual(view.body.seats, { used: 1, paid: 0, limit: 50, nextPeriod: null });
    assert.equal(view.body.nextCharge, null);
    assert.equal(view.body.devTools, true);
    assert.equal(view.body.profile.state, 'Karnataka');
    // A member cannot see billing.
    const link = (await call('POST', '/invites', { token: owner, body: {} })).body;
    const t = await verified('member@pay.test');
    const member = await call('POST', `/invites/${link.token}/accept`, { body: { signupToken: t.signupToken, fullName: 'Mem', password: PASSWORD, username: uname() } });
    ids.memberToken = member.body.accessToken;
    assert.equal((await call('GET', '/billing', { token: member.body.accessToken })).status, 403);
  });

  test('checkout: IGST for another state; Pay → active, invoice, payment; the plan sets the apps', async () => {
    const tooFew = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'tasks', interval: 'month', seats: 2 } });
    assert.equal(tooFew.status, 400, 'paid plans start at 5 seats');
    assert.equal((await call('POST', '/billing/checkout', { token: owner, body: { plan: 'complimentary', interval: 'month', seats: 5 } })).status, 400);
    const co = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'tasks', interval: 'month', seats: 5 } });
    assert.equal(co.status, 200);
    assert.equal(co.body.checkoutUrl, `/billing/pay/${co.body.sessionId}`);
    const page = await call('GET', `/billing/checkout/${co.body.sessionId}`, { token: owner });
    assert.deepEqual([page.body.subtotal, page.body.cgst, page.body.sgst, page.body.igst, page.body.total, page.body.status, page.body.companyName], [49500, 0, 0, 8910, 58410, 'open', 'Pay Co']);
    const done = await call('POST', `/billing/fake/${co.body.sessionId}/complete`, { token: owner, body: { outcome: 'success' } });
    assert.equal(done.body.status, 'paid');
    const view = await call('GET', '/billing', { token: owner });
    assert.equal(view.body.plan, 'tasks');
    assert.equal(view.body.state, 'active');
    assert.deepEqual(view.body.seats, { used: 2, paid: 5, limit: 5, nextPeriod: null }, 'the member joined as Member (an invite without a role, PLAN.md §19.28): a seat');
    assert.equal(view.body.nextCharge.total, 58410);
    assert.deepEqual((await company(ids.company)).enabledApps, ['tasks'], 'Assets is off on the Tasks plan (nothing deleted)');
    const list = await call('GET', '/billing/invoices', { token: owner });
    assert.equal(list.body.length, 1);
    const inv = await call('GET', `/billing/invoices/${list.body[0].id}`, { token: owner });
    assert.match(inv.body.number, /^FF\/\d{4}-\d{2}\/\d{6}$/);
    assert.equal(inv.body.buyer.state, 'Karnataka');
    assert.equal(inv.body.seller.state, 'Maharashtra');
    assert.match(inv.body.seller.name, /\(test\)/);
    assert.equal(inv.body.igstRate, 18);
    assert.equal(inv.body.total, 58410);
    assert.equal(inv.body.lines[0].sac, '997331');
    // Paying the same checkout again changes nothing.
    await call('POST', `/billing/fake/${co.body.sessionId}/complete`, { token: owner, body: { outcome: 'success' } });
    assert.equal((await call('GET', '/billing/invoices', { token: owner })).body.length, 1);
  });

  test('webhooks: a bad signature is refused; the same event twice is applied once; a failed first payment changes nothing', async () => {
    const co = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'suite', interval: 'year', seats: 5 } });
    const [s] = await dbs.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, co.body.sessionId));
    const event = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'payment.captured', sessionId: s.id, amount: s.total });
    const bad = await call('POST', '/billing/webhook/fake', { raw: event, headers: { 'x-fakepay-signature': 'f'.repeat(64), 'x-requested-with': '' } });
    assert.equal(bad.status, 400);
    const unsigned = await call('POST', '/billing/webhook/fake', { raw: event });
    assert.equal(unsigned.status, 400);
    const sig = createHmac('sha256', SECRET).update(event).digest('hex');
    appCalls.length = 0;
    const first = await fetch(`${base}/billing/webhook/fake`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fakepay-signature': sig }, body: event });
    assert.equal(first.status, 200, 'no CSRF header needed: signature instead');
    assert.deepEqual(await first.json(), { ok: true, duplicate: false });
    const second = await fetch(`${base}/billing/webhook/fake`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fakepay-signature': sig }, body: event });
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
    assert.equal((await call('GET', '/billing/invoices', { token: owner })).body.length, 2);
    const view = await call('GET', '/billing', { token: owner });
    assert.equal(view.body.plan, 'suite');
    assert.equal(view.body.interval, 'year');
    assert.deepEqual((await company(ids.company)).enabledApps, ['tasks', 'assets'], 'upgrading to Suite brings Assets back');
    assert.ok(appCalls.some((x) => x.app === 'assets' && x.path === '/companies' && x.body.companyId === ids.company), 'set up in Assets again (safe to repeat)');
    // Upgrade credit: the unused Tasks month came off the yearly price.
    assert.ok(s.lines.some((l) => l.amount < 0 && /credit/.test(l.description)));

    const fail = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'tasks', interval: 'month', seats: 5 } });
    const failed = await call('POST', `/billing/fake/${fail.body.sessionId}/complete`, { token: owner, body: { outcome: 'failure' } });
    assert.equal(failed.body.status, 'failed');
    const cancel = await call('POST', '/billing/checkout', { token: owner, body: { plan: 'tasks', interval: 'month', seats: 5 } });
    assert.equal((await call('POST', `/billing/fake/${cancel.body.sessionId}/complete`, { token: owner, body: { outcome: 'cancel' } })).body.status, 'cancelled');
    const after = await call('GET', '/billing', { token: owner });
    assert.equal(after.body.plan, 'suite', 'unchanged');
    assert.equal(after.body.state, 'active');
  });

  test('another company cannot read this checkout or invoice', async () => {
    const other = await signup('other@pay.test', { name: 'Other Pay Co' });
    const [s] = await dbs.db.select().from(checkoutSessions).where(eq(checkoutSessions.companyId, ids.company)).limit(1);
    assert.equal((await call('GET', `/billing/checkout/${s.id}`, { token: other.accessToken })).status, 404);
    assert.equal((await call('POST', `/billing/fake/${s.id}/complete`, { token: other.accessToken, body: { outcome: 'success' } })).status, 404);
  });

  test('downloads (PLAN.md §19.31): the invoice list as xlsx/csv, each invoice as PDF; the same checks as viewing', async () => {
    const get = (path: string, token: string) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
    const list = (await call('GET', '/billing/invoices', { token: owner })).body as Array<{ id: string; number: string }>;
    assert.ok(list.length >= 2);
    const csv = await get('/billing/invoices?export=csv', owner);
    assert.equal(csv.status, 200);
    const lines = (await csv.text()).trim().split(/\r?\n/);
    assert.equal(lines.length, list.length + 1, 'header + every invoice');
    assert.match(lines[0]!, /^\ufeff?Invoice no\.,Date/);
    assert.ok(lines.slice(1).some((l) => l.startsWith(list[0]!.number)));
    const xlsx = Buffer.from(await (await get('/billing/invoices?export=xlsx', owner)).arrayBuffer());
    assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
    const pdf = await get(`/billing/invoices/${list[0]!.id}/pdf`, owner);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const body = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    assert.ok(body.startsWith('%PDF-1.4'));
    assert.ok(body.includes(list[0]!.number), 'the invoice number is in the PDF');
    assert.ok(body.includes('Tax invoice') && body.includes('Rupees'), 'title and amount in words');
    // A member cannot download billing; another company gets 404 for this invoice.
    assert.equal((await get('/billing/invoices?export=csv', ids.memberToken!)).status, 403);
    assert.equal((await get(`/billing/invoices/${list[0]!.id}/pdf`, ids.memberToken!)).status, 403);
    const other = await signup('other2@pay.test', { name: 'Other Pay Co 2' });
    assert.equal((await get(`/billing/invoices/${list[0]!.id}/pdf`, other.accessToken)).status, 404);
  });
});

describe('the billing clock (PLAN.md §21.1)', () => {
  test('renewals: success → new period and invoice; failure → past_due → read_only (7 d) → suspended (30 d)', async () => {
    const out = await signup('clock@co.test', { name: 'Clock Co', state: 'Maharashtra' });
    const id = out.companyId;
    let owner = out.accessToken;
    await addSeatHolders(id, 2);
    await buy(owner, 'tasks', 5);
    const before = await sub(id);
    const ok = await call('POST', '/billing/dev/renew', { token: owner, body: { outcome: 'success' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.state, 'active');
    const invs = (await call('GET', '/billing/invoices', { token: owner })).body;
    assert.equal(invs.length, 2);
    const inv = (await call('GET', `/billing/invoices/${invs[0].id}`, { token: owner })).body;
    assert.deepEqual([inv.cgst, inv.sgst, inv.igst, inv.cgstRate, inv.sgstRate], [4455, 4455, 0, 9, 9], 'same state: CGST + SGST');
    assert.ok((await sub(id)).currentPeriodEnd! > before.currentPeriodEnd!);

    // A month later the renewal fails.
    const failed = await call('POST', '/billing/dev/advance', { token: owner, body: { days: 31, renewalOutcome: 'failure' } });
    assert.equal(failed.body.state, 'past_due');
    const me = await call('GET', '/auth/me', { token: owner });
    assert.equal(me.body.billing.state, 'past_due');
    assert.ok(me.body.billing.daysLeft <= 7);
    const ro = await call('POST', '/billing/dev/advance', { token: owner, body: { days: 8 } });
    assert.equal(ro.body.state, 'read_only');
    assert.equal(ro.body.readOnly, true);

    // Read-only: writes 402, billing and reads still work, the next token says ro.
    const write = await call('POST', '/people', { token: owner, body: { fullName: 'Blocked' } });
    assert.equal(write.status, 402);
    assert.match(write.body.message, /read-only/);
    assert.equal((await call('POST', '/invites', { token: owner, body: {} })).status, 402);
    assert.equal((await call('GET', '/people', { token: owner })).status, 200);
    assert.equal((await call('PUT', '/billing/profile', { token: owner, body: { legalName: 'Clock Co Pvt Ltd', state: 'Maharashtra', gstin: '27ABCDE1234F1Z5' } })).status, 200);
    const fresh = await login('clock@co.test');
    owner = fresh.body.accessToken;
    assert.equal(decodeJwt(owner).ro, true);
    assert.equal((await call('GET', '/auth/me', { token: owner })).body.billing.readOnly, true);

    const susp = await call('POST', '/billing/dev/advance', { token: owner, body: { days: 31 } });
    assert.equal(susp.body.state, 'suspended');
    // Suspended: only the owner signs in (read-only, to Billing); the people can't.
    const [member] = await dbs.db.select().from(people).where(and(eq(people.companyId, id), eq(people.platformRole, 'member'))).limit(1);
    await dbs.db.execute(sql`insert into platform.logins (person_id, username, password_hash) values (${member.id}, 'clock.member', ${await hashPassword(PASSWORD)})`);
    const blocked = await login('clock.member');
    assert.equal(blocked.status, 402);
    const ownerIn = await login('clock@co.test');
    assert.equal(ownerIn.status, 200);
    owner = ownerIn.body.accessToken;
    // Paying brings it back.
    await buy(owner, 'tasks', 5);
    assert.equal((await sub(id)).state, 'active');
    assert.equal((await login('clock.member')).status, 200);
  });

  test('trial end: Free when it fits (≤ 3 people, Tasks only), else read-only', async () => {
    const small = await signup('small@trial.test', { name: 'Small Trial', apps: ['tasks'] });
    await addSeatHolders(small.companyId, 2);
    const s = await call('POST', '/billing/dev/advance', { token: small.accessToken, body: { days: 15 } });
    assert.equal(s.body.plan, 'free');
    assert.equal(s.body.state, 'active');
    assert.deepEqual(s.body.seats, { used: 3, paid: 0, limit: 3, nextPeriod: null });

    const big = await signup('big@trial.test', { name: 'Big Trial', apps: ['tasks'] });
    await addSeatHolders(big.companyId, 3);
    const b = await call('POST', '/billing/dev/advance', { token: big.accessToken, body: { days: 15 } });
    assert.equal(b.body.state, 'read_only', '4 people do not fit Free');

    const assetsCo = await signup('assets@trial.test', { name: 'Assets Trial', apps: ['tasks', 'assets'] });
    await addSeatHolders(assetsCo.companyId, 1, 'assets');
    const a = await call('POST', '/billing/dev/advance', { token: assetsCo.accessToken, body: { days: 15 } });
    assert.equal(a.body.state, 'read_only', 'Assets in use does not fit Free');
  });

  test('cancel → at the period end Free if it fits, else read-only; resume undoes it', async () => {
    const fits = await signup('cancel1@co.test', { name: 'Cancel Fits' });
    await buy(fits.accessToken, 'tasks', 5);
    const c = await call('POST', '/billing/cancel', { token: fits.accessToken });
    assert.equal(c.body.state, 'cancelled');
    assert.equal(c.body.cancelAtPeriodEnd, true);
    assert.equal(c.body.nextCharge, null);
    assert.equal((await call('POST', '/billing/resume', { token: fits.accessToken })).body.state, 'active');
    await call('POST', '/billing/cancel', { token: fits.accessToken });
    const end = await call('POST', '/billing/dev/advance', { token: fits.accessToken, body: { days: 32 } });
    assert.equal(end.body.plan, 'free');
    assert.equal(end.body.state, 'active');

    const tooBig = await signup('cancel2@co.test', { name: 'Cancel Big' });
    await addSeatHolders(tooBig.companyId, 4);
    await buy(tooBig.accessToken, 'tasks', 5);
    await call('POST', '/billing/cancel', { token: tooBig.accessToken });
    const end2 = await call('POST', '/billing/dev/advance', { token: tooBig.accessToken, body: { days: 32 } });
    assert.equal(end2.body.state, 'read_only');
  });

  test('seats: more now (pro rata on the next invoice), fewer from the next period, never below use', async () => {
    const out = await signup('seats@co.test', { name: 'Seats Co', state: 'Maharashtra' });
    await addSeatHolders(out.companyId, 5); // 6 used
    assert.equal((await call('POST', '/billing/seats', { token: out.accessToken, body: { seats: 8 } })).status, 400, 'no paid plan yet');
    await buy(out.accessToken, 'tasks', 6);
    const s = await sub(out.companyId);
    const more = await call('POST', '/billing/seats', { token: out.accessToken, body: { seats: 8 } });
    assert.equal(more.status, 200);
    assert.equal(more.body.seats.paid, 8);
    const [change] = await dbs.db.select().from(seatChanges).where(eq(seatChanges.companyId, out.companyId));
    const len = s.currentPeriodEnd!.getTime() - s.currentPeriodStart!.getTime();
    const left = s.currentPeriodEnd!.getTime() - Date.now();
    assert.ok(Math.abs(change.amount - (2 * 9900 * left) / len) < 50, `pro rata ${change.amount}`);
    const line = more.body.nextCharge.lines.find((l: { description: string }) => /pro rata/.test(l.description));
    assert.equal(line.amount, change.amount);
    assert.equal(more.body.nextCharge.subtotal, 8 * 9900 + change.amount);
    assert.equal((await call('POST', '/billing/seats', { token: out.accessToken, body: { seats: 5 } })).status, 400, '6 in use');
    const fewer = await call('POST', '/billing/seats', { token: out.accessToken, body: { seats: 6 } });
    assert.deepEqual([fewer.body.seats.paid, fewer.body.seats.nextPeriod], [8, 6]);
    // The next renewal: 6 seats plus the pro-rata line, and the change is invoiced once.
    await call('POST', '/billing/dev/renew', { token: out.accessToken, body: { outcome: 'success' } });
    const after = await call('GET', '/billing', { token: out.accessToken });
    assert.equal(after.body.seats.paid, 6);
    assert.equal(after.body.nextCharge.lines.length, 1, 'the pro-rata line was charged');
    const [charged] = await dbs.db.select().from(seatChanges).where(eq(seatChanges.companyId, out.companyId));
    assert.ok(charged.invoiceId);
    // The seat limit holds: 6 used of 6.
    const p = await call('POST', '/people', { token: out.accessToken, body: { fullName: 'Seventh' } });
    const grant = await call('PUT', `/people/${p.body.person.id}/apps/tasks`, { token: out.accessToken, body: {} });
    assert.equal(grant.status, 402);
    assert.equal(grant.body.message, 'All 6 paid seats are in use. The owner can add seats in Billing.');
  });

  test('GST and invoice numbers: CGST+SGST in the seller state, IGST elsewhere; one series per financial year', async () => {
    const line = (amount: number) => [{ description: 'x', sac: '997331', quantity: 1, unitPrice: amount, amount }];
    assert.deepEqual(gst(line(14900), 'maharashtra'), { subtotal: 14900, cgst: 1341, sgst: 1341, igst: 0, total: 17582, placeOfSupply: 'Maharashtra' });
    assert.deepEqual(gst(line(14900), 'Delhi'), { subtotal: 14900, cgst: 0, sgst: 0, igst: 2682, total: 17582, placeOfSupply: 'Delhi' });
    assert.equal(financialYear(new Date('2026-04-01T00:00:00+05:30')), '2026-27');
    assert.equal(financialYear(new Date('2027-03-31T23:59:00+05:30')), '2026-27');
    assert.equal(financialYear(new Date('2027-03-31T19:00:00Z')), '2027-28', 'India time decides');
    const rows = await dbs.db.execute<{ number: string; seq: number; financial_year: string }>(sql`select number, seq, financial_year from platform.invoices order by financial_year, seq`);
    const byFy = new Map<string, number[]>();
    for (const r of rows.rows) {
      assert.equal(r.number, `FF/${r.financial_year}/${String(r.seq).padStart(6, '0')}`);
      byFy.set(r.financial_year, [...(byFy.get(r.financial_year) ?? []), r.seq]);
    }
    for (const seqs of byFy.values()) assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'no gaps, no repeats');
  });

  test('the billing clock runs in one Platform process at a time', async () => {
    const billing = app.get(BillingService);
    const holder = await dbs.pool.connect();
    try {
      await holder.query('select pg_advisory_lock($1)', [4_646_002]);
      assert.equal(await billing.runAll(), 0, 'another process holds the lock');
    } finally {
      await holder.query('select pg_advisory_unlock($1)', [4_646_002]);
      holder.release();
    }
    assert.ok((await billing.runAll()) >= 0);
  });

  test('dev tools are off without BILLING_DEV_TOOLS=1', async () => {
    const out = await signup('nodev@co.test', { name: 'No Dev Co' });
    process.env.BILLING_DEV_TOOLS = '0';
    try {
      assert.equal((await call('POST', '/billing/dev/advance', { token: out.accessToken, body: { days: 1 } })).status, 404);
      assert.equal((await call('GET', '/billing', { token: out.accessToken })).body.devTools, false);
    } finally {
      process.env.BILLING_DEV_TOOLS = '1';
    }
  });
});

describe('owner console (staff only)', () => {
  test('a non-staff owner gets 403; a staff account sees every company and can change them', async () => {
    const out = await signup('notstaff@co.test', { name: 'Not Staff Co' });
    assert.equal((await call('GET', '/console/summary', { token: out.accessToken })).status, 403);
    assert.equal((await call('GET', '/console/companies', { token: out.accessToken })).status, 403);
    const staff = await signup('staff@ff.test', { name: 'FF Internal' });
    await dbs.db.update(accounts).set({ isStaff: true }).where(eq(accounts.email, 'staff@ff.test'));
    const sum = await call('GET', '/console/summary', { token: staff.accessToken });
    assert.equal(sum.status, 200);
    assert.ok(sum.body.companies >= 10 && sum.body.trialing >= 1 && typeof sum.body.mrr === 'number' && typeof sum.body.active === 'number');
    const list = await call('GET', '/console/companies', { token: staff.accessToken });
    const target = list.body.find((c: { id: string }) => c.id === out.companyId);
    assert.equal(target.state, 'trialing');
    const trial = await call('POST', `/console/companies/${out.companyId}/trial`, { token: staff.accessToken, body: { days: 10 } });
    assert.ok(new Date(trial.body.trialEndsAt).getTime() > Date.now() + 23 * 86400_000);
    const plan = await call('POST', `/console/companies/${out.companyId}/plan`, { token: staff.accessToken, body: { plan: 'suite', seats: 10 } });
    assert.deepEqual([plan.body.plan, plan.body.state, plan.body.seats.paid, plan.body.mrr], ['suite', 'active', 10, 149000]);
    const susp = await call('POST', `/console/companies/${out.companyId}/status`, { token: staff.accessToken, body: { status: 'suspended' } });
    assert.equal(susp.body.state, 'suspended');
    assert.equal((await call('POST', `/console/companies/${out.companyId}/status`, { token: staff.accessToken, body: { status: 'active' } })).body.state, 'active');
    assert.equal((await call('POST', `/console/companies/${randomUUID()}/status`, { token: staff.accessToken, body: { status: 'active' } })).status, 404);
  });
});

describe('switch to Free from Billing (PLAN.md §21.7)', () => {
  test('trialing and fits: Free now, the Assets app switched off; again is refused', async () => {
    const out = await signup('free1@co.test', { name: 'Free Now Co', apps: ['tasks', 'assets'] });
    await addSeatHolders(out.companyId, 2);
    assert.deepEqual([...(await company(out.companyId)).enabledApps].sort(), ['assets', 'tasks']);
    // The owner holds Assets (the trial is Suite): that does not fit Free until nobody uses Assets.
    const held = await call('POST', '/billing/free', { token: out.accessToken });
    assert.equal(held.status, 400);
    assert.match(held.body.message, /Switch off the Assets app first/);
    const [owner] = await dbs.db.select().from(people).where(and(eq(people.companyId, out.companyId), eq(people.platformRole, 'owner')));
    await dbs.db.delete(personApps).where(and(eq(personApps.personId, owner.id), eq(personApps.app, 'assets')));
    const res = await call('POST', '/billing/free', { token: out.accessToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.plan, res.body.state, res.body.freeFrom, res.body.readOnly], ['free', 'active', 'now', false]);
    assert.deepEqual(res.body.seats, { used: 3, paid: 0, limit: 3, nextPeriod: null });
    assert.deepEqual((await company(out.companyId)).enabledApps, ['tasks'], 'Free has no Assets');
    const again = await call('POST', '/billing/free', { token: out.accessToken });
    assert.equal(again.status, 400);
    assert.match(again.body.message, /already on the Free plan/);
  });

  test('does not fit: a clear message naming how many people and the Assets app; nothing changes', async () => {
    const many = await signup('free2@co.test', { name: 'Free Too Many' });
    await addSeatHolders(many.companyId, 4); // 5 in use
    const r1 = await call('POST', '/billing/free', { token: many.accessToken });
    assert.equal(r1.status, 400);
    assert.equal(r1.body.message, 'The Free plan is for up to 3 users using Attendance and Tasks. Switch off 2 people first.');
    assert.equal((await sub(many.companyId)).state, 'trialing');

    const assetsCo = await signup('free3@co.test', { name: 'Free Assets Used', apps: ['tasks', 'assets'] });
    await addSeatHolders(assetsCo.companyId, 1, 'assets');
    const r2 = await call('POST', '/billing/free', { token: assetsCo.accessToken });
    assert.equal(r2.status, 400);
    assert.equal(r2.body.message, 'The Free plan is for up to 3 users using Attendance and Tasks. Switch off the Assets app first (Admin → People: take Assets away from the 2 people who have it).');

    const both = await signup('free4@co.test', { name: 'Free Both', apps: ['tasks', 'assets'] });
    await addSeatHolders(both.companyId, 3, 'assets');
    const r3 = await call('POST', '/billing/free', { token: both.accessToken });
    assert.equal(r3.body.message, 'The Free plan is for up to 3 users using Attendance and Tasks. Switch off 1 person and the Assets app first (Admin → People: take Assets away from the 4 people who have it).');
    // Switching the Assets app off for the company makes it fit (its holders no longer count).
    await dbs.db.update(companies).set({ enabledApps: ['tasks'] }).where(eq(companies.id, both.companyId));
    assert.equal((await call('POST', '/billing/free', { token: both.accessToken })).body.plan, 'free');
  });

  test('active paid plan: Free at the end of the paid period (like cancel)', async () => {
    const out = await signup('free5@co.test', { name: 'Free Later Co' });
    await buy(out.accessToken, 'tasks', 5);
    const res = await call('POST', '/billing/free', { token: out.accessToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.plan, res.body.state, res.body.cancelAtPeriodEnd, res.body.freeFrom, res.body.nextCharge], ['tasks', 'cancelled', true, 'period_end', null]);
    const twice = await call('POST', '/billing/free', { token: out.accessToken });
    assert.equal(twice.body.freeFrom, 'period_end', 'already ending: nothing more to do');
    const end = await call('POST', '/billing/dev/advance', { token: out.accessToken, body: { days: 32 } });
    assert.deepEqual([end.body.plan, end.body.state], ['free', 'active']);
  });

  test('past due or read-only: Free now and read-only ends', async () => {
    const pd = await signup('free6@co.test', { name: 'Free Past Due' });
    await buy(pd.accessToken, 'tasks', 5);
    await call('POST', '/billing/dev/renew', { token: pd.accessToken, body: { outcome: 'failure' } });
    assert.equal((await sub(pd.companyId)).state, 'past_due');
    const r1 = await call('POST', '/billing/free', { token: pd.accessToken });
    assert.deepEqual([r1.body.plan, r1.body.state, r1.body.freeFrom, r1.body.seats.paid], ['free', 'active', 'now', 0]);

    const ro = await signup('free7@co.test', { name: 'Free Read Only' });
    await buy(ro.accessToken, 'tasks', 5);
    await call('POST', '/billing/dev/renew', { token: ro.accessToken, body: { outcome: 'failure' } });
    await call('POST', '/billing/dev/advance', { token: ro.accessToken, body: { days: 8 } });
    assert.equal((await sub(ro.companyId)).state, 'read_only');
    const fresh = (await login('free7@co.test')).body.accessToken;
    assert.equal(decodeJwt(fresh).ro, true);
    const r2 = await call('POST', '/billing/free', { token: fresh });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.deepEqual([r2.body.plan, r2.body.state, r2.body.readOnly], ['free', 'active', false]);
    const after = (await login('free7@co.test')).body.accessToken;
    assert.ok(!decodeJwt(after).ro, 'new tokens are not read-only');
    assert.equal((await call('GET', '/auth/me', { token: after })).body.billing.readOnly, false);
  });
});

describe('owner console audit log (PLAN.md §21.7)', () => {
  test('every console action writes one row with the right details; only staff read the log, newest first, filtered, paginated', async () => {
    const target = await signup('audit-target@co.test', { name: 'Audit Target Co' });
    const other = await signup('audit-other@co.test', { name: 'Audit Other Co' });
    const staff = await signup('audit-staff@ff.test', { name: 'Audit Staff Home' });
    await dbs.db.update(accounts).set({ isStaff: true }).where(eq(accounts.email, 'audit-staff@ff.test'));
    const [acc] = await dbs.db.select().from(accounts).where(eq(accounts.email, 'audit-staff@ff.test'));
    const t = staff.accessToken;
    const rowsFor = async (companyId: string) => (await dbs.db.select().from(staffAudit).where(eq(staffAudit.companyId, companyId))).sort((a, b) => a.at.getTime() - b.at.getTime());

    assert.equal((await call('POST', `/console/companies/${target.companyId}/trial`, { token: t, body: { days: 5 } })).status, 200);
    let rows = await rowsFor(target.companyId);
    assert.equal(rows.length, 1);
    const code = (await company(target.companyId)).code;
    assert.deepEqual([rows[0].action, rows[0].staffAccountId, rows[0].staffEmail, rows[0].companyCode], ['trial.extend', acc.id, 'audit-staff@ff.test', code]);
    const d0 = rows[0].details as any;
    assert.deepEqual(d0.input, { days: 5 });
    assert.equal(d0.before.state, 'trialing');
    assert.ok(new Date(d0.after.trialEndsAt).getTime() > new Date(d0.before.trialEndsAt).getTime());
    assert.ok(rows[0].ip, 'the address is kept');

    await call('POST', `/console/companies/${target.companyId}/plan`, { token: t, body: { plan: 'tasks', seats: 7 } });
    await call('POST', `/console/companies/${target.companyId}/status`, { token: t, body: { status: 'suspended' } });
    await call('POST', `/console/companies/${target.companyId}/status`, { token: t, body: { status: 'active' } });
    await call('POST', `/console/companies/${other.companyId}/status`, { token: t, body: { status: 'suspended' } });
    rows = await rowsFor(target.companyId);
    assert.deepEqual(rows.map((r) => r.action), ['trial.extend', 'plan.set', 'company.suspend', 'company.reactivate']);
    const plan = rows[1].details as any;
    assert.deepEqual([plan.input, plan.before.plan, plan.after.plan, plan.after.seats], [{ plan: 'tasks', seats: 7 }, 'suite', 'tasks', 7]);
    assert.deepEqual([(rows[2].details as any).after.state, (rows[3].details as any).after.state], ['suspended', 'active']);
    // A failed action (unknown company, unknown plan) writes nothing.
    const before = (await dbs.db.select().from(staffAudit)).length;
    assert.equal((await call('POST', `/console/companies/${randomUUID()}/trial`, { token: t, body: { days: 1 } })).status, 404);
    assert.equal((await call('POST', `/console/companies/${target.companyId}/plan`, { token: t, body: { plan: 'nope', seats: 1 } })).status, 400);
    assert.equal((await dbs.db.select().from(staffAudit)).length, before);

    // Reading: staff only.
    assert.equal((await call('GET', '/console/audit', { token: target.accessToken })).status, 403);
    const all = await call('GET', '/console/audit', { token: t });
    assert.equal(all.status, 200);
    assert.equal(all.body.rows[0].companyId, other.companyId, 'newest first');
    assert.equal(all.body.rows[0].action, 'company.suspend');
    assert.ok(all.body.total >= 5);
    assert.deepEqual(all.body.actions, ['trial.extend', 'plan.set', 'company.suspend', 'company.reactivate', 'view.company', 'view.user', 'view.users', 'view.billing', 'view.logs']);
    const byCompany = await call('GET', `/console/audit?company=${target.companyId}`, { token: t });
    assert.deepEqual(byCompany.body.rows.map((r: { action: string }) => r.action), ['company.reactivate', 'company.suspend', 'plan.set', 'trial.extend']);
    assert.equal(byCompany.body.rows[0].companyName, 'Audit Target Co');
    const byCode = await call('GET', `/console/audit?company=${code.toLowerCase()}&action=plan.set`, { token: t });
    assert.deepEqual([byCode.body.total, byCode.body.rows[0].action], [1, 'plan.set']);
    const page2 = await call('GET', `/console/audit?company=${target.companyId}&pageSize=3&page=2`, { token: t });
    assert.deepEqual([page2.body.total, page2.body.page, page2.body.rows.length, page2.body.rows[0].action], [4, 2, 1, 'trial.extend']);
    assert.equal((await call('GET', '/console/audit?action=delete.everything', { token: t })).status, 400);
    // Download: the same filters as a file (staff only).
    const csv = await fetch(`${base}/console/audit?company=${target.companyId}&export=csv`, { headers: { authorization: `Bearer ${t}` } });
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.match(text, /When.*Action.*Company/);
    assert.equal((text.match(/trial\.extend|plan\.set|company\.suspend|company\.reactivate/g) ?? []).length, 4);
    const denied = await fetch(`${base}/console/audit?export=csv`, { headers: { authorization: `Bearer ${target.accessToken}` } });
    assert.equal(denied.status, 403);
  });
});

describe('forgot password and codes (quality pass 2026-10-19)', () => {
  const old = (target: string) => dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));

  test('reset/verify checks the code without using it up: wrong codes count, the right one still resets', async () => {
    await signup('resetverify@co.test', { name: 'Reset Verify Co' });
    await old('resetverify@co.test');
    const f = await call('POST', '/auth/forgot', { body: { identifier: 'ResetVerify@co.test' } });
    assert.equal(f.status, 200);
    assert.equal(f.body.channel, 'email');
    const wrongCode = f.body.devCode === '000000' ? '111111' : '000000';
    const wrong = await call('POST', '/auth/reset/verify', { body: { otpId: f.body.otpId, code: wrongCode } });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /Wrong code\. 4 tries left/);
    for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/reset/verify', { body: { otpId: f.body.otpId, code: f.body.devCode } })).status, 200, 'the right code gives its try back');
    const again = await call('POST', '/auth/reset/verify', { body: { otpId: f.body.otpId, code: wrongCode } });
    assert.match(again.body.message, /3 tries left/, 'only wrong codes count');
    const reset = await call('POST', '/auth/reset', { body: { otpId: f.body.otpId, code: f.body.devCode, newPassword: 'Fresh@Pass77' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await login('resetverify@co.test', 'Fresh@Pass77')).status, 200);
    assert.equal((await call('POST', '/auth/reset/verify', { body: { otpId: f.body.otpId, code: f.body.devCode } })).status, 400, 'used up by the reset');
    const expired = await call('POST', '/auth/reset/verify', { body: { otpId: randomUUID(), code: '123456' } });
    assert.match(expired.body.message, /expired/);
  });

  test('resend too soon: 429 with retryAfterSeconds and the seconds in the message (sign-up and forgot share it)', async () => {
    const first = await call('POST', '/signup/start', { body: { identifier: 'resend@wait.test' } });
    assert.equal(first.status, 200);
    const soon = await call('POST', '/auth/forgot', { body: { identifier: 'resend@wait.test' } });
    assert.equal(soon.status, 429);
    assert.ok(soon.body.retryAfterSeconds >= 1 && soon.body.retryAfterSeconds <= 30, JSON.stringify(soon.body));
    assert.match(soon.body.message, /You can ask for a new one in \d+ seconds/);
    const again = await call('POST', '/signup/start', { body: { identifier: 'resend@wait.test' } });
    assert.equal(again.status, 429);
    assert.ok(again.body.retryAfterSeconds >= 1);
  });

  test('forgot with a username, or with the email of an admin-made login: told to ask the admin; unknown email: same answer, then "no account"', async () => {
    const name = await call('POST', '/auth/forgot', { body: { identifier: 'ravi.k' } });
    assert.equal(name.status, 400);
    assert.match(name.body.message, /reset by your company admin/);
    const [co] = await dbs.db.insert(companies).values({ name: 'Admin Login Co', code: 'ADMINLOGINRESET', enabledApps: [] }).returning();
    const [p] = await dbs.db.insert(people).values({ companyId: co.id, fullName: 'Ada Admin-made', email: 'ada@adminmade.test' }).returning();
    await dbs.db.execute(sql`insert into platform.logins (person_id, password_hash) values (${p.id}, ${await hashPassword(PASSWORD)})`);
    const legacy = await call('POST', '/auth/forgot', { body: { identifier: 'ada@adminmade.test' } });
    const unknown = await call('POST', '/auth/forgot', { body: { identifier: 'ghost@nowhere.test' } });
    assert.deepEqual([legacy.status, unknown.status], [200, 200]);
    assert.deepEqual(Object.keys(legacy.body).sort(), Object.keys(unknown.body).sort(), 'no enumeration before the code');
    const a = await call('POST', '/auth/reset/verify', { body: { otpId: legacy.body.otpId, code: legacy.body.devCode } });
    assert.equal(a.status, 400);
    assert.match(a.body.message, /only your admin can reset/);
    const u = await call('POST', '/auth/reset/verify', { body: { otpId: unknown.body.otpId, code: unknown.body.devCode } });
    assert.match(u.body.message, /no Kaampilot account/);
  });

  test('an existing account signs up a second company without a name; a new account must give one', async () => {
    await signup('noname@co.test', { name: 'Noname One' });
    const v = await verified('noname@co.test');
    assert.equal(v.accountExists, true);
    const ok = await call('POST', '/signup/complete', { body: { signupToken: v.signupToken, fullName: '', password: PASSWORD, company: { name: 'Noname Two', apps: ['tasks'] } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.setupIncomplete, false);
    const n = await verified('fresh-noname@co.test');
    const missing = await call('POST', '/signup/complete', { body: { signupToken: n.signupToken, password: PASSWORD, company: { name: 'Fresh Co', apps: ['tasks'] } } });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.message, 'Enter your name');
  });
});

describe('account usernames (PLAN.md §21.5)', () => {
  const avail = async (u: string, token?: string) => (await call('GET', `/auth/username-available?u=${encodeURIComponent(u)}`, { token })).body;
  let owner = '';
  let companyId = '';
  const suffix = randomUUID().slice(0, 6);
  const asha = `asha.rao${suffix}`;

  before(async () => {
    const res = await signup(`asha-${suffix}@names.test`, { name: `Names Co ${suffix}` }, PASSWORD, 'Asha Rao', asha);
    owner = res.accessToken;
    companyId = res.companyId;
  });

  test('sign-up stores the username lower-case; auth/me shows it', async () => {
    const [a] = await dbs.db.select().from(accounts).where(sql`lower(${accounts.email}) = ${`asha-${suffix}@names.test`}`);
    assert.equal(a.username, asha);
    const me = await call('GET', '/auth/me', { token: owner });
    assert.equal(me.body.account.username, asha);
  });

  test('availability: valid, taken (accounts, any case), taken by an admin-made login or an employee ID, reserved, invalid', async () => {
    const free = await avail(`Fresh.Name_${suffix}`);
    assert.deepEqual([free.available, free.message], [true, 'Available']);
    const taken = await avail(asha.toUpperCase());
    assert.deepEqual(taken, { available: false, reason: 'taken', message: 'This username is already taken. Try another.' });
    // An admin-made login's username (another table) is taken too.
    const made = await call('POST', '/people', { token: owner, body: { fullName: 'Made Login', employeeCode: `EMP${suffix}`, login: { username: `madelogin${suffix}`, password: PASSWORD } } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await avail(`MadeLogin${suffix}`)).reason, 'taken');
    assert.equal((await avail(`emp${suffix}`)).reason, 'taken', 'an employee ID would make sign-in ambiguous');
    for (const r of ['admin', 'Owner', 'support', 'freefounders', 'root', 'api', 'administrator2']) {
      assert.deepEqual(await avail(r), { available: false, reason: 'reserved', message: 'This username is reserved.' }, r);
    }
    for (const bad of ['ab', '9876543210', '1abc', 'a@b.co', 'has space', 'x'.repeat(31), '', '_lead', 'émile']) {
      assert.deepEqual(await avail(bad), { available: false, reason: 'invalid', message: 'Use 3–30 letters, numbers, dots, - or _, starting with a letter.' }, bad);
    }
    // Signed in: the caller's own name counts as free (the /account page).
    assert.equal((await avail(asha, owner)).available, true);
  });

  test('sign-up: username required for a new account; taken (case variant, admin-made login) gives 409 on the field; invalid gives 400', async () => {
    const t = await verified(`dup-${suffix}@names.test`);
    const body = (username?: string) => ({ signupToken: t.signupToken, fullName: 'Dup Person', password: PASSWORD, ...(username === undefined ? {} : { username }), company: { name: 'Dup Co', apps: ['tasks'] } });
    const none = await call('POST', '/signup/complete', { body: body() });
    assert.deepEqual([none.status, none.body.errors?.username], [400, 'Choose a username']);
    const upper = await call('POST', '/signup/complete', { body: body(asha.toUpperCase()) });
    assert.equal(upper.status, 409);
    assert.deepEqual([upper.body.field, upper.body.message, upper.body.errors.username], ['username', 'This username is already taken. Try another.', 'This username is already taken. Try another.']);
    assert.equal((await call('POST', '/signup/complete', { body: body(`MADELOGIN${suffix}`) })).status, 409);
    const reserved = await call('POST', '/signup/complete', { body: body('owner') });
    assert.deepEqual([reserved.status, reserved.body.errors?.username], [400, 'This username is reserved.']);
    assert.equal((await call('POST', '/signup/complete', { body: body('12345') })).status, 400);
    // The sign-up token was not used up: choosing another name finishes the sign-up.
    const ok = await call('POST', '/signup/complete', { body: body(`Dup.Person${suffix}`) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const [a] = await dbs.db.select({ username: accounts.username }).from(accounts).where(sql`lower(${accounts.email}) = ${`dup-${suffix}@names.test`}`);
    assert.equal(a.username, `dup.person${suffix}`);
  });

  test('the unique index is the last word: two accounts cannot hold the same name in any case', async () => {
    const [a] = await dbs.db.select().from(accounts).where(sql`lower(${accounts.email}) = ${`asha-${suffix}@names.test`}`);
    await assert.rejects(dbs.db.insert(accounts).values({ fullName: 'Copy', username: asha.toUpperCase(), passwordHash: a.passwordHash }));
  });

  test('sign-in by account username (any case); wrong password = the same 401 as an unknown name', async () => {
    const ok = await login(asha.toUpperCase());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(decodeJwt(ok.body.accessToken).cid, companyId);
    const wrong = await login(asha, 'Wrong@pass9');
    const unknown = await login(`nobody${suffix}`, 'Wrong@pass9');
    assert.deepEqual([wrong.status, unknown.status], [401, 401]);
    assert.equal(wrong.body.message, unknown.body.message);
    // An admin-made login with a username still signs in as before.
    assert.equal((await login(`madelogin${suffix}`)).status, 200);
  });

  test('an account in two companies signs in by username, chooses a company, gets tokens for the chosen one', async () => {
    const v = await verified(`asha-${suffix}@names.test`);
    const second = await call('POST', '/signup/complete', { body: { signupToken: v.signupToken, password: PASSWORD, company: { name: `Names Two ${suffix}`, apps: ['tasks'] } } });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const first = await login(asha);
    assert.equal(first.status, 200);
    assert.equal(first.body.chooseCompany.length, 2);
    const picked = await call('POST', '/auth/login', { body: { ticket: first.body.ticket, companyId: second.body.companyId } });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.equal(decodeJwt(picked.body.accessToken).cid, second.body.companyId);
  });

  test('change username: same checks, 409 when taken, the new name signs in, the old one no longer', async () => {
    const t = await verified(`changer-${suffix}@names.test`);
    const res = await call('POST', '/signup/complete', { body: { signupToken: t.signupToken, fullName: 'Chan Ger', password: PASSWORD, username: `changer${suffix}`, company: { name: `Changer ${suffix}`, apps: ['tasks'] } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const token = res.body.accessToken;
    assert.equal((await call('PUT', '/auth/username', { token, body: { username: asha } })).status, 409);
    assert.equal((await call('PUT', '/auth/username', { token, body: { username: `madelogin${suffix}` } })).status, 409);
    assert.equal((await call('PUT', '/auth/username', { token, body: { username: 'admin' } })).status, 400);
    assert.equal((await call('PUT', '/auth/username', { token, body: { username: '99' } })).status, 400);
    const same = await call('PUT', '/auth/username', { token, body: { username: `CHANGER${suffix}` } });
    assert.equal(same.status, 200, 'its own name, in another case');
    const moved = await call('PUT', '/auth/username', { token, body: { username: `Changed.Now${suffix}` } });
    assert.deepEqual([moved.status, moved.body.username], [200, `changed.now${suffix}`]);
    assert.equal((await login(`changed.now${suffix}`)).status, 200);
    assert.equal((await login(`changer${suffix}`)).status, 401);
    // Without a username yet (an older account): it can add one.
    const [a] = await dbs.db.update(accounts).set({ username: null }).where(sql`lower(${accounts.email}) = ${`changer-${suffix}@names.test`}`).returning();
    assert.equal(a.username, null);
    assert.equal((await call('PUT', '/auth/username', { token, body: { username: `added${suffix}` } })).status, 200);
    // An admin-made login has no account: its username is the admin's to set.
    const made = await login(`madelogin${suffix}`);
    assert.equal((await call('PUT', '/auth/username', { token: made.body.accessToken, body: { username: `other${suffix}` } })).status, 403);
  });

  test('admins cannot give a login (new or renamed) or an employee ID an account username', async () => {
    const created = await call('POST', '/people', { token: owner, body: { fullName: 'Clash One', login: { username: asha.toUpperCase(), password: PASSWORD } } });
    assert.equal(created.status, 409, JSON.stringify(created.body));
    assert.equal(created.body.message, 'This username is already taken. Try another.');
    assert.equal(created.body.errors['login.username'], 'This username is already taken. Try another.');
    const p = await call('POST', '/people', { token: owner, body: { fullName: 'Clash Two' } });
    const renamed = await call('PUT', `/people/${p.body.person.id}/login`, { token: owner, body: { username: asha, password: PASSWORD } });
    assert.equal(renamed.status, 409);
    assert.equal(renamed.body.message, 'This username is already taken. Try another.');
    const code = await call('PATCH', `/people/${p.body.person.id}`, { token: owner, body: { employeeCode: asha } });
    assert.equal(code.status, 400);
    assert.equal((await call('PUT', `/people/${p.body.person.id}/login`, { token: owner, body: { username: `fine${suffix}`, password: PASSWORD } })).status, 200);
  });

  test('a new person joining by invite chooses a username (taken gives 409)', async () => {
    const link = (await call('POST', '/invites', { token: owner, body: { apps: [] } })).body;
    const t = await verified(`joiner-${suffix}@names.test`);
    const taken = await call('POST', `/invites/${link.token}/accept`, { body: { signupToken: t.signupToken, fullName: 'Jo Iner', password: PASSWORD, username: asha } });
    assert.deepEqual([taken.status, taken.body.field], [409, 'username']);
    const ok = await call('POST', `/invites/${link.token}/accept`, { body: { signupToken: t.signupToken, fullName: 'Jo Iner', password: PASSWORD, username: `jo.iner${suffix}` } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await login(`jo.iner${suffix}`)).status, 200);
  });

  test('availability checks are limited per address (60 a minute by default)', async () => {
    resetUsernameChecks();
    process.env.USERNAME_CHECK_IP_LIMIT = '3';
    try {
      for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/auth/username-available?u=abcdef')).status, 200);
      const limited = await call('GET', '/auth/username-available?u=abcdef');
      assert.equal(limited.status, 429);
      assert.ok(limited.body.retryAfterSeconds > 0);
    } finally {
      delete process.env.USERNAME_CHECK_IP_LIMIT;
      resetUsernameChecks();
    }
  });
});

describe('company names are unique (PLAN.md §21.6)', () => {
  const sfx = randomUUID().slice(0, 6);
  const NAME = `Unique Traders ${sfx}`;
  const takenMsg = (n: string) => `A company called "${n}" already exists. If you work there, ask its owner for an invite link.`;
  const avail = async (n: string, opts: { token?: string; rename?: boolean } = {}) =>
    (await call('GET', `/companies/name-available?n=${encodeURIComponent(n)}${opts.rename ? '&rename=1' : ''}`, { token: opts.token })).body;
  let owner = '';
  let companyId = '';

  before(async () => {
    const res = await signup(`unique-${sfx}@names.test`, { name: NAME });
    owner = res.accessToken;
    companyId = res.companyId;
  });

  test('availability: free, taken in any case / spacing, invalid by length', async () => {
    assert.deepEqual(await avail(`Fresh Name ${sfx}`), { available: true, message: 'Available' });
    for (const variant of [NAME, NAME.toUpperCase(), `  unique   traders ${sfx} `, `UNIQUE\ttraders  ${sfx}`]) {
      assert.deepEqual(await avail(variant), { available: false, reason: 'taken', message: takenMsg(variant.trim().replace(/\s+/g, ' ')) }, variant);
    }
    for (const bad of ['', 'x', '   a   ', 'y'.repeat(81)]) assert.equal((await avail(bad)).reason, 'invalid', bad);
    assert.equal((await avail('y'.repeat(80))).available, true);
    // Signed in: only a rename counts the caller's own company as free (New company must not reuse it).
    assert.equal((await avail(NAME, { token: owner })).available, false);
    assert.equal((await avail(NAME.toLowerCase(), { token: owner, rename: true })).available, true);
    assert.equal((await avail(NAME, { rename: true })).available, false, 'rename=1 without a sign-in changes nothing');
  });

  test('sign-up with a taken name: 409 on companyName, nothing used up; another name finishes it', async () => {
    const t = await verified(`second-${sfx}@names.test`);
    const body = (name: string) => ({ signupToken: t.signupToken, fullName: 'Second Founder', password: PASSWORD, username: `second${sfx}`, company: { name, apps: ['tasks'] } });
    const dup = await call('POST', '/signup/complete', { body: body(`  UNIQUE  traders ${sfx}`) });
    assert.equal(dup.status, 409, JSON.stringify(dup.body));
    assert.deepEqual([dup.body.field, dup.body.message, dup.body.errors.companyName], ['companyName', takenMsg(`UNIQUE traders ${sfx}`), takenMsg(`UNIQUE traders ${sfx}`)]);
    const [none] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(accounts).where(sql`lower(${accounts.email}) = ${`second-${sfx}@names.test`}`);
    assert.equal(none.n, 0, 'no account was made');
    const long = await call('POST', '/signup/complete', { body: body('z'.repeat(81)) });
    assert.equal(long.status, 400);
    const ok = await call('POST', '/signup/complete', { body: body(`  Second   Traders ${sfx} `) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await company(ok.body.companyId)).name, `Second Traders ${sfx}`, 'stored trimmed, inner spaces collapsed');
  });

  test("New company (POST companies) with a taken name: 409, even the caller's own company name", async () => {
    const own = await call('POST', '/companies', { token: owner, body: { name: NAME.toLowerCase(), apps: ['tasks'] } });
    assert.deepEqual([own.status, own.body.field], [409, 'companyName']);
    const other = await call('POST', '/companies', { token: owner, body: { name: `second traders ${sfx}`, apps: ['tasks'] } });
    assert.equal(other.status, 409);
    assert.equal((await call('GET', '/auth/me', { token: owner })).status, 200, 'a refused new company keeps the session');
  });

  test('rename (Settings): a taken name is 409; its own name (any case) is fine; a free name saves', async () => {
    const taken = await call('PATCH', '/company', { token: owner, body: { name: `SECOND traders ${sfx}` } });
    assert.deepEqual([taken.status, taken.body.field, taken.body.message], [409, 'companyName', takenMsg(`SECOND traders ${sfx}`)]);
    assert.equal((await company(companyId)).name, NAME);
    const same = await call('PATCH', '/company', { token: owner, body: { name: NAME.toUpperCase(), shortName: 'UT' } });
    assert.equal(same.status, 200, JSON.stringify(same.body));
    const renamed = await call('PATCH', '/company', { token: owner, body: { name: `Unique  Traders Renamed ${sfx}` } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal((await company(companyId)).name, `Unique Traders Renamed ${sfx}`);
    assert.equal((await avail(NAME)).available, true, 'the old name is free again');
    assert.equal((await call('PATCH', '/company', { token: owner, body: { name: NAME } })).status, 200);
  });

  test('two sign-ups with the same new name at once: exactly one wins', async () => {
    const name = `Race Co ${sfx}`;
    const tokens = await Promise.all([verified(`race1-${sfx}@names.test`), verified(`race2-${sfx}@names.test`)]);
    const results = await Promise.all(
      tokens.map((t, i) =>
        call('POST', '/signup/complete', { body: { signupToken: t.signupToken, fullName: `Racer ${i}`, password: PASSWORD, username: uname(), company: { name: i ? name.toUpperCase() : name, apps: ['tasks'] } } }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    const [rows] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(companies).where(sql`lower(${companies.name}) = ${name.toLowerCase()}`);
    assert.equal(rows.n, 1);
  });

  test('companies that already share a name (made before this rule) still load, sign in and save their settings', async () => {
    const twin = `Twin Co ${sfx}`;
    const made: Array<typeof companies.$inferSelect> = [];
    for (const [i, n] of [twin, ` twin  co ${sfx}`].entries()) {
      const [co] = await dbs.db.insert(companies).values({ name: n, code: `TWIN${i}X${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`, enabledApps: [] }).returning();
      const [p] = await dbs.db.insert(people).values({ companyId: co.id, fullName: `Twin Owner ${i}`, platformRole: 'owner' }).returning();
      await dbs.db.execute(sql`insert into platform.logins (person_id, username, password_hash) values (${p.id}, ${`twin${i}.${sfx}`}, ${await hashPassword(PASSWORD)})`);
      made.push(co);
    }
    for (const [i, co] of made.entries()) {
      const res = await login(`twin${i}.${sfx}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const me = await call('GET', '/auth/me', { token: res.body.accessToken });
      assert.equal(me.body.company.name, co.name);
      const save = await call('PATCH', '/company', { token: res.body.accessToken, body: { name: co.name, shortName: `T${i}` } });
      assert.equal(save.status, 200, JSON.stringify(save.body));
      assert.equal((await avail(co.name, { token: res.body.accessToken, rename: true })).available, false, 'the other twin still holds the name');
    }
    assert.equal((await company(made[1].id)).name, made[1].name, 'existing names are left as they are');
  });

  test('availability checks are limited per address (60 a minute by default)', async () => {
    resetCompanyNameChecks();
    process.env.COMPANY_NAME_CHECK_IP_LIMIT = '3';
    try {
      for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/companies/name-available?n=abc')).status, 200);
      const limited = await call('GET', '/companies/name-available?n=abc');
      assert.equal(limited.status, 429);
      assert.ok(limited.body.retryAfterSeconds > 0);
    } finally {
      delete process.env.COMPANY_NAME_CHECK_IP_LIMIT;
      resetCompanyNameChecks();
    }
  });
});
