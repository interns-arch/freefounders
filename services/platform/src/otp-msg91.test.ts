// MSG91 codes and sign in with a code (PLAN.md §21.8). Email only since 2026-10-27: the SMS path is tested on the
// sender itself, because no request can reach it. Run with `npm test`. No network: MSG91 is a local stand-in
// (MSG91_BASE_URL); the keys below are dummies, never real ones.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type INestApplication, Logger, type LoggerService } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { normaliseIdentifier } from './accounts/identifier';
import { msg91Config, Msg91OtpSender } from './accounts/msg91.sender';
import { EnvOtpSender } from './accounts/otp-senders';
import { hashPassword } from './auth/auth.service';
import { Throttle } from './auth/throttle';
import { DbService } from './db/db.service';
import { accounts, companies, logins, otpCodes, people } from './db/schema';
import { createApp } from './main';

const AUTHKEY = 'dummy-msg91-authkey-for-tests';
let app: INestApplication;
let base = '';
let dbs: DbService;
let msg91: Server;
let msg91Url = '';

/** What MSG91 should answer next: ok, an error body with 200, 400, 401, 500, or no answer at all. */
let mode: 'ok' | 'error200' | '400' | '401' | '500' | 'hang' = 'ok';
const received: Array<{ method: string; path: string; query: URLSearchParams; headers: IncomingHttpHeaders; body: any }> = [];
const logs: string[] = [];

class Capture implements LoggerService {
  log(m: unknown) {
    logs.push(String(m));
  }
  error(m: unknown) {
    logs.push(String(m));
  }
  warn(m: unknown) {
    logs.push(String(m));
  }
  debug() {}
  verbose() {}
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const m = /ff_refresh=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: m?.[1] };
}

/** Earlier codes for this identifier are made old, so the 30 s gap does not get in the way. */
async function ageCodes(identifier: string) {
  const target = normaliseIdentifier(identifier)!.value;
  await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
}

const rowsFor = async (identifier: string) => dbs.db.select().from(otpCodes).where(eq(otpCodes.target, normaliseIdentifier(identifier)!.value));

/** A random Indian mobile number. */
const mobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
/** A random email address. */
const email = () => `code-${randomUUID().slice(0, 8)}@mail.test`;
const MOBILE_OFF = 'Use your email address. Sign-in with a mobile number is not available.';
const EMAIL_ENV = { MSG91_EMAIL_TEMPLATE_ID: 'kaampilot_code', MSG91_EMAIL_FROM: 'no-reply@mail.kaampilot.test' };
const emailOn = () => Object.assign(process.env, EMAIL_ENV);
const emailOff = () => {
  delete process.env.MSG91_EMAIL_TEMPLATE_ID;
  delete process.env.MSG91_EMAIL_FROM;
};

/** An account in `n` new companies (rows only; no apps needed to sign in). */
async function accountIn(n: number, ident: { email?: string; mobile?: string }) {
  const [account] = await dbs.db
    .insert(accounts)
    .values({ fullName: 'Code Person', email: ident.email ?? null, mobile: ident.mobile ? normaliseIdentifier(ident.mobile)!.value : null, passwordHash: await hashPassword('Code@2026') })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const tag = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    const [c] = await dbs.db.insert(companies).values({ name: `Code Co ${tag}`, code: `CODE${tag}` }).returning();
    await dbs.db.insert(people).values({ companyId: c.id, fullName: account.fullName, email: account.email, mobile: account.mobile, platformRole: 'owner', accountId: account.id });
    ids.push(c.id);
  }
  return { account, companyIds: ids };
}

