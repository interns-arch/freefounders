// `company -- delete | wipe-all | grant` (PLAN.md §14, "Deleting a company"). Run with `npm test` (shares the throwaway
// `ff_platform_test` database with the other tests; only touches its own companies).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { hashPassword } from './auth/auth.service';
import { normaliseIdentifier } from './accounts/identifier';
import { resetUsernameChecks } from './accounts/username';
import { BillingService } from './billing/billing.service';
import { seatLimit, subscriptionOf } from './billing/seats';
import { planAreas } from './billing/pricing';
import { resetCompanyNameChecks } from './company/company-name';
import { CompanyDeleteService, deleteRefusal } from './company/delete.service';
import { CompanyGrantService } from './company/grant.service';
import { DbService } from './db/db.service';
import { accounts, companies, invoices, otpCodes, people, personApps, staffAudit, subscriptions } from './db/schema';
import { createApp } from './main';

const PASSWORD = 'Delete@2026';
let app: INestApplication;
let base = '';
let dbs: DbService;
let del: CompanyDeleteService;
let fake: Server;
/** The stand-in apps' registries: company id -> schema. */
const registry: Record<string, Map<string, string>> = { tasks: new Map(), assets: new Map() };
const calls: Array<{ app: string; method: string; path: string; cid: unknown; body: any }> = [];
/** Next DELETE /companies/<id> to this app fails once (a partial failure). */
const failNextDelete: Record<string, boolean> = {};
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

