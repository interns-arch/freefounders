// Kaampilot console dashboard + production log (PLAN.md §21.9). Run with `npm test` (shares the throwaway
// `ff_platform_test` database with the other suites; only adds its own rows and compares against live counts).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { normaliseIdentifier } from './accounts/identifier';
import { resetCompanyNameChecks } from './company/company-name';
import { resetUsernameChecks } from './accounts/username';
import { AllExceptionsFilter } from './common/exception.filter';
import { ConsoleDashboardService } from './console/console.service';
import { cleanLog, flushLogs, platformLog, redactLog, resetLogSink } from './console/log-sink';
import { LogsService } from './console/logs.service';
import { DbService } from './db/db.service';
import { otpCodes, serviceLogs, staffAudit } from './db/schema';
import { createApp } from './main';

const SECRET = 'test-fakepay-secret-console';
const PASSWORD = 'Console@2026';
let app: INestApplication;
let origin = '';
let base = '';
let dbs: DbService;
let fake: Server;
let nextUserId = 5000;
let tasksHealthy = true;

interface Res {
  status: number;
  body: any;
  text: string;
  type: string | null;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; absolute?: boolean } = {}): Promise<Res> {
  const res = await fetch((opts.absolute ? origin : base) + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const type = res.headers.get('content-type');
  let body: any = null;
  try {
    body = text && type?.includes('json') ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text, type };
}

const uname = () => `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;

async function signup(identifier: string, companyName: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const res = await call('POST', '/signup/complete', {
    body: { signupToken: v.body.signupToken, fullName: 'Console Tester', password: PASSWORD, username: uname(), company: { name: companyName, teamSize: '1-10', industry: 'Retail', state: 'Karnataka', apps: ['tasks'] } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string };
}

/** POST /internal/logs as Tasks / Assets do (outside /api/platform). */
const ingest = (body: unknown, headers: Record<string, string> = {}) => call('POST', '/internal/logs', { absolute: true, body, headers });

let owner: { accessToken: string; companyId: string };
let staff: { accessToken: string; companyId: string };

before(async () => {
  fake = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    // Health probes of the console's Health strip.
    if (req.url === '/health') return json(tasksHealthy ? 200 : 503, { status: 'ok', version: 'tasks-abc123' });
    if (req.url === '/assets/api/health') return json(200, { status: 'ok', version: 'assets-def456' });
    const path = req.url!.replace(/^\/(tasks|assets)\/api\/internal/, '').split('?')[0];
    void decodeJwt(String(req.headers.authorization).slice(7));
    const body = raw ? JSON.parse(raw) : null;
    if (req.method === 'POST' && path === '/companies') return json(201, { companyId: body.companyId, schema: `co_${String(body.code).toLowerCase()}`, created: true });
    if (req.method === 'POST' && path === '/provision') return json(200, { userId: nextUserId++ });
    if (path === '/permissions') return json(200, { app: 'tasks', scopes: [], permissions: [{ key: 'tasks.view', label: 'See', group: 'All', scopes: null }] });
    if (req.method === 'GET' && path === '/access') return json(200, { version: 0, roles: [], people: [] });
    if (req.method === 'PUT' && path === '/access') return json(200, { applied: true, problems: [] });
    if (path === '/modules') return json(200, { app: 'tasks', modules: [{ key: 'm1', label: 'M1', description: '', default: true }] });
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
  delete process.env.LOG_SINK_TOKEN;
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  base = `${origin}/api/platform`;
  dbs = app.get(DbService);
  resetUsernameChecks();
  resetCompanyNameChecks();
  owner = await signup(`owner-${randomUUID().slice(0, 6)}@console.test`, `Console Owner ${randomUUID().slice(0, 6)}`);
  staff = await signup(`staff-${randomUUID().slice(0, 6)}@console.test`, `Console Staff ${randomUUID().slice(0, 6)}`);
  const me = decodeJwt(staff.accessToken);
  await dbs.db.execute(sql`update platform.accounts set is_staff = true where id = (select account_id from platform.people where id = ${me.sub as string})`);
});

after(async () => {
  await app?.close();
  fake?.close();
});

beforeEach(() => {
  resetLogSink();
  app.get(ConsoleDashboardService).resetViewDedupe();
});

describe('guard: staff only', () => {
  test('a company owner (not staff) gets 403 on every dashboard endpoint; nothing is audited', async () => {
    const before = (await dbs.db.select({ n: sql<number>`count(*)::int` }).from(staffAudit))[0].n;
    for (const path of [
      '/console/overview',
      '/console/health',
      '/console/dashboard/companies',
      `/console/dashboard/companies/${owner.companyId}`,
      '/console/users',
      `/console/users/account/${randomUUID()}`,
      '/console/billing',
      '/console/billing?export=csv&sheet=payments',
      '/console/logs',
      '/console/logs?export=csv',
    ]) {
      const res = await call('GET', path, { token: owner.accessToken });
      assert.equal(res.status, 403, path);
    }
    assert.equal((await call('GET', '/console/overview')).status, 401, 'no token');
    const afterN = (await dbs.db.select({ n: sql<number>`count(*)::int` }).from(staffAudit))[0].n;
    assert.equal(afterN, before);
  });
});

describe('overview counts', () => {
  test('companies, people, accounts, sign-ups per day, OTP sends, active users match the database', async () => {
    const res = await call('GET', '/console/overview', { token: staff.accessToken });
    assert.equal(res.status, 200, res.text);
    const o = res.body;
    const one = async (q: ReturnType<typeof sql>) => Number(((await dbs.db.execute(q)).rows[0] as { n: number }).n);
    assert.equal(o.companies.total, await one(sql`select count(*)::int as n from platform.companies`));
    assert.equal(o.people.total, await one(sql`select count(*)::int as n from platform.people`));
    assert.equal(o.people.accounts, await one(sql`select count(*)::int as n from platform.accounts`));
    assert.ok(o.companies.trialing >= 2, 'both new companies are on a trial');
    assert.equal(o.signups.length, 30);
    const today = o.signups[o.signups.length - 1];
    assert.equal(today.accounts, await one(sql`select count(*)::int as n from platform.accounts where created_at >= date_trunc('day', now())`));
    assert.equal(today.companies, await one(sql`select count(*)::int as n from platform.companies where created_at >= date_trunc('day', now())`));
    assert.equal(o.otpToday.sent, await one(sql`select count(*)::int as n from platform.otp_codes where created_at >= date_trunc('day', now()) and failed_at is null`));
    assert.ok(o.otpToday.sent >= 2);
    assert.ok(o.activeUsers.today >= 2, 'the two people who just signed in');
    assert.ok(o.activeUsers.d7 >= o.activeUsers.today && o.activeUsers.d30 >= o.activeUsers.d7);
    assert.equal(typeof o.billing.mrr, 'number');
    assert.equal(typeof o.billing.revenueMonth, 'number');
  });

  test('punch-ins today come from the Tasks worker heartbeat', async () => {
    const hb = await ingest({ service: 'tasks-worker', version: 'w-1', entries: [], heartbeat: { data: { results: { ok: 3, failed: 0, skipped: 0 }, punchesToday: { total: 7, byCompany: { [owner.companyId]: 7 } } } } });
    assert.equal(hb.status, 202, hb.text);
    const o = (await call('GET', '/console/overview', { token: staff.accessToken })).body;
    assert.equal(o.punchesToday.total, 7);
    const h = await call('GET', '/console/health', { token: staff.accessToken });
    assert.equal(h.status, 200);
    const by = Object.fromEntries(h.body.services.map((s: { service: string }) => [s.service, s]));
    assert.equal(by.platform.up, true);
    assert.deepEqual([by.tasks.up, by.tasks.version], [true, 'tasks-abc123']);
    assert.deepEqual([by.assets.up, by.assets.version], [true, 'assets-def456']);
    assert.deepEqual([by['tasks-worker'].up, by['tasks-worker'].version], [true, 'w-1']);
    tasksHealthy = false;
    const down = await call('GET', '/console/health', { token: staff.accessToken });
    tasksHealthy = true;
    assert.equal(down.body.services.find((s: { service: string }) => s.service === 'tasks').up, false);
  });
});

describe('companies, users, billing (read-only, audited)', () => {
  test('companies list and detail; a detail view writes one view.company audit row (deduplicated)', async () => {
    const list = await call('GET', '/console/dashboard/companies', { token: staff.accessToken });
    assert.equal(list.status, 200);
    const row = list.body.find((c: { id: string }) => c.id === owner.companyId);
    assert.ok(row, 'the owner company is listed');
    assert.equal(row.state, 'trialing');
    assert.ok(row.lastActivity, 'last activity from the sign-in');
    assert.equal(row.people, 1);
    const detail = await call('GET', `/console/dashboard/companies/${owner.companyId}`, { token: staff.accessToken });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.body.people.length, 1);
    assert.equal(detail.body.people[0].role, 'owner');
    assert.match(detail.body.people[0].login, /^[a-z0-9]/);
    assert.equal(detail.body.subscription.state, 'trialing');
    await call('GET', `/console/dashboard/companies/${owner.companyId}`, { token: staff.accessToken });
    const rows = await dbs.db.select().from(staffAudit).where(and(eq(staffAudit.companyId, owner.companyId), eq(staffAudit.action, 'view.company')));
    assert.equal(rows.length, 1, 'one row for two views within 10 minutes');
    assert.equal(rows[0].companyCode, row.code);
    const audit = await call('GET', `/console/audit?company=${owner.companyId}&action=view.company`, { token: staff.accessToken });
    assert.equal(audit.body.total, 1);
    assert.equal((await call('GET', `/console/dashboard/companies/${randomUUID()}`, { token: staff.accessToken })).status, 404);
  });

  test('users: emails and mobiles masked, search, detail with memberships (audited)', async () => {
    const res = await call('GET', '/console/users?q=owner-', { token: staff.accessToken });
    assert.equal(res.status, 200);
    const u = res.body.rows.find((r: { companies: string[] }) => r.companies.some((c) => c.startsWith('Console Owner')));
    assert.ok(u);
    assert.match(u.email, /^ow\*\*\*@console\.test$/);
    assert.equal(u.kind, 'account');
    assert.equal(u.verified, true);
    assert.ok(!JSON.stringify(res.body).includes('password'), 'no password fields');
    const d = await call('GET', `/console/users/account/${u.id}`, { token: staff.accessToken });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.memberships.length, 1);
    assert.equal(d.body.memberships[0].role, 'owner');
    const [a] = await dbs.db.select().from(staffAudit).where(eq(staffAudit.action, 'view.user')).orderBy(sql`at desc`).limit(1);
    assert.equal((a.details as { id?: string }).id, u.id);
    const csv = await call('GET', '/console/users?export=csv', { token: staff.accessToken });
    assert.equal(csv.status, 200);
    assert.match(csv.type ?? '', /text\/csv/);
    assert.ok(!/owner-[a-f0-9]{6}@console/.test(csv.text), 'the download is masked too');
  });

  test('billing: a FakePay purchase shows in payments, invoices, revenue by month; downloads', async () => {
    const co = await call('POST', '/billing/checkout', { token: owner.accessToken, body: { plan: 'tasks', interval: 'month', seats: 5 } });
    assert.equal(co.status, 200, co.text);
    const done = await call('POST', `/billing/fake/${co.body.sessionId}/complete`, { token: owner.accessToken, body: { outcome: 'success' } });
    assert.equal(done.status, 200, done.text);
    const b = await call('GET', '/console/billing', { token: staff.accessToken });
    assert.equal(b.status, 200);
    const pay = b.body.payments.find((p: { companyId: string }) => p.companyId === owner.companyId);
    assert.deepEqual([pay.gateway, pay.status], ['fake', 'captured']);
    assert.ok(b.body.invoices.some((i: { companyId: string }) => i.companyId === owner.companyId));
    assert.equal(b.body.months.length, 12);
    assert.ok(b.body.months[11].revenue >= pay.amount);
    const o = (await call('GET', '/console/overview', { token: staff.accessToken })).body;
    assert.ok(o.billing.revenueMonth >= pay.amount && o.billing.paidSeats >= 5);
    for (const sheet of ['subscriptions', 'invoices', 'payments', 'months']) {
      const f = await call('GET', `/console/billing?export=xlsx&sheet=${sheet}`, { token: staff.accessToken });
      assert.equal(f.status, 200, sheet);
      assert.match(f.type ?? '', /spreadsheetml/);
    }
    // The webhook that FakePay sent is in the production log (an info event, no payload).
    const logs = await call('GET', '/console/logs?q=webhook', { token: staff.accessToken });
    assert.ok(logs.body.rows.some((r: { event: string; message: string }) => r.event === 'billing.webhook' && /^fake /.test(r.message)));
  });
});

describe('production log sink', () => {
  test('redaction: tokens, passwords, codes, emails, SQL params and query strings never stored', () => {
    const jwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    const out = redactLog(`Bearer abc.def password=hunter2 token: "t0ps3cret" ${jwt} OTP 123456 for asha@example.com params: $1=secret`);
    for (const bad of ['abc.def', 'hunter2', 't0ps3cret', jwt, '123456', 'asha@', 'params: $1']) assert.ok(!out.includes(bad), `${bad} in ${out}`);
    assert.match(out, /Bearer \[hidden\]/);
    assert.match(out, /a\*\*\*@example\.com/);
    const row = cleanLog({ message: 'ValueError: x\nsecond line', path: '/api/x?token=abc&code=123456', stack: 'a'.repeat(9000), status: 500, companyId: 'not-a-uuid' });
    assert.equal(row.message, 'ValueError: x');
    assert.equal(row.path, '/api/x');
    assert.equal(row.stack!.length, 4000);
    assert.equal(row.companyId, null);
  });

  test('Tasks / Assets entries are stored redacted with their company code; the list filters and downloads', async () => {
    const res = await ingest({
      service: 'tasks',
      version: 'v9',
      entries: [
        { level: 'error', kind: 'exception', event: 'request.failed', message: 'KeyError: password=hunter2 Bearer xyz', stack: 'Traceback… token=abc', method: 'POST', path: '/api/hr/punch?otp=123456', status: 500, companyId: owner.companyId, userId: 42, count: 3 },
        { level: 'warn', kind: 'event', event: 'worker.failed', message: 'reminders failed for 9876543210' },
      ],
    });
    assert.equal(res.status, 202, res.text);
    assert.equal(res.body.accepted, 2);
    const list = await call('GET', `/console/logs?service=tasks&company=${owner.companyId}`, { token: staff.accessToken });
    assert.equal(list.status, 200);
    const e = list.body.rows.find((r: { event: string }) => r.event === 'request.failed');
    assert.ok(e, JSON.stringify(list.body));
    assert.equal(e.path, '/api/hr/punch');
    assert.ok(!/hunter2|xyz|abc|123456/.test(JSON.stringify(e)));
    assert.deepEqual([e.status, e.count, e.userId, e.version, e.method], [500, 3, '42', 'v9', 'POST']);
    const code = (await call('GET', `/console/dashboard/companies/${owner.companyId}`, { token: staff.accessToken })).body.company.code;
    assert.equal(e.companyCode, code);
    const warn = await call('GET', '/console/logs?level=warn&q=reminders', { token: staff.accessToken });
    assert.ok(warn.body.rows.some((r: { message: string }) => r.message.includes('[digits]')));
    const csv = await call('GET', '/console/logs?export=csv&service=tasks', { token: staff.accessToken });
    assert.equal(csv.status, 200);
    assert.ok(!csv.text.includes('hunter2'));
    assert.ok((await dbs.db.select().from(staffAudit).where(eq(staffAudit.action, 'view.logs'))).length >= 1, 'log views are audited');
  });

  test('ingest: refused through a proxy or without the token when one is set; bad bodies 400', async () => {
    assert.equal((await ingest({ service: 'tasks', entries: [{ message: 'x' }] }, { 'x-forwarded-for': '1.2.3.4' })).status, 403);
    assert.equal((await ingest({ service: 'nope', entries: [] })).status, 400);
    process.env.LOG_SINK_TOKEN = 'sink-token-for-tests';
    try {
      assert.equal((await ingest({ service: 'assets', entries: [{ message: 'x' }] })).status, 403);
      assert.equal((await ingest({ service: 'assets', entries: [{ message: 'x' }] }, { 'x-log-sink-token': 'wrong-token-for-tests' })).status, 403);
      assert.equal((await ingest({ service: 'assets', entries: [{ message: 'x' }] }, { 'x-log-sink-token': 'sink-token-for-tests' })).status, 202);
    } finally {
      delete process.env.LOG_SINK_TOKEN;
    }
    // Not reachable under /api/platform (the public gateway only forwards that prefix).
    assert.equal((await call('POST', '/internal/logs', { body: { service: 'tasks', entries: [] } })).status, 404);
  });

  test('rate limit per service', async () => {
    process.env.LOG_RATE_PER_MINUTE = '5';
    try {
      const res = await ingest({ service: 'assets', entries: Array.from({ length: 12 }, (_, i) => ({ message: `burst ${i} zzrate` })) });
      assert.equal(res.body.accepted, 5);
      await flushLogs();
      const stored = await dbs.db.select().from(serviceLogs).where(sql`${serviceLogs.message} like 'burst % zzrate'`);
      assert.equal(stored.length, 5);
    } finally {
      delete process.env.LOG_RATE_PER_MINUTE;
    }
  });

  test('a Platform 500 is recorded with its request (and the answer stays the same); a failing writer never throws', async () => {
    const filter = new AllExceptionsFilter();
    let status = 0;
    let sent: unknown = null;
    const resObj = { status: (s: number) => ((status = s), resObj), json: (b: unknown) => ((sent = b), resObj) };
    const reqObj = { method: 'GET', originalUrl: '/api/platform/people?secret=1', caller: { companyId: owner.companyId, personId: 'p-1' } };
    const host = { switchToHttp: () => ({ getResponse: () => resObj, getRequest: () => reqObj }) } as unknown as ArgumentsHost;
    filter.catch(new Error('boom password=hunter2'), host);
    assert.equal(status, 500);
    assert.deepEqual(sent, { statusCode: 500, message: 'Something went wrong. Please try again.' });
    await flushLogs();
    const [row] = await dbs.db.select().from(serviceLogs).where(and(eq(serviceLogs.service, 'platform'), eq(serviceLogs.event, 'request.failed'))).orderBy(sql`id desc`).limit(1);
    assert.deepEqual([row.path, row.status, row.companyId, row.method], ['/api/platform/people', 500, owner.companyId, 'GET']);
    assert.ok(!row.message.includes('hunter2'));
    // A database failure while writing is swallowed (the entry is dropped).
    const logs = app.get(LogsService) as unknown as { write: (r: unknown) => Promise<void> };
    const real = logs.write;
    logs.write = () => Promise.reject(new Error('db down'));
    try {
      platformLog({ level: 'error', message: 'while the database is down' });
      await assert.doesNotReject(flushLogs());
    } finally {
      logs.write = real;
    }
  });

  test('retention: entries older than 30 days are removed, newer ones kept', async () => {
    const [old] = await dbs.db.insert(serviceLogs).values({ service: 'tasks', level: 'error', message: 'old zzretention', at: new Date(Date.now() - 31 * 86400_000) }).returning();
    const [fresh] = await dbs.db.insert(serviceLogs).values({ service: 'tasks', level: 'error', message: 'fresh zzretention', at: new Date(Date.now() - 29 * 86400_000) }).returning();
    const gone = await app.get(LogsService).purge();
    assert.ok(gone >= 1);
    const left = await dbs.db.select({ id: serviceLogs.id }).from(serviceLogs).where(sql`${serviceLogs.message} like '% zzretention'`);
    assert.deepEqual(left.map((r) => r.id), [fresh.id]);
    assert.ok(old.id !== fresh.id);
  });
});