before(async () => {
  msg91 = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url!, 'http://x');
    received.push({ method: req.method!, path: url.pathname, query: url.searchParams, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (mode === 'hang') return; // never answers: the sender's timeout must end it
    if (mode === '500') return json(500, { message: 'Internal error', type: 'error' });
    if (mode === '401') return json(401, { message: 'Invalid authkey', type: 'error', code: '201' });
    if (mode === '400') return json(400, { message: 'Bad request', type: 'error' });
    if (mode === 'error200' && url.pathname === '/api/v5/email/send') return json(200, { status: 'fail', hasError: true, message: 'The template is invalid.' });
    if (mode === 'error200') return json(200, { message: 'The provided flow ID or template ID is invalid.', type: 'error' });
    if (url.pathname === '/api/v5/otp') return json(200, { request_id: '3561716b6c4a313233343536', type: 'success' });
    if (url.pathname === '/api/v5/email/send') return json(200, { status: 'success', data: { unique_id: 'a1d2e4b8-4d04-41f9-b8f2-34be6a5c6d49' }, errors: {}, hasError: false, message: 'Thank you. Your request has been queued.' });
    return json(404, { message: 'not here' });
  });
  await new Promise<void>((r) => msg91.listen(0, '127.0.0.1', r));
  msg91Url = `http://127.0.0.1:${(msg91.address() as AddressInfo).port}`;

  process.env.OTP_SENDER = 'msg91';
  process.env.MSG91_AUTHKEY = AUTHKEY;
  process.env.MSG91_SMS_TEMPLATE_ID = 'tmpl-sms-1';
  process.env.MSG91_BASE_URL = msg91Url;
  process.env.MSG91_TIMEOUT_MS = '300';
  emailOn();
  process.env.OTP_DEV_ECHO = '1';
  process.env.OTP_IP_LIMIT = '0';
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
  Logger.overrideLogger(new Capture());
});

after(async () => {
  await app?.close();
  msg91?.close();
});

beforeEach(() => {
  mode = 'ok';
  received.length = 0;
  app.get(Throttle).reset();
});

