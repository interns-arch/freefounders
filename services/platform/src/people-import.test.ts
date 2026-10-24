// Bulk import of people (PLAN.md §19.40). Run with `npm test` (shares the throwaway database; adds its own rows).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateRawSync } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { normaliseIdentifier } from './accounts/identifier';
import { toCsv, toXlsx } from './common/sheet';
import { DbService } from './db/db.service';
import { logins, otpCodes, people, personRoles, subscriptions } from './db/schema';
import { createApp } from './main';
import { parseDate, readImportFile } from './people/people-import';

const PASSWORD = 'Import@2026';
let app: INestApplication;
let base = '';
let dbs: DbService;
let fake: Server;
let nextUserId = 5000;

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return { status: res.status, body: null as any, bytes: Buffer.from(await res.arrayBuffer()), type };
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, bytes: Buffer.alloc(0), type };
}

async function signup(identifier: string, name: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  const username = `u${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const res = await call('POST', '/signup/complete', { body: { signupToken: v.body.signupToken, fullName: 'Owner Imp', password: PASSWORD, username, company: { name, apps: ['tasks'] } } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string };
}

const csv = (rows: string[][]) => Buffer.from(toCsv({ header: rows[0]!, rows: rows.slice(1) })).toString('base64');

before(async () => {
  fake = createServer(async (req, res) => {
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
    if (path === '/modules') return json(200, { app, modules: [] });
    if (req.method === 'PUT' && path === '/company') return json(200, { version: body.version, applied: true });
    if (req.method === 'GET' && path === '/people') return json(200, { departments: [], people: [] });
    if (req.method === 'PUT' && path === '/people') return json(200, { version: body.version, applied: true });
    if (path === '/events' || path === '/roles') return json(200, []);
    return json(404, { detail: 'not here' });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as AddressInfo).port;
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${port}/tasks/api/internal`;
  process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${port}/assets/api/internal`;
  process.env.OTP_DEV_ECHO = '1';
  process.env.OTP_IP_LIMIT = '0';
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
});

after(async () => {
  await app?.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

describe('people import: reading files', () => {
  test('CSV (with the spreadsheet apostrophe) and XLSX give the same rows; dates in several forms', () => {
    const header = ['Name', 'Email', 'Mobile', 'Employee ID', 'Department', 'Designation', 'Reports to', 'Join date', 'Role'];
    const row = ['Asha Verma', 'asha@x.test', '+91 98765 43210', 'E-1', 'Sales', 'Executive', '', '01-10-2026', 'member'];
    const fromCsv = readImportFile('p.csv', Buffer.from(toCsv({ header, rows: [row, ['', '', '', '', '', '', '', '', '']] })));
    const fromXlsx = readImportFile('p.xlsx', Buffer.from(toXlsx({ title: 'People', header, rows: [row] }, (b) => deflateRawSync(b))));
    assert.equal(fromCsv.length, 1, 'blank lines skipped');
    assert.deepEqual(fromCsv, fromXlsx);
    assert.equal(fromCsv[0]!.mobile, '+91 98765 43210');
    assert.equal(fromCsv[0]!.line, 2);
    assert.deepEqual(['2026-10-01', '01-10-2026', '1/10/2026', '46296', '31-02-2026'].map(parseDate), ['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', null]);
    assert.throws(() => readImportFile('p.csv', Buffer.from('Email\nx@y.test\n')), /No "Name" column/);
  });
});

describe('people import: preview and import', () => {
  let token = '';
  let companyId = '';

  before(async () => {
    const out = await signup(`imp${Date.now()}@imp.test`, `Import Co ${randomUUID().slice(0, 6)}`);
    token = out.accessToken;
    companyId = out.companyId;
    const d = await call('POST', '/departments', { token, body: { name: 'Sales' } });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    // An admin-made person in another company signs in with this email: never taken over.
    const other = await signup(`imp-other${Date.now()}@imp.test`, `Other Co ${randomUUID().slice(0, 6)}`);
    await dbs.db.insert(people).values({ companyId: other.companyId, fullName: 'Someone Else', email: 'taken@elsewhere.test' });
  });

  test('template downloads as xlsx and csv', async () => {
    const x = await call('GET', '/people/import/template?format=xlsx', { token });
    assert.equal(x.status, 200);
    assert.match(x.type, /spreadsheetml/);
    const rows = readImportFile('t.xlsx', x.bytes);
    assert.equal(rows[0]!.fullName, 'Asha Verma');
    const c = await call('GET', '/people/import/template?format=csv', { token });
    assert.match(c.bytes.toString('utf8'), /Name,Email,Mobile,Employee ID,Department,Designation,Reports to,Join date,Role/);
  });

  test('preview: per-row errors, managers in the file, seats of the Free plan (3 users)', async () => {
    await dbs.db.update(subscriptions).set({ plan: 'free', state: 'active', trialEndsAt: null }).where(eq(subscriptions.companyId, companyId));
    const content = csv([
      ['Name', 'Email', 'Mobile', 'Employee ID', 'Department', 'Designation', 'Reports to', 'Join date', 'Role'],
      ['Meera Lead', 'meera@imp.test', '', 'IMP-1', 'sales', 'Manager', '', '2026-10-01', 'Admin'],
      ['Ravi Exec', '', '98111 00001', 'IMP-2', 'Sales', 'Executive', 'IMP-1', '', ''],
      ['', 'noname@imp.test', '', '', '', '', '', '', ''],
      ['Dup Code', '', '', 'IMP-2', '', '', '', '', ''],
      ['Bad Dept', 'bad@imp.test', '', '', 'Marketing', '', '', '', ''],
      ['Taken', 'taken@elsewhere.test', '', '', '', '', '', '', ''],
      ['Bad Role', 'role@imp.test', '', '', '', '', 'nobody@x.test', '', 'Boss'],
      ['Fourth', 'fourth@imp.test', '', '', '', '', '', '', ''],
    ]);
    const res = await call('POST', '/people/import/preview', { token, body: { fileName: 'people.csv', content } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const by = new Map<number, any>(res.body.rows.map((r: any) => [r.line, r]));
    assert.deepEqual(by.get(2).errors, []);
    assert.equal(by.get(2).level, 'admin');
    assert.deepEqual(by.get(3).errors, [], 'reports to a row in the file');
    assert.match(by.get(4).errors.join(' '), /Name/);
    assert.match(by.get(5).errors.join(' '), /also on line 3/);
    assert.match(by.get(6).errors.join(' '), /Department "Marketing" does not exist/);
    assert.match(by.get(7).errors.join(' '), /signs in someone else/);
    assert.match(by.get(8).errors.join(' '), /Role "Boss"/);
    assert.match(by.get(8).errors.join(' '), /nobody with this employee ID or email/);
    assert.match(by.get(9).errors.join(' '), /Free plan is for up to 3 users/, 'owner + 2 imported fill the plan');
    assert.deepEqual([res.body.ready, res.body.seats.limit, res.body.seats.used], [2, 3, 1]);
    // Nothing saved by the preview.
    const [n] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(people).where(eq(people.companyId, companyId));
    assert.equal(n!.n, 1);

    const done = await call('POST', '/people/import', { token, body: { rows: res.body.rows } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([done.body.added, done.body.skipped], [2, 6]);
    const meera = done.body.results.find((r: any) => r.line === 2);
    const ravi = done.body.results.find((r: any) => r.line === 3);
    assert.equal(meera.signIn, 'meera@imp.test');
    assert.match(meera.password, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.equal(ravi.signIn, 'IMP-2');
    // The generated password signs them in; the manager in the file is set; everyone has a role.
    const signIn = await call('POST', '/auth/login', { body: { login: 'meera@imp.test', password: meera.password } });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
    const [raviRow] = await dbs.db.select().from(people).where(eq(people.id, ravi.personId));
    assert.equal(raviRow!.reportsTo, meera.personId);
    assert.ok(raviRow!.departmentId);
    const roles = await dbs.db.select().from(personRoles).where(eq(personRoles.personId, ravi.personId));
    assert.equal(roles.length, 1, 'Member role given');
    const [login] = await dbs.db.select().from(logins).where(eq(logins.personId, ravi.personId));
    assert.ok(login && !login.passwordHash.includes(ravi.password), 'hashed only');

    // Again: the same people are now in People, and the plan is full.
    const again = await call('POST', '/people/import', { token, body: { rows: res.body.rows.slice(0, 2) } });
    assert.equal(again.body.added, 0);
    assert.match(again.body.results[0].error, /already in People/);
  });

  test('without signing in nothing is read', async () => {
    const res = await call('POST', '/people/import/preview', { body: { fileName: 'p.csv', content: csv([['Name'], ['X']]) } });
    assert.equal(res.status, 401);
  });
});