async function signup(identifier: string, companyName: string, username: string) {
  const target = normaliseIdentifier(identifier)?.value;
  if (target) await dbs.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpCodes.target, target));
  const start = await call('POST', '/signup/start', { body: { identifier } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const v = await call('POST', '/signup/verify', { body: { otpId: start.body.otpId, code: start.body.devCode } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const res = await call('POST', '/signup/complete', {
    body: { signupToken: v.body.signupToken, fullName: 'Gita Owner', password: PASSWORD, username, company: { name: companyName, apps: ['tasks', 'assets'] } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { accessToken: string; companyId: string };
}

const code = async (companyId: string) => (await dbs.db.select({ code: companies.code }).from(companies).where(eq(companies.id, companyId)))[0]?.code;

before(async () => {
  fake = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const app = req.url!.startsWith('/assets') ? 'assets' : 'tasks';
    const path = req.url!.replace(/^\/(tasks|assets)\/api\/internal/, '').split('?')[0];
    const cid = decodeJwt(String(req.headers.authorization).slice(7)).cid;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ app, method: req.method!, path, cid, body });
    const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    const reg = registry[app];
    if (req.method === 'POST' && path === '/companies') {
      const schema = `co_${String(body.code).toLowerCase()}`;
      const created = !reg.has(body.companyId);
      reg.set(body.companyId, schema);
      return json(created ? 201 : 200, { companyId: body.companyId, schema, created });
    }
    const one = /^\/companies\/([0-9a-f-]{36})$/.exec(path);
    if (one) {
      assert.equal(cid, undefined, 'company delete calls carry no cid');
      const schema = reg.get(one[1]) ?? null;
      if (!schema) return json(200, { registered: false, schema: null, deleted: false });
      if (req.method === 'GET') return json(200, { registered: true, schema, schemaExists: true, tables: 40, rows: 12, files: { path: `/media/c/${schema}`, count: 2, bytes: 2048 } });
      if (failNextDelete[app]) {
        failNextDelete[app] = false;
        return json(500, { detail: 'disk on fire' });
      }
      reg.delete(one[1]);
      return json(200, { registered: false, schema, deleted: true, tables: 40, rows: 12, files: { path: `/media/c/${schema}`, count: 2 } });
    }
    if (req.method === 'POST' && path === '/provision') return json(200, { userId: nextUserId++ });
    if (path === '/permissions') return json(200, { app, scopes: [], permissions: [{ key: `${app}.view`, label: 'See', group: 'All', scopes: null }] });
    if (req.method === 'GET' && path === '/access') return json(200, { version: 0, roles: [], people: [] });
    if (req.method === 'PUT' && path === '/access') return json(200, { applied: true, problems: [] });
    if (path === '/modules') {
      return json(200, { app, modules: [{ key: `${app}_m1`, label: 'M1', description: '', default: true }, { key: `${app}_extra`, label: 'Extra', description: '', default: false, optIn: true }] });
    }
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
  process.env.OTP_IP_LIMIT = '0';
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
  del = app.get(CompanyDeleteService);
  resetUsernameChecks();
  resetCompanyNameChecks();
});

after(async () => {
  await app?.close();
  fake?.close();
});

describe('company -- delete (PLAN.md §14)', () => {
  const say = () => {};
  const gitaUser = `gita${randomUUID().slice(0, 8)}`;
  let gone: { accessToken: string; companyId: string };
  let other: { accessToken: string; companyId: string };
  let staffId = '';
  let sharedId = '';

  test('dry run lists everything and changes nothing', async () => {
    gone = await signup('gita@gone.test', 'Gone Traders', gitaUser);
    other = await signup('ravi@stays.test', 'Stays Traders', `ravi${randomUUID().slice(0, 8)}`);
    // A Kaampilot staff account and an account that is also in another company, both members of the company to delete.
    const [staff] = await dbs.db.insert(accounts).values({ email: `staff-${randomUUID().slice(0, 6)}@kaampilot.test`, fullName: 'Staff', passwordHash: await hashPassword(PASSWORD), isStaff: true }).returning();
    staffId = staff.id;
    await dbs.db.insert(people).values({ companyId: gone.companyId, fullName: 'Staff', accountId: staff.id });
    const [ravi] = await dbs.db.select({ accountId: people.accountId }).from(people).where(eq(people.companyId, other.companyId));
    sharedId = ravi.accountId!;
    await dbs.db.insert(people).values({ companyId: gone.companyId, fullName: 'Ravi', accountId: sharedId });

    const plan = (await del.plan(await code(gone.companyId)))!;
    assert.equal(plan.company.code, 'GONETRADERS');
    assert.equal(plan.counts.people, 3);
    assert.ok(plan.counts.roles >= 2 && plan.counts.subscriptions === 1);
    assert.deepEqual(plan.accountsDeleted.map((a) => a.label), ['Gita Owner <gita@gone.test>']);
    assert.deepEqual(plan.accountsKeptStaff.map((a) => a.id), [staffId]);
    assert.equal(plan.accountsKeptShared, 1);
    assert.deepEqual(plan.apps.map((a) => [a.app, a.data?.schema]), [['tasks', 'co_gonetraders'], ['assets', 'co_gonetraders']]);
    assert.equal(deleteRefusal(plan), null);
    const lines: string[] = [];
    del.describe(plan, (l) => lines.push(l));
    assert.ok(lines.some((l) => l.includes('co_gonetraders') && l.includes('/media/c/co_gonetraders')));
    assert.equal(registry.tasks.get(gone.companyId), 'co_gonetraders', 'nothing deleted');
    assert.equal((await call('GET', '/auth/me', { token: gone.accessToken })).status, 200);
  });

  test('refuses the last company (unless --allow-last) and a company that paid (unless --force-paid)', async () => {
    const plan = (await del.plan('GONETRADERS'))!;
    assert.match(deleteRefusal({ ...plan, otherCompanies: 0 })!, /last remaining company/);
    assert.equal(deleteRefusal({ ...plan, otherCompanies: 0 }, { allowLast: true }), null);
    const paid = { ...plan, paid: { invoices: 1, payments: 1, total: 11800 } };
    assert.match(deleteRefusal(paid)!, /paid for Kaampilot.*--force-paid/);
    assert.equal(deleteRefusal(paid, { forcePaid: true }), null);
    assert.match(deleteRefusal({ ...plan, apps: [{ app: 'tasks', connected: false }] })!, /TASKS_INTERNAL_URL/);
    // A real paid invoice stops the run before anything changes.
    const fy = `T${randomUUID().slice(0, 6)}`;
    const party = { name: 'X', gstin: null, state: 'Karnataka', address: null };
    const [inv] = await dbs.db
      .insert(invoices)
      .values({ companyId: gone.companyId, number: `FF/${fy}/1`, financialYear: fy, seq: 1, issuedAt: new Date(), seller: party, buyer: party, placeOfSupply: 'Karnataka', subtotal: 10000, total: 11800 })
      .returning();
    await assert.rejects(del.run('GONETRADERS', {}, say), /paid for Kaampilot/);
    assert.equal((await code(gone.companyId)), 'GONETRADERS');
    assert.equal(registry.tasks.has(gone.companyId), true);
    await dbs.db.delete(invoices).where(eq(invoices.id, inv.id));
  });

  test('confirm deletes in the apps then the Platform; a failure part-way is finished by running it again', async () => {
    failNextDelete.assets = true;
    await assert.rejects(del.run('GONETRADERS', {}, say), /assets/);
    assert.equal(registry.tasks.has(gone.companyId), false, 'Tasks done');
    assert.equal(registry.assets.has(gone.companyId), true, 'Assets failed');
    const [half] = await dbs.db.select({ status: companies.status }).from(companies).where(eq(companies.id, gone.companyId));
    assert.equal(half.status, 'deleting', 'closed while half deleted');
    assert.equal((await call('GET', '/auth/me', { token: gone.accessToken })).status, 401);

    await del.run('GONETRADERS', { by: 'cli' }, say);
    assert.equal(registry.assets.has(gone.companyId), false);
    assert.equal(registry.tasks.get(other.companyId), 'co_staystraders', 'the other company is untouched');
    assert.equal(await code(gone.companyId), undefined);
    const [{ n }] = await dbs.db.select({ n: sql<number>`count(*)::int` }).from(people).where(eq(people.companyId, gone.companyId));
    assert.equal(n, 0);
    const left = await dbs.db.select({ id: accounts.id, email: accounts.email }).from(accounts).where(sql`${accounts.id} in (${staffId}, ${sharedId}) or lower(${accounts.email}) = 'gita@gone.test'`);
    assert.deepEqual(left.map((a) => a.id).sort(), [staffId, sharedId].sort(), 'the owner account went; staff and shared accounts stay');
    const [audit] = await dbs.db.select().from(staffAudit).where(and(eq(staffAudit.action, 'company.delete'), eq(staffAudit.companyId, gone.companyId)));
    assert.equal(audit.companyCode, 'GONETRADERS');
    assert.equal(audit.staffEmail, 'cli');
    assert.equal((audit.details as { counts: { people: number } }).counts.people, 3);
    // Again: nothing left to delete.
    assert.equal(await del.plan('GONETRADERS'), null);
    await assert.rejects(del.run('GONETRADERS', {}, say), /No company with code GONETRADERS/);
    assert.equal((await call('POST', '/auth/login', { body: { login: 'gita@gone.test', password: PASSWORD } })).status, 401);
  });

  test('the same company name, code, owner email and username can sign up again', async () => {
    const again = await signup('gita@gone.test', 'Gone Traders', gitaUser);
    assert.notEqual(again.companyId, gone.companyId);
    assert.equal(await code(again.companyId), 'GONETRADERS');
    assert.equal(registry.tasks.get(again.companyId), 'co_gonetraders');
    const me = await call('GET', '/auth/me', { token: again.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.account.email, 'gita@gone.test');
    gone = again;
  });

  test('wipe-all, last step: only accounts in no company go; members and staff stay', async () => {
    const [orphan] = await dbs.db.insert(accounts).values({ email: `orphan-${randomUUID().slice(0, 6)}@x.test`, fullName: 'Orphan', passwordHash: 'x' }).returning();
    const listed = (await del.orphanAccounts()).map((a) => a.id);
    assert.ok(listed.includes(orphan.id));
    assert.ok(!listed.includes(sharedId) && !listed.includes(staffId));
    const before = (await dbs.db.select({ n: sql<number>`count(*)::int` }).from(accounts))[0].n;
    const n = await del.deleteOrphanAccounts('cli');
    assert.equal(n, listed.length);
    assert.equal((await dbs.db.select({ n: sql<number>`count(*)::int` }).from(accounts))[0].n, before - n);
    const kept = await dbs.db.select({ id: accounts.id }).from(accounts).where(sql`${accounts.id} in (${staffId}, ${sharedId})`);
    assert.equal(kept.length, 2);
    const [{ members }] = await dbs.db.select({ members: sql<number>`count(distinct ${people.accountId})::int` }).from(people);
    assert.ok(members > 0);
    assert.equal((await dbs.db.select({ n: sql<number>`count(*)::int` }).from(accounts).where(eq(accounts.id, orphan.id)))[0].n, 0);
  });

  test('grant: complimentary, every area + AI, no user limit, every module on and pushed', async () => {
    const grant = app.get(CompanyGrantService);
    const dry = (await grant.plan('GONETRADERS'))!;
    assert.equal(dry.before?.state, 'trialing');
    assert.deepEqual(dry.modules.tasks, { tasks_m1: true, tasks_extra: true });
    const [unchanged] = await dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, gone.companyId));
    assert.equal(unchanged.state, 'trialing', 'the plan step changes nothing');

    calls.length = 0;
    await grant.run('GONETRADERS', 'cli', () => {});
    const { sub, plan } = await subscriptionOf(dbs, gone.companyId);
    assert.deepEqual({ plan: sub.plan, state: sub.state, ai: sub.ai, modules: sub.modules, trialEndsAt: sub.trialEndsAt, trialMaxUsers: sub.trialMaxUsers, end: sub.currentPeriodEnd }, {
      plan: 'complimentary', state: 'active', ai: true, modules: null, trialEndsAt: null, trialMaxUsers: null, end: null,
    });
    assert.equal(seatLimit(sub, plan), null, 'no user limit');
    assert.deepEqual(planAreas(plan, sub.modules), { tasks: true, attendance: true });
    const [c] = await dbs.db.select().from(companies).where(eq(companies.id, gone.companyId));
    assert.deepEqual(c.enabledApps.sort(), ['assets', 'tasks']);
    assert.deepEqual(c.modules, { tasks: { tasks_m1: true, tasks_extra: true }, assets: { assets_m1: true, assets_extra: true } });
    const pushed = calls.filter((x) => x.method === 'PUT' && x.path === '/company');
    assert.deepEqual(pushed.find((x) => x.app === 'tasks')?.body.modules, { tasks_m1: true, tasks_extra: true, tasks: true, attendance: true });
    assert.deepEqual(pushed.find((x) => x.app === 'assets')?.body.modules, { assets_m1: true, assets_extra: true });
    const me = await call('GET', '/auth/me', { token: gone.accessToken });
    assert.equal(me.body.billing.readOnly, false);
    assert.equal(me.body.billing.maxUsers ?? null, null);
    // The billing clock never moves a complimentary plan.
    await dbs.db.update(subscriptions).set({ stateSince: new Date(Date.now() - 400 * 86400_000), clockOffsetDays: 400 }).where(eq(subscriptions.companyId, gone.companyId));
    await app.get(BillingService).tick(gone.companyId);
    const [after] = await dbs.db.select({ state: subscriptions.state }).from(subscriptions).where(eq(subscriptions.companyId, gone.companyId));
    assert.equal(after.state, 'active');
    const [audit] = await dbs.db.select().from(staffAudit).where(and(eq(staffAudit.action, 'company.grant'), eq(staffAudit.companyId, gone.companyId)));
    assert.ok(audit);
    // Clean up: this company leaves the shared test database as it found it.
    await del.run('GONETRADERS', {}, () => {});
    await del.run('STAYSTRADERS', {}, () => {});
    assert.equal((await dbs.db.select().from(personApps).innerJoin(people, eq(people.id, personApps.personId)).where(eq(people.companyId, gone.companyId))).length, 0);
  });
});