describe('MSG91 sender (PLAN.md §21.8)', () => {
  test('SMS (sender only; no request reaches it since email-only): SendOTP with OUR code, authkey header, 91XXXXXXXXXX, template id and variables; nothing secret in the log', async () => {
    const m = mobile();
    // A request with a mobile number never gets this far.
    const refused = await call('POST', '/signup/start', { identifier: `+91 ${m}` });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.message, MOBILE_OFF);
    assert.equal(received.length, 0);
    logs.length = 0;
    const sender = new Msg91OtpSender(msg91Config().config!);
    await sender.send({ kind: 'mobile', value: `+91${m}`, channel: 'sms' }, '424242', 'signup');
    assert.equal(received.length, 1);
    const r = received[0];
    assert.equal(r.method, 'POST');
    assert.equal(r.path, '/api/v5/otp');
    assert.equal(r.headers.authkey, AUTHKEY);
    assert.match(String(r.headers['content-type']), /application\/json/);
    assert.equal(r.query.get('template_id'), 'tmpl-sms-1');
    assert.equal(r.query.get('mobile'), `91${m}`);
    assert.equal(r.query.get('otp'), '424242', 'our code, so our checks stay the source of truth');
    assert.equal(r.query.get('otp_length'), '6');
    assert.equal(r.query.get('otp_expiry'), '10');
    assert.deepEqual(r.body, { app: 'Kaampilot', minutes: '10' });
    // The provider's request id is logged; the code and the authkey never are.
    assert.ok(logs.some((l) => l.includes('3561716b6c4a313233343536')), logs.join('\n'));
    assert.ok(!logs.some((l) => l.includes('424242') || l.includes(AUTHKEY) || l.includes(m)), logs.join('\n'));
  });

  test('refused by MSG91 (error body, 400): a plain message, the code is never usable, and asking again works at once', async () => {
    for (const m of ['error200', '400'] as const) {
      const num = email();
      mode = m;
      logs.length = 0;
      const res = await call('POST', '/auth/forgot', { identifier: num });
      assert.equal(res.status, 400, `${m}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.message, "We couldn't send the code. Check the email address and try again.");
      assert.equal(res.body.devCode, undefined);
      const [row] = await rowsFor(num);
      assert.ok(row.failedAt, 'marked failed');
      assert.ok(!logs.some((l) => l.includes(AUTHKEY)));
      mode = 'ok';
      const again = await call('POST', '/auth/forgot', { identifier: num });
      assert.equal(again.status, 200, `no 30 s wait after a failed send (${m}): ${JSON.stringify(again.body)}`);
      // The failed code cannot be used even if someone knew it.
      const bad = await call('POST', '/auth/reset/verify', { otpId: row.id, code: '000000' });
      assert.equal(bad.status, 400);
      assert.match(bad.body.message, /expired/);
    }
  });

  test('MSG91 down (500 or no answer within the timeout): 503, the row is failed, the quota is not used', async () => {
    for (const m of ['500', 'hang'] as const) {
      const num = email();
      mode = m;
      const started = Date.now();
      const res = await call('POST', '/signup/start', { identifier: num });
      assert.equal(res.status, 503, `${m}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.message, "We couldn't send the code right now. Try again in a minute.");
      assert.ok(Date.now() - started < 5000, 'the timeout ends the wait');
      // Five failed sends in a row still leave the person their five codes.
      for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/signup/start', { identifier: num })).status, 503);
      mode = 'ok';
      assert.equal((await call('POST', '/signup/start', { identifier: num })).status, 200, `${m}: quota untouched`);
      assert.equal((await rowsFor(num)).filter((r) => r.failedAt).length, 5);
    }
  });

  test('a wrong authkey (401) answers "codes can\'t be sent right now" and says why in the log', async () => {
    mode = '401';
    logs.length = 0;
    const res = await call('POST', '/signup/start', { identifier: email() });
    assert.equal(res.status, 503);
    assert.match(res.body.message, /Codes can't be sent right now/);
    assert.ok(logs.some((l) => /MSG91_AUTHKEY/.test(l)), logs.join('\n'));
    assert.ok(!logs.some((l) => l.includes(AUTHKEY)));
  });

  test('missing keys: 503 before anything is stored; the server keeps running', async () => {
    const num = email();
    delete process.env.MSG91_AUTHKEY;
    try {
      const res = await call('POST', '/signup/start', { identifier: num });
      assert.equal(res.status, 503);
      assert.equal(res.body.message, "Codes can't be sent right now. Try again later, or sign in with your password.");
      assert.equal((await rowsFor(num)).length, 0);
      assert.equal(received.length, 0);
    } finally {
      process.env.MSG91_AUTHKEY = AUTHKEY;
    }
    delete process.env.MSG91_SMS_TEMPLATE_ID;
    emailOff();
    try {
      assert.equal((await call('POST', '/signup/start', { identifier: email() })).status, 503);
    } finally {
      process.env.MSG91_SMS_TEMPLATE_ID = 'tmpl-sms-1';
      emailOn();
    }
  });

  test('email: MSG91 Email API with template, from, domain and variables once set up; before that dev keeps the fake sender, production says not set up', async () => {
    const email = `code-${randomUUID().slice(0, 8)}@mail.test`;
    emailOff();
    // Not set up, dev machine: the fake sender (log), nothing to MSG91.
    const dev = await call('POST', '/signup/start', { identifier: email });
    assert.equal(dev.status, 200);
    assert.equal(received.length, 0);
    // Not set up, production without DEMO_MODE: 503.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await ageCodes(email);
      const prod = await call('POST', '/signup/start', { identifier: email });
      assert.equal(prod.status, 503);
      assert.equal(prod.body.message, "Codes by email aren't set up yet. Sign in with your password, or try again later.");
    } finally {
      process.env.NODE_ENV = env;
    }
    // Set up: MSG91 email.
    emailOn();
    {
      received.length = 0;
      await ageCodes(email);
      const res = await call('POST', '/auth/login/code/start', { identifier: email });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.channel, 'email');
      assert.equal(received.length, 1);
      const r = received[0];
      assert.equal(r.path, '/api/v5/email/send');
      assert.equal(r.headers.authkey, AUTHKEY);
      assert.deepEqual(r.body, {
        recipients: [{ to: [{ email }], variables: { otp: res.body.devCode, minutes: '10', app: 'Kaampilot', purpose: 'sign in' } }],
        from: { name: 'Kaampilot', email: 'no-reply@mail.kaampilot.test' },
        domain: 'mail.kaampilot.test',
        template_id: 'kaampilot_code',
      });
    }
  });

  test('email only (no SMS template; founder 2026-10-24, 2026-10-27): email codes go by MSG91; a mobile number is refused on every path, dev or production, nothing stored or sent', async () => {
    delete process.env.MSG91_SMS_TEMPLATE_ID;
    const env = process.env.NODE_ENV;
    const demo = process.env.DEMO_MODE;
    try {
      // The startup line says which channels are on.
      delete process.env.DEMO_MODE;
      process.env.NODE_ENV = 'production';
      const line = new EnvOtpSender().describe();
      assert.match(line, /^One-time codes: MSG91 \(SMS: OFF \(MSG91 SMS not set up\); email: MSG91 Email\)$/, line);
      process.env.NODE_ENV = env;
      assert.match(new EnvOtpSender().describe(), /SMS: fake sender \(MSG91 SMS not set up\); email: MSG91 Email/);

      // Email sign-up works: MSG91 Email API, and the code verifies.
      const res = await call('POST', '/signup/start', { identifier: email() });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.channel, 'email');
      assert.equal(received.length, 1);
      assert.equal(received[0].path, '/api/v5/email/send');
      assert.equal(received[0].body.template_id, 'kaampilot_code');
      assert.equal(received[0].body.recipients[0].variables.purpose, 'finish signing up');
      assert.equal((await call('POST', '/signup/verify', { otpId: res.body.otpId, code: res.body.devCode })).status, 200);

      // A mobile number: 400 with the email-only message on dev, the open demo and production alike.
      received.length = 0;
      for (const [nodeEnv, demoMode] of [[env, undefined], ['production', '1'], ['production', undefined]] as const) {
        process.env.NODE_ENV = nodeEnv;
        if (demoMode === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = demoMode;
        for (const path of ['/signup/start', '/auth/forgot', '/auth/login/code/start']) {
          const num = mobile();
          const r = await call('POST', path, { identifier: num });
          assert.equal(r.status, 400, `${path}: ${JSON.stringify(r.body)}`);
          assert.equal(r.body.message, MOBILE_OFF);
          assert.equal(r.body.errors.identifier, 'Use your email address');
          assert.equal((await rowsFor(num)).length, 0);
        }
      }
      assert.equal(received.length, 0);
      // Email still works in production.
      const prodEmail = await call('POST', '/auth/forgot', { identifier: email() });
      assert.equal(prodEmail.status, 200, JSON.stringify(prodEmail.body));
      assert.equal(received.length, 1);
    } finally {
      process.env.NODE_ENV = env;
      if (demo === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = demo;
      process.env.MSG91_SMS_TEMPLATE_ID = 'tmpl-sms-1';
    }
  });

  test('config: only a missing authkey, or neither channel, switches codes off', () => {
    const base = { MSG91_AUTHKEY: 'k' };
    assert.match(String(msg91Config({}).problem), /MSG91_AUTHKEY is not set/);
    assert.match(String(msg91Config(base).problem), /neither MSG91_SMS_TEMPLATE_ID nor MSG91_EMAIL_TEMPLATE_ID/);
    assert.equal(msg91Config({ ...base, MSG91_SMS_TEMPLATE_ID: 't' }).problem, null);
    const emailOnly = msg91Config({ ...base, MSG91_EMAIL_TEMPLATE_ID: 'e', MSG91_EMAIL_FROM: 'no-reply@mail.kaampilot.com' });
    assert.equal(emailOnly.problem, null);
    assert.equal(emailOnly.config?.smsTemplateId, null);
    assert.equal(emailOnly.config?.email?.domain, 'mail.kaampilot.com');
    // A template without a From is not email.
    assert.ok(msg91Config({ ...base, MSG91_EMAIL_TEMPLATE_ID: 'e' }).problem);
  });
});

describe('sign in with a code (PLAN.md §21.8)', () => {
  test('email of an account in one company: code → tokens and the refresh cookie, like a password sign-in; its stored mobile number does not sign in', async () => {
    const m = email();
    const num = mobile();
    const { companyIds } = await accountIn(1, { email: m, mobile: num });
    const byMobile = await call('POST', '/auth/login/code/start', { identifier: num });
    assert.equal(byMobile.status, 400);
    assert.equal(byMobile.body.message, MOBILE_OFF);
    const start = await call('POST', '/auth/login/code/start', { identifier: m });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.channel, 'email');
    assert.equal(received[0].body.recipients[0].to[0].email, m);
    const res = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: start.body.devCode });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken);
    assert.ok(res.cookie, 'refresh cookie');
    assert.equal(res.body.mustChangePassword, false);
    assert.equal(decodeJwt(res.body.accessToken).cid, companyIds[0]);
    const again = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: start.body.devCode });
    assert.equal(again.status, 400, 'a code signs in once');
  });

  test('wrong codes count down, then the code is gone', async () => {
    const m = email();
    await accountIn(1, { email: m });
    const start = await call('POST', '/auth/login/code/start', { identifier: m });
    const wrong = start.body.devCode === '000000' ? '111111' : '000000';
    const first = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: wrong });
    assert.equal(first.status, 400);
    assert.equal(first.body.message, 'Wrong code. 4 tries left.');
    for (let i = 0; i < 4; i++) await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: wrong });
    const right = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: start.body.devCode });
    assert.equal(right.status, 400);
    assert.match(right.body.message, /tried too many times/);
  });

  test('several companies: the choice and a ticket, then auth/login {ticket, companyId}', async () => {
    const email = `multi-${randomUUID().slice(0, 8)}@code.test`;
    const { companyIds } = await accountIn(2, { email });
    const start = await call('POST', '/auth/login/code/start', { identifier: email.toUpperCase() });
    assert.equal(start.status, 200);
    const choose = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: start.body.devCode });
    assert.equal(choose.status, 200, JSON.stringify(choose.body));
    assert.equal(choose.cookie, undefined);
    assert.equal(choose.body.chooseCompany.length, 2);
    const pick = await call('POST', '/auth/login', { ticket: choose.body.ticket, companyId: companyIds[1] });
    assert.equal(pick.status, 200);
    assert.equal(decodeJwt(pick.body.accessToken).cid, companyIds[1]);
  });

  test('no account: the same answer at the start; only the code reveals it', async () => {
    const known = email();
    await accountIn(1, { email: known });
    const unknown = email();
    const a = await call('POST', '/auth/login/code/start', { identifier: known });
    const b = await call('POST', '/auth/login/code/start', { identifier: unknown });
    assert.equal(a.status, b.status);
    assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
    const v = await call('POST', '/auth/login/code/verify', { otpId: b.body.otpId, code: b.body.devCode });
    assert.equal(v.status, 400);
    assert.match(v.body.message, /no Kaampilot account/);
  });

  test('admin-made logins: a username gets password guidance; an admin-made email is told to use its password', async () => {
    const user = await call('POST', '/auth/login/code/start', { identifier: 'ravi.k' });
    assert.equal(user.status, 400);
    assert.match(user.body.message, /sign in with your password/);
    assert.equal((await call('POST', '/auth/login/code/start', { identifier: '12345' })).status, 400);

    const email = `admin-made-${randomUUID().slice(0, 8)}@code.test`;
    const tag = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    const [c] = await dbs.db.insert(companies).values({ name: `Admin Co ${tag}`, code: `ADM${tag}` }).returning();
    const [p] = await dbs.db.insert(people).values({ companyId: c.id, fullName: 'Admin Made', email }).returning();
    await dbs.db.insert(logins).values({ personId: p.id, username: `adm${tag.toLowerCase()}`, passwordHash: await hashPassword('Admin@2026') });
    const start = await call('POST', '/auth/login/code/start', { identifier: email });
    assert.equal(start.status, 200);
    const v = await call('POST', '/auth/login/code/verify', { otpId: start.body.otpId, code: start.body.devCode });
    assert.equal(v.status, 400);
    assert.match(v.body.message, /login your company admin made. Sign in with your password/);
  });

  test('same limits as every code: 30 s gap, and the per-IP sign-in guard', async () => {
    const m = email();
    await accountIn(1, { email: m });
    assert.equal((await call('POST', '/auth/login/code/start', { identifier: m })).status, 200);
    const soon = await call('POST', '/auth/login/code/start', { identifier: m });
    assert.equal(soon.status, 429);
    assert.ok(soon.body.retryAfterSeconds > 0);
    process.env.LOGIN_IP_LIMIT = '2';
    try {
      const bad = { otpId: randomUUID(), code: '123456' };
      assert.equal((await call('POST', '/auth/login/code/verify', bad)).status, 400);
      assert.equal((await call('POST', '/auth/login/code/verify', bad)).status, 400);
      assert.equal((await call('POST', '/auth/login/code/verify', bad)).status, 429, 'blocked like wrong passwords');
    } finally {
      delete process.env.LOGIN_IP_LIMIT;
    }
  });
});
