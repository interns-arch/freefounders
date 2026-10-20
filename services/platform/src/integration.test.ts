// Platform integration tests. Run with `npm test` (throwaway `ff_platform_test` database).
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader as decodeJwtHeader, jwtVerify, SignJWT } from 'jose';
import { pbkdf2Sync } from 'node:crypto';
import { AuthService, hashPassword } from './auth/auth.service';
import { redact } from './common/exception.filter';
import { ipLimit, maxFailedLogins, Throttle } from './auth/throttle';
import { KeysService } from './keys/keys.service';
import { TokensService } from './keys/tokens.service';
import { seed } from './seed';
import { ProvisionClient } from './provision/provision.client';
import { RolesService } from './roles/roles.service';
import { CompanyService } from './company/company.service';
import { DbService } from './db/db.service';
import { companies, departments, eventCursors, logins, people, personApps, personRoles, refreshSessions, roleGrants, roles } from './db/schema';
import { DirectoryService } from './people/directory.service';
import { EVENTS_LOCK, FlowsService, pathId } from './people/flows.service';
import { createApp } from './main';

const PASSWORD = 'Test@12345';
let app: INestApplication;
let base = '';
let dbs: DbService;
let fakeTasks: Server;
const provisionCalls: Array<{ body: Record<string, unknown>; aud: unknown; cid: unknown; url?: string }> = [];
const ids: Record<string, string> = {};
// Phase 3: what the stand-in Tasks app offers to the role builder, and the roles it already has.
const FAKE_CATALOGUE = {
  app: 'tasks',
  scopes: ['own', 'team', 'department', 'company'],
  permissions: [
    { key: 'tasks.view', label: 'See tasks', group: 'Tasks', scopes: ['own', 'team', 'department', 'company'] },
    { key: 'tasks.assign', label: 'Give tasks', group: 'Tasks', scopes: null },
    { key: 'tasks.delete_admin_work', label: 'Delete admin work', group: 'Tasks', scopes: null, superAdminOnly: true },
  ],
};
let fakeExport: { version: number; roles: unknown[]; people: unknown[] } = { version: 0, roles: [], people: [] };
const accessPushes: Array<{ cid: unknown; body: any }> = [];
/** The role-set version the fake app last applied; a lower one is refused as stale, like the real apps do. */
let fakeAccessVersion = 0;
const companyPushes: Array<{ cid: unknown; body: any }> = [];
const peoplePushes: Array<{ cid: unknown; body: any }> = [];
let fakePeopleExport: { departments: unknown[]; people: unknown[] } = { departments: [], people: [] };
/** Outbox of the fake Tasks app, and the calls its flow endpoints received (Phase 5 flows). */
const fakeTaskEvents: Array<{ id: number; type: string; payload: unknown }> = [];
const flowCalls: Array<{ app: string; method: string; url: string; body: any }> = [];
let fakeProfileVersion = 0;
/** Permanent delete (§19.12): what the fake apps answer to DELETE /internal/people/<id>, and the calls they got. */
const deleteCalls: Array<{ app: string; cid: unknown; url: string; body: any }> = [];
let fakeTasksDelete: { status: number; body: unknown } = { status: 200, body: { deleted: true, counts: { tasks: 3, comments: 1 } } };
const FAKE_MODULES = {
  app: 'tasks',
  modules: [
    { key: 'leads', label: 'Leads', description: 'Sales pipeline', default: false },
    { key: 'payroll', label: 'Payroll', description: 'Salary runs', default: false },
  ],
};

interface Res {
  status: number;
  body: any;
  cookie?: string;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string; cookie?: string; csrf?: boolean } = {}): Promise<Res> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.csrf === false ? {} : { 'x-requested-with': 'XMLHttpRequest' }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = /ff_refresh=([^;]*)/.exec(setCookie);
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: m && m[1] ? `ff_refresh=${m[1]}` : undefined };
}

async function login(loginId: string, password = PASSWORD) {
  const res = await call('POST', '/auth/login', { body: { login: loginId, password } });
  assert.equal(res.status, 200, `login ${loginId}: ${JSON.stringify(res.body)}`);
  assert.ok(res.cookie, 'refresh cookie set');
  return { token: res.body.accessToken as string, cookie: res.cookie!, body: res.body };
}

before(async () => {
  // A stand-in for the Tasks app: verifies the service token against the Platform's published keys.
  fakeTasks = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
      const { payload } = await jwtVerify(String(req.headers.authorization).slice(7), jwks, { audience: 'tasks-internal', issuer: 'freefounders-platform' });
      if (req.method === 'GET' && req.url?.endsWith('/roles')) {
        provisionCalls.push({ body: {}, aud: payload.aud, cid: payload.cid, url: req.url });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ value: 'warehouse', label: 'Warehouse Team' }]));
        return;
      }
      if (req.method === 'GET' && req.url?.includes('/events')) {
        const after = Number(new URL(req.url, 'http://x').searchParams.get('after') ?? 0);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload.cid === ids.acme ? fakeTaskEvents.filter((e) => e.id > after) : []));
        return;
      }
      if (req.method === 'POST' && (req.url?.endsWith('/exit-tasks') || req.url?.endsWith('/tasks'))) {
        flowCalls.push({ app: 'tasks', method: 'POST', url: req.url!, body: JSON.parse(raw) });
        res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ taskId: 42, code: 'T-00042', url: '/tasks/tasks/42', created: true }));
        return;
      }
      if (req.method === 'GET' && req.url?.endsWith('/people')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fakePeopleExport));
        return;
      }
      if (req.method === 'PUT' && req.url?.endsWith('/people')) {
        const body = JSON.parse(raw);
        peoplePushes.push({ cid: payload.cid, body });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: body.version, applied: true }));
        return;
      }
      if (req.method === 'DELETE' && /\/people\/[0-9a-f-]{36}$/.test(req.url ?? '')) {
        deleteCalls.push({ app: 'tasks', cid: payload.cid, url: req.url!, body: raw ? JSON.parse(raw) : null });
        res.writeHead(fakeTasksDelete.status, { 'content-type': 'application/json' }).end(JSON.stringify(fakeTasksDelete.body));
        return;
      }
      if (req.method === 'GET' && req.url?.endsWith('/modules')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(FAKE_MODULES));
        return;
      }
      if (req.method === 'PUT' && req.url?.endsWith('/company')) {
        const body = JSON.parse(raw);
        companyPushes.push({ cid: payload.cid, body });
        if (body.version < fakeProfileVersion) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: fakeProfileVersion, applied: false }));
          return;
        }
        fakeProfileVersion = body.version;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: body.version, applied: true }));
        return;
      }
      if (req.method === 'GET' && req.url?.endsWith('/permissions')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(FAKE_CATALOGUE));
        return;
      }
      if (req.method === 'GET' && req.url?.endsWith('/access')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fakeExport));
        return;
      }
      if (req.method === 'PUT' && req.url?.endsWith('/access')) {
        const body = JSON.parse(raw);
        accessPushes.push({ cid: payload.cid, body });
        if (body.version < fakeAccessVersion) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: fakeAccessVersion, applied: false }));
          return;
        }
        fakeAccessVersion = body.version;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ applied: true, problems: [] }));
        return;
      }
      if (req.method === 'POST' && req.url?.endsWith('/companies')) {
        const body = JSON.parse(raw);
        provisionCalls.push({ body, aud: payload.aud, cid: payload.cid, url: req.url });
        res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ companyId: body.companyId, schema: `co_${String(body.code).toLowerCase()}`, created: true }));
        return;
      }
      provisionCalls.push({ body: JSON.parse(raw), aud: payload.aud, cid: payload.cid, url: req.url });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ userId: 42 }));
    } catch {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'bad service token' }));
    }
  });
  await new Promise<void>((r) => fakeTasks.listen(0, '127.0.0.1', r));
  process.env.TASKS_INTERNAL_URL = `http://127.0.0.1:${(fakeTasks.address() as AddressInfo).port}/api/internal`;
  delete process.env.ASSETS_INTERNAL_URL;

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/platform`;
  dbs = app.get(DbService);
  const db = dbs.db;

  const [acme] = await db.insert(companies).values({ name: 'Acme', code: 'ACME', enabledApps: ['tasks'] }).returning();
  const [other] = await db.insert(companies).values({ name: 'Other Co', code: 'OTHER', enabledApps: ['tasks', 'assets'] }).returning();
  ids.acme = acme.id;
  const hashed = await hashPassword(PASSWORD);
  const add = async (companyId: string, fullName: string, extra: Partial<typeof people.$inferInsert>, username: string | null) => {
    const [p] = await db.insert(people).values({ companyId, fullName, ...extra }).returning();
    await db.insert(logins).values({ personId: p.id, username, passwordHash: hashed });
    return p.id;
  };
  ids.owner = await add(acme.id, 'Olivia Owner', { email: 'owner@acme.test', employeeCode: 'AC001', platformRole: 'owner' }, 'olivia');
  ids.admin = await add(acme.id, 'Adam Admin', { email: 'admin@acme.test', employeeCode: 'AC002', platformRole: 'admin' }, null);
  ids.member = await add(acme.id, 'Mia Member', { email: 'mia@acme.test', employeeCode: 'SHARED1' }, 'mia');
  ids.otherShared = await add(other.id, 'Sam Shared', { email: 'sam@other.test', employeeCode: 'SHARED1' }, null);
});

after(async () => {
  await app?.close();
  fakeTasks?.close();
});

describe('public endpoints', () => {
  test('health and JWKS', async () => {
    assert.equal((await call('GET', '/health')).status, 200);
    const jwks = await call('GET', '/.well-known/jwks.json');
    assert.equal(jwks.status, 200);
    assert.equal(jwks.body.keys[0].kty, 'OKP');
    assert.equal(jwks.body.keys[0].crv, 'Ed25519');
    assert.equal(jwks.body.keys[0].d, undefined, 'private part never published');
  });

  test('app-version: what the phone app update prompt needs, without signing in', async () => {
    const res = await call('GET', '/app-version');
    assert.equal(res.status, 200);
    assert.match(String(res.body.minVersion), /^\d+\.\d+\.\d+$/);
    assert.ok(String(res.body.apkUrl).endsWith('.apk'));
  });

  test('mutating requests need the CSRF header', async () => {
    const res = await call('POST', '/auth/login', { body: { login: 'olivia', password: PASSWORD }, csrf: false });
    assert.equal(res.status, 403);
  });
});

describe('login', () => {
  test('by email, username and employee ID', async () => {
    for (const id of ['owner@acme.test', 'OWNER@ACME.TEST', 'olivia', 'ac001']) {
      const { token } = await login(id);
      const claims = decodeJwt(token);
      assert.equal(claims.sub, ids.owner);
      assert.equal(claims.cid, ids.acme);
      assert.equal(claims.aud, 'freefounders');
      assert.equal(claims.role, 'owner');
      assert.ok((claims.exp as number) - (claims.iat as number) <= 15 * 60);
    }
  });

  test('wrong or unknown credentials get the same answer', async () => {
    const wrong = await call('POST', '/auth/login', { body: { login: 'olivia', password: 'nope-nope' } });
    const unknown = await call('POST', '/auth/login', { body: { login: 'nobody', password: 'nope-nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
    await dbs.db.update(logins).set({ failedLogins: 0 }).where(eq(logins.personId, ids.owner));
  });

  test('an employee ID used by two companies is ambiguous, but email still works', async () => {
    assert.equal((await call('POST', '/auth/login', { body: { login: 'SHARED1', password: PASSWORD } })).status, 401);
    await login('mia@acme.test');
    await login('mia');
  });

  test('no lockout (founder, 2026-10-19): 10 wrong passwords, then the right one signs in', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', '/auth/login', { body: { login: 'sam@other.test', password: 'wrong-password' } });
      assert.equal(res.status, 401);
      assert.doesNotMatch(res.body.message, /Too many/);
    }
    const [row] = await dbs.db.select().from(logins).where(eq(logins.personId, ids.otherShared));
    assert.equal(row.failedLogins, 10, 'still counted, for information');
    assert.equal(row.lockedUntil, null, 'never locked');
    await login('sam@other.test');
    const [later] = await dbs.db.select().from(logins).where(eq(logins.personId, ids.otherShared));
    assert.equal(later.failedLogins, 0);
  });

  test('mobile gets the refresh token in the body instead of a cookie', async () => {
    const res = await call('POST', '/auth/login', { body: { login: 'mia', password: PASSWORD, client: 'mobile' } });
    assert.equal(res.status, 200);
    assert.equal(res.cookie, undefined);
    assert.ok(res.body.refreshToken);
    const again = await call('POST', '/auth/refresh', { body: { refreshToken: res.body.refreshToken } });
    assert.equal(again.status, 200);
    assert.ok(again.body.refreshToken && again.body.refreshToken !== res.body.refreshToken);
  });
});

describe('access tokens', () => {
  test('me returns person, company and apps', async () => {
    const { token } = await login('olivia');
    const me = await call('GET', '/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.person.fullName, 'Olivia Owner');
    assert.equal(me.body.company.name, 'Acme');
    assert.deepEqual(me.body.apps, []);
  });

  test('no token, tampered token, and service tokens are refused', async () => {
    const { token } = await login('olivia');
    assert.equal((await call('GET', '/auth/me')).status, 401);
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), role: 'owner', sub: ids.member })).toString('base64url');
    assert.equal((await call('GET', '/auth/me', { token: `${h}.${forged}.${s}` })).status, 401);
    assert.equal((await call('GET', '/auth/me', { token: `${h}.${p}.${s.slice(0, -4)}AAAA` })).status, 401);
  });
});

describe('refresh sessions', () => {
  test('rotates the refresh cookie and issues a fresh access token', async () => {
    const first = await login('mia');
    const r1 = await call('POST', '/auth/refresh', { cookie: first.cookie });
    assert.equal(r1.status, 200);
    assert.ok(r1.cookie && r1.cookie !== first.cookie);
    assert.equal(decodeJwt(r1.body.accessToken).sub, ids.member);
  });

  test('two tabs refreshing together: the slower one still gets an access token', async () => {
    const first = await login('mia');
    const r1 = await call('POST', '/auth/refresh', { cookie: first.cookie });
    const r2 = await call('POST', '/auth/refresh', { cookie: first.cookie });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r2.cookie, undefined, 'no second rotation');
    assert.equal((await call('POST', '/auth/refresh', { cookie: r1.cookie })).status, 200);
  });

  test('a copied old token used later ends the whole session', async () => {
    const first = await login('mia');
    const r1 = await call('POST', '/auth/refresh', { cookie: first.cookie });
    await dbs.db.execute(sql`update platform.refresh_sessions set rotated_at = now() - interval '5 minutes' where rotated_at is not null and revoked_at is null`);
    assert.equal((await call('POST', '/auth/refresh', { cookie: first.cookie })).status, 401, 'stolen token refused');
    assert.equal((await call('POST', '/auth/refresh', { cookie: r1.cookie })).status, 401, 'legit holder signed out too');
  });

  test('logout ends the session', async () => {
    const s = await login('mia');
    assert.equal((await call('POST', '/auth/logout', { cookie: s.cookie })).status, 200);
    assert.equal((await call('POST', '/auth/refresh', { cookie: s.cookie })).status, 401);
  });

  test('change password keeps this session and signs out the others', async () => {
    const here = await login('mia');
    const elsewhere = await login('mia');
    const bad = await call('POST', '/auth/change-password', { token: here.token, body: { currentPassword: 'wrong-one', newPassword: 'Another@123' } });
    assert.equal(bad.status, 400);
    const ok = await call('POST', '/auth/change-password', { token: here.token, body: { currentPassword: PASSWORD, newPassword: 'Another@123' } });
    assert.equal(ok.status, 200);
    assert.equal((await call('POST', '/auth/refresh', { cookie: elsewhere.cookie })).status, 401);
    assert.equal((await call('POST', '/auth/refresh', { cookie: here.cookie })).status, 200);
    await login('mia', 'Another@123');
    await dbs.db.update(logins).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(logins.personId, ids.member));
  });
});

describe('people administration', () => {
  test('members cannot manage people', async () => {
    const { token } = await login('mia');
    assert.equal((await call('GET', '/people', { token })).status, 403);
  });

  test('admin adds a person with a login; nobody is forced to change the generated password (R7)', async () => {
    const { token } = await login('admin@acme.test');
    const created = await call('POST', '/people', {
      token,
      body: { fullName: 'Nina New', email: 'Nina@Acme.test', employeeCode: 'AC010', login: { username: 'nina' } },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.person.email, 'nina@acme.test');
    assert.match(created.body.generatedPassword, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    ids.nina = created.body.person.id;

    const nina = await call('POST', '/auth/login', { body: { login: 'nina', password: created.body.generatedPassword } });
    assert.equal(nina.status, 200);
    assert.equal(nina.body.mustChangePassword, false, 'no forced change at the first sign-in');
    assert.equal((await call('GET', '/auth/me', { token: nina.body.accessToken })).body.mustChangePassword, false);

    const list = await call('GET', '/people?search=nina', { token });
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].login.username, 'nina');
  });

  test('people from another company are invisible', async () => {
    const { token } = await login('admin@acme.test');
    const list = await call('GET', '/people', { token });
    assert.ok(!list.body.some((p: { id: string }) => p.id === ids.otherShared));
    assert.equal((await call('PATCH', `/people/${ids.otherShared}`, { token, body: { fullName: 'Hacked' } })).status, 404);
  });

  test('identifier clashes are refused', async () => {
    const { token } = await login('admin@acme.test');
    const dupEmail = await call('POST', '/people', { token, body: { fullName: 'Dup', email: 'MIA@acme.test' } });
    assert.equal(dupEmail.status, 409);
    const userIsCode = await call('POST', '/people', { token, body: { fullName: 'Sneaky', login: { username: 'AC001', password: 'Sneaky@123' } } });
    assert.equal(userIsCode.status, 400, 'username may not capture someone else’s employee ID');
    const codeIsUser = await call('PATCH', `/people/${ids.nina}`, { token, body: { employeeCode: 'olivia' } });
    assert.equal(codeIsUser.status, 400);
  });

  test('only owners manage owners; nobody locks themselves out', async () => {
    const admin = await login('admin@acme.test');
    assert.equal((await call('POST', '/people', { token: admin.token, body: { fullName: 'Boss', platformRole: 'owner' } })).status, 403);
    assert.equal((await call('PATCH', `/people/${ids.owner}`, { token: admin.token, body: { status: 'inactive' } })).status, 403);
    assert.equal((await call('PATCH', `/people/${ids.admin}`, { token: admin.token, body: { status: 'inactive' } })).status, 400);
    const owner = await login('olivia');
    assert.equal((await call('PATCH', `/people/${ids.owner}`, { token: owner.token, body: { platformRole: 'admin' } })).status, 400);
  });

  test('resetting a password signs the person out everywhere', async () => {
    const admin = await login('admin@acme.test');
    const before = await login('mia');
    const reset = await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'Reset@1234' } });
    assert.equal(reset.status, 200);
    assert.equal((await call('POST', '/auth/refresh', { cookie: before.cookie })).status, 401);
    const after = await call('POST', '/auth/login', { body: { login: 'mia', password: 'Reset@1234' } });
    assert.equal(after.status, 200);
    assert.equal(after.body.mustChangePassword, false, 'not forced to change it (R7)');
    await dbs.db.update(logins).set({ passwordHash: await hashPassword(PASSWORD), mustChangePassword: false }).where(eq(logins.personId, ids.member));
  });

  test('deactivating a person ends their sessions and blocks sign-in', async () => {
    const admin = await login('admin@acme.test');
    const nina = await call('PUT', `/people/${ids.nina}/login`, { token: admin.token, body: { password: PASSWORD } });
    assert.equal(nina.status, 200);
    const session = await login('nina');
    assert.equal((await call('PATCH', `/people/${ids.nina}`, { token: admin.token, body: { status: 'inactive' } })).status, 200);
    assert.equal((await call('POST', '/auth/refresh', { cookie: session.cookie })).status, 401);
    assert.equal((await call('POST', '/auth/login', { body: { login: 'nina', password: PASSWORD } })).status, 401);
    // Any Platform call with the deactivated person's still-valid access token is refused too (401: the web app signs out).
    await dbs.db.update(people).set({ platformRole: 'admin' }).where(eq(people.id, ids.nina));
    assert.equal((await call('GET', '/people', { token: session.token })).status, 401);
    assert.equal((await call('GET', '/auth/me', { token: session.token })).status, 401);
  });
});

describe('apps', () => {
  test('granting Tasks provisions the user there and puts it in the token', async () => {
    const admin = await login('admin@acme.test');
    const refused = await call('PUT', `/people/${ids.member}/apps/tasks`, { token: admin.token, body: { appRole: 'warehouse' } });
    assert.equal(refused.status, 403, 'an app role the role builder does not know yet: the owner only (R1)');
    assert.match(refused.body.message, /Only the owner can choose "warehouse" inside Tasks/);
    const owner = await login('olivia');
    const grant = await call('PUT', `/people/${ids.member}/apps/tasks`, { token: owner.token, body: { appRole: 'warehouse' } });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal(grant.body.localUserId, '42');
    const last = provisionCalls.at(-1)!;
    assert.equal(last.aud, 'tasks-internal');
    assert.equal(last.cid, ids.acme, 'the app is told which company the person belongs to');
    assert.equal(last.body.personId, ids.member);
    assert.equal(last.body.username, 'mia');
    assert.equal(last.body.appRole, 'warehouse');

    const mia = await login('mia');
    assert.deepEqual(decodeJwt(mia.token).apps, { tasks: '42' });
    const me = await call('GET', '/auth/me', { token: mia.token });
    assert.deepEqual(me.body.apps, [{ app: 'tasks', name: 'Tasks', path: '/tasks/' }]);
  });

  test('apps outside the plan or unknown apps are refused', async () => {
    const admin = await login('admin@acme.test');
    assert.equal((await call('PUT', `/people/${ids.member}/apps/assets`, { token: admin.token, body: {} })).status, 400);
    assert.equal((await call('PUT', `/people/${ids.member}/apps/payroll`, { token: admin.token, body: {} })).status, 404);
  });

  test('an app switched off for the company disappears from tokens', async () => {
    await dbs.db.update(companies).set({ enabledApps: [] }).where(eq(companies.id, ids.acme));
    assert.deepEqual(decodeJwt((await login('mia')).token).apps, {});
    await dbs.db.update(companies).set({ enabledApps: ['tasks'] }).where(eq(companies.id, ids.acme));
  });

  test('revoking an app removes it and signs the person out', async () => {
    const admin = await login('admin@acme.test');
    const mia = await login('mia');
    assert.equal((await call('DELETE', `/people/${ids.member}/apps/tasks`, { token: admin.token })).status, 200);
    assert.equal((await call('POST', '/auth/refresh', { cookie: mia.cookie })).status, 401);
    assert.deepEqual(decodeJwt((await login('mia')).token).apps, {});
    const rows = await dbs.db.select().from(personApps).where(eq(personApps.personId, ids.member));
    assert.equal(rows.length, 0);
    const sessions = await dbs.db.select().from(refreshSessions).where(eq(refreshSessions.personId, ids.member));
    assert.ok(sessions.length > 0);
  });
});

describe('app information for admins', () => {
  test('lists the company apps and the roles inside each app', async () => {
    const admin = await login('admin@acme.test');
    assert.deepEqual((await call('GET', '/apps', { token: admin.token })).body, [{ app: 'tasks', name: 'Tasks', path: '/tasks/' }]);
    const roles = await call('GET', '/apps/tasks/roles', { token: admin.token });
    assert.deepEqual(roles.body, [{ value: 'warehouse', label: 'Warehouse Team' }]);
    assert.equal((await call('GET', '/apps/assets/roles', { token: admin.token })).status, 502, 'Assets not connected in this test');
    const member = await login('mia');
    assert.equal((await call('GET', '/apps', { token: member.token })).status, 403);
  });
});

describe('multi-company (Phase 2)', () => {
  test('a password imported from Tasks works once and is upgraded to argon2id', async () => {
    const djangoHash = `pbkdf2_sha256$1000$saltsalt$${pbkdf2Sync('Imported#2026', 'saltsalt', 1000, 32, 'sha256').toString('base64')}`;
    const [p] = await dbs.db.insert(people).values({ companyId: ids.acme, fullName: 'Imran Imported', email: 'imran@acme.test' }).returning();
    await dbs.db.insert(logins).values({ personId: p.id, username: 'imran', passwordHash: djangoHash });

    assert.equal((await call('POST', '/auth/login', { body: { login: 'imran', password: 'wrong-pass' } })).status, 401);
    await login('imran', 'Imported#2026');
    const [after] = await dbs.db.select({ hash: logins.passwordHash }).from(logins).where(eq(logins.personId, p.id));
    assert.match(after.hash, /^\$argon2id\$/);
    await login('imran', 'Imported#2026');
  });

  test('roles are read inside the caller company', async () => {
    const admin = await login('admin@acme.test');
    assert.equal((await call('GET', '/apps/tasks/roles', { token: admin.token })).status, 200);
    const last = provisionCalls.at(-1)!;
    assert.ok(last.url?.endsWith('/roles'));
    assert.equal(last.cid, ids.acme);
  });

  test('setting a company up in an app sends its id, code and name', async () => {
    const res = await app.get(ProvisionClient).setUpCompany('tasks', { companyId: ids.acme, code: 'ACME', name: 'Acme' });
    assert.deepEqual(res, { created: true, schema: 'co_acme' });
    const last = provisionCalls.at(-1)!;
    assert.ok(last.url?.endsWith('/companies'));
    assert.deepEqual(last.body, { companyId: ids.acme, code: 'ACME', name: 'Acme' });
  });
});

describe('role builder (Phase 3)', () => {
  const roleIds: Record<string, string> = {};

  test('a company starts with exactly Admin and Member; people the apps know become Admin or Member, plus their extra access (§19.28)', async () => {
    fakeExport = {
      version: 0,
      roles: [
        { code: 'super_admin', name: 'Super Admin', level: 3, grants: [{ permission: 'tasks.view', scope: 'company' }, { permission: 'tasks.delete_admin_work', scope: '' }] },
        { code: 'warehouse', name: 'Warehouse Team', level: 1, grants: [{ permission: 'tasks.view', scope: 'team' }, { permission: 'gone.old', scope: '' }] },
      ],
      people: [{ personId: ids.member, roles: ['warehouse'] }],
    };
    const res = await app.get(RolesService).sync(ids.acme);
    assert.equal(res.imported, true);
    assert.equal(res.push.tasks, 'ok');
    assert.equal((await app.get(RolesService).sync(ids.acme)).imported, false, 'only the first time');

    const admin = await login('admin@acme.test');
    const list = await call('GET', '/roles', { token: admin.token });
    assert.equal(list.status, 200);
    const byCode = Object.fromEntries(list.body.map((r: { code: string }) => [r.code, r]));
    assert.deepEqual(Object.keys(byCode).sort(), ['ff_admin', 'ff_member'], 'exactly the two built-in roles: no template roles, the Owner role is not listed');
    assert.equal(byCode.ff_admin.system, true);
    assert.equal(byCode.ff_member.system, true);
    assert.equal(byCode.ff_admin.level, 3);
    assert.equal(byCode.ff_member.level, 1);
    const perms = (code: string) => byCode[code].grants.map((g: { permission: string; scope: string }) => `${g.permission}@${g.scope}`).sort();
    assert.deepEqual(
      perms('ff_admin'),
      ['company.settings@', 'people.delete@', 'people.exit@', 'people.manage@', 'people.passwords@', 'roles.manage@', 'tasks.assign@', 'tasks.view@company'],
      'Admin: everything at Company scope except billing and the Owner-only powers',
    );
    assert.deepEqual(perms('ff_member'), ['tasks.view@own'], 'Member: their own work (only what the apps offer)');
    Object.assign(roleIds, { admin: byCode.ff_admin.id, member: byCode.ff_member.id });

    const peopleList = await call('GET', '/people', { token: admin.token });
    const person = (id: string) => peopleList.body.find((p: { id: string }) => p.id === id);
    assert.deepEqual(person(ids.member).roleIds, [roleIds.member], 'a Warehouse Team person becomes a Member…');
    assert.equal(person(ids.member).extraAccess, true, '…with what Warehouse gave beyond Member as extra access');
    assert.deepEqual(person(ids.admin).roleIds, [roleIds.admin], 'an admin becomes Admin');
    assert.deepEqual(person(ids.owner).roleIds, [roleIds.admin], 'the owner holds Admin (the Owner role is hidden)');
    const access = await call('GET', `/people/${ids.member}/access`, { token: admin.token });
    assert.equal(access.status, 200, JSON.stringify(access.body));
    assert.deepEqual(access.body.adds, [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }], 'nobody loses what their app role gave');

    const pushed = accessPushes.at(-1)!;
    assert.equal(pushed.cid, ids.acme, 'sent to the company');
    const ownerRole = pushed.body.roles.find((r: { kind: string }) => r.kind === 'owner');
    assert.equal(ownerRole.code, 'ff_owner');
    assert.deepEqual(
      ownerRole.grants.map((g: { permission: string; scope: string }) => `${g.permission}@${g.scope}`).sort(),
      ['billing.manage@', 'company.settings@', 'people.delete@', 'people.exit@', 'people.manage@', 'people.passwords@', 'roles.manage@', 'tasks.assign@', 'tasks.delete_admin_work@', 'tasks.view@company'],
      'the hidden Owner role has every permission (the apps check it like any role)',
    );
    assert.ok(pushed.body.people.find((p: { personId: string }) => p.personId === ids.owner).roleIds.includes(ownerRole.id), 'held by the owner');
    assert.equal(pushed.body.roles.length, 4, 'Admin, Member, the Owner role and one personal role');
    assert.ok(pushed.body.version > 0);
    roleIds.owner = ownerRole.id;
  });

  test('the catalogue comes from the apps; members cannot use the role builder', async () => {
    const admin = await login('admin@acme.test');
    const cat = await call('GET', '/roles/catalogue', { token: admin.token });
    assert.equal(cat.status, 200);
    assert.equal(cat.body[0].app, 'tasks');
    assert.equal(cat.body[0].permissions.length, 3);
    assert.equal(cat.body.at(-1).app, 'platform', 'the Admin workspace is the last "app" in the role builder');
    assert.equal(cat.body.at(-1).permissions.length, 7);
    const created = await call('POST', '/people', { token: admin.token, body: { fullName: 'Rita Roles', email: 'rita@acme.test', login: { username: 'rita', password: PASSWORD } } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.rita = created.body.person.id;
    const rita = await login('rita');
    assert.equal((await call('GET', '/roles', { token: rita.token })).status, 403);
  });

  test('roles are checked against what the apps offer; locked roles stay locked', async () => {
    const admin = await login('olivia'); // the owner: may give everything (R1)
    const make = (body: unknown) => call('POST', '/roles', { token: admin.token, body });
    const ok = await make({ name: 'Floor Lead', level: 2, grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'department' }, { app: 'tasks', permission: 'tasks.assign' }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    roleIds.floor = ok.body.id;
    assert.equal(ok.body.sync.tasks, 'ok');
    assert.equal((await make({ name: 'X1', grants: [{ app: 'tasks', permission: 'tasks.fly' }] })).status, 400);
    assert.equal((await make({ name: 'X2', grants: [{ app: 'tasks', permission: 'tasks.assign', scope: 'company' }] })).status, 400);
    assert.equal((await make({ name: 'X3', grants: [{ app: 'tasks', permission: 'tasks.view' }] })).status, 400, 'scoped permission needs a scope');
    assert.equal((await make({ name: 'X4', grants: [{ app: 'assets', permission: 'asset:view' }] })).status, 400, 'not in the plan');
    assert.equal((await make({ name: 'floor lead' })).status, 409);
    assert.equal((await call('PATCH', `/roles/${roleIds.admin}`, { token: admin.token, body: { name: 'Boss' } })).status, 400, 'built-in roles keep their name');
    assert.equal((await call('PATCH', `/roles/${roleIds.member}`, { token: admin.token, body: { level: 2 } })).status, 400, 'and their level');
    assert.equal((await call('DELETE', `/roles/${roleIds.admin}`, { token: admin.token })).status, 403, 'Admin is never archived');
    assert.equal((await call('DELETE', `/roles/${roleIds.member}`, { token: admin.token })).status, 403, 'Member is never archived');
    assert.equal((await call('PATCH', `/roles/${roleIds.owner}`, { token: admin.token, body: { grants: [] } })).status, 404, 'the hidden Owner role is not a role here');
    assert.equal((await call('DELETE', `/roles/${roleIds.owner}`, { token: admin.token })).status, 404);
    const renamed = await call('PATCH', `/roles/${roleIds.admin}`, { token: admin.token, body: { description: 'Edited like any role' } });
    assert.equal(renamed.status, 200, 'Admin is edited like any role (§19.28)');
    assert.equal(renamed.body.description, 'Edited like any role');
    assert.equal((await make({ name: 'Admin desk', grants: [{ app: 'platform', permission: 'people.manage' }] })).status, 201, 'Admin permissions are role permissions');
    assert.equal((await make({ name: 'X5', grants: [{ app: 'platform', permission: 'people.fly' }] })).status, 400);
    const copy = await call('POST', `/roles/${roleIds.floor}/duplicate`, { token: admin.token });
    assert.equal(copy.body.name, 'Floor Lead (copy)');
    assert.equal(copy.body.grants.length, 2);
    roleIds.copy = copy.body.id;
  });

  test('giving roles opens the apps they need; taking them away closes the apps', async () => {
    const admin = await login('olivia');
    const before = await login('rita');
    const given = await call('PUT', `/people/${ids.rita}/roles`, { token: admin.token, body: { roleIds: [roleIds.floor] } });
    assert.equal(given.status, 200, JSON.stringify(given.body));
    assert.deepEqual(given.body.apps, ['tasks']);
    assert.equal(provisionCalls.at(-1)!.body.personId, ids.rita, 'the app was asked for her user');
    const pushed = accessPushes.at(-1)!.body;
    assert.deepEqual(pushed.people.find((p: { personId: string }) => p.personId === ids.rita).roleIds, [roleIds.floor]);
    assert.deepEqual(decodeJwt((await login('rita')).token).apps, { tasks: '42' });

    const taken = await call('PUT', `/people/${ids.rita}/roles`, { token: admin.token, body: { roleIds: [] } });
    assert.deepEqual(taken.body.apps, []);
    assert.deepEqual(decodeJwt((await login('rita')).token).apps, {});
    assert.equal((await call('POST', '/auth/refresh', { cookie: before.cookie, body: {} })).status, 401, 'signed out when apps closed');
  });

  test('Make Admin / Make Member; the Owner role is never given; only owners change owners (§19.28)', async () => {
    const admin = await login('admin@acme.test');
    const level = async (id: string, l: string, token = admin.token) => call('PUT', `/people/${id}/level`, { token, body: { level: l } });
    const of = async (id: string) => ((await call('GET', '/people', { token: admin.token })).body as Array<{ id: string; platformRole: string; roleIds: string[] }>).find((p) => p.id === id)!;
    const made = await level(ids.rita, 'admin');
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.deepEqual((await of(ids.rita)).roleIds, [roleIds.admin]);
    assert.equal((await of(ids.rita)).platformRole, 'admin', 'the access level follows the Admin role');
    const rita = await login('rita');
    assert.equal((await call('GET', '/people', { token: rita.token })).status, 200, 'the new admin manages people at once');
    assert.equal((await level(ids.rita, 'member')).status, 200);
    assert.deepEqual((await of(ids.rita)).roleIds, [roleIds.member], 'Member replaces Admin');
    assert.equal((await of(ids.rita)).platformRole, 'member');
    assert.equal((await call('GET', '/people', { token: (await login('rita')).token })).status, 403, 'and the Admin workspace closes');
    assert.equal((await call('PATCH', `/people/${ids.rita}`, { token: admin.token, body: { platformRole: 'admin' } })).status, 200, 'the access level on People does the same');
    assert.deepEqual((await of(ids.rita)).roleIds, [roleIds.admin]);
    assert.equal((await call('PUT', `/people/${ids.rita}/roles`, { token: admin.token, body: { roleIds: [roleIds.owner] } })).status, 400, 'the hidden Owner role cannot be given');
    assert.equal((await call('PUT', `/people/${ids.owner}/roles`, { token: admin.token, body: { roleIds: [] } })).status, 403, "only an owner changes an owner's roles");
    assert.equal((await level(ids.admin, 'member', admin.token)).status, 400, 'nobody but the owner takes away their own Admin role');
    const owner = await login('olivia');
    assert.equal((await call('PUT', `/people/${ids.rita}/roles`, { token: owner.token, body: { roleIds: [roleIds.copy] } })).status, 200);
  });

  test('extra access and responsibilities for one person: a hidden personal role the apps check like any role (§19.28)', async () => {
    const owner = await login('olivia');
    const set = (id: string, body: unknown, token = owner.token) => call('PUT', `/people/${id}/access/personal`, { token, body });
    const duty = { title: 'Count the stock', frequency: 'weekly', weekday: 4, steps: ['Shelf A', 'Shelf B'] };
    const res = await set(ids.rita, { grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'company' }, { app: 'tasks', permission: 'tasks.assign' }], duties: [duty] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.adds, [{ app: 'tasks', permission: 'tasks.view', scope: 'company' }], 'what her roles do not already give (her role has Give tasks)');
    assert.equal(res.body.extra.duties[0].title, 'Count the stock');
    const pushed = accessPushes.at(-1)!.body;
    const mine = pushed.roles.find((r: { kind: string; code: string }) => r.kind === 'personal' && r.code === `ff_person_${ids.rita.replace(/-/g, '')}`);
    assert.ok(mine, 'pushed as a role of its own');
    assert.deepEqual(mine.grants.map((g: { permission: string; scope: string }) => `${g.permission}@${g.scope}`).sort(), ['tasks.assign@', 'tasks.view@company']);
    assert.equal(mine.duties[0].frequency, 'weekly', 'with the duty, so Tasks creates it for her');
    assert.ok(pushed.people.find((p: { personId: string }) => p.personId === ids.rita).roleIds.includes(mine.id), 'held by her');
    const list = await call('GET', '/roles', { token: owner.token });
    assert.ok(!list.body.some((r: { id: string }) => r.id === mine.id), 'never listed with the roles');
    assert.equal((await call('PUT', `/people/${ids.member}/roles`, { token: owner.token, body: { roleIds: [mine.id] } })).status, 400, 'never given to anyone else');
    assert.equal((await call('PATCH', `/roles/${mine.id}`, { token: owner.token, body: { description: 'x' } })).status, 404);
    const people = await call('GET', '/people', { token: owner.token });
    assert.equal(people.body.find((p: { id: string }) => p.id === ids.rita).extraAccess, true);
    const admin = await login('admin@acme.test');
    assert.equal((await set(ids.admin, { grants: [] }, admin.token)).status, 403, 'nobody but the owner gives themselves extra access');
    assert.equal((await set(ids.owner, { grants: [] }, admin.token)).status, 403, "only owners change an owner's access");
    assert.equal((await set(ids.rita, { grants: [{ app: 'tasks', permission: 'tasks.delete_admin_work' }] }, admin.token)).status, 403, 'Owner-only powers stay with the owner (R1)');
    const emptied = await set(ids.rita, { grants: [], duties: [] });
    assert.equal(emptied.status, 200);
    assert.ok(!accessPushes.at(-1)!.body.roles.some((r: { id: string }) => r.id === mine.id), 'emptied: deleted');
  });

  test('archiving a role takes it from everyone and closes apps it alone gave', async () => {
    const admin = await login('olivia');
    const res = await call('DELETE', `/roles/${roleIds.copy}`, { token: admin.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = await call('GET', '/roles', { token: admin.token });
    assert.ok(!list.body.some((r: { id: string }) => r.id === roleIds.copy));
    const peopleList = await call('GET', '/people', { token: admin.token });
    const rita = peopleList.body.find((p: { id: string }) => p.id === ids.rita);
    assert.deepEqual(rita.roleIds, []);
    const held = await dbs.db.select({ name: roles.name, kind: roles.kind, archived: roles.archived }).from(personRoles).innerJoin(roles, eq(roles.id, personRoles.roleId)).where(eq(personRoles.personId, ids.rita));
    assert.deepEqual(rita.apps, [], JSON.stringify(held));
    assert.ok(!accessPushes.at(-1)!.body.roles.some((r: { id: string }) => r.id === roleIds.copy), 'the apps archive it');
  });

  test('an app ahead of the Platform (e.g. Platform restored from a backup) still gets the change', async () => {
    const admin = await login('olivia');
    fakeAccessVersion += 1000;
    const before = accessPushes.length;
    const res = await call('PUT', `/people/${ids.rita}/roles`, { token: admin.token, body: { roleIds: [roleIds.floor] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.sync.tasks, 'ok');
    const sent = accessPushes.slice(before).map((p) => p.body.version);
    assert.equal(sent.length, 2, 'refused once as stale, then resent');
    assert.ok(sent[1] > sent[0] && sent[1] >= fakeAccessVersion - 0, 'the resend is past the app version');
    assert.deepEqual(accessPushes.at(-1)!.body.people.find((p: { personId: string }) => p.personId === ids.rita).roleIds, [roleIds.floor]);
  });
});

describe('every feature is a permission (§19.19)', () => {
  const made: Record<string, string> = {};
  const role = async (name: string, grants: Array<{ app: string; permission: string; scope?: string }>, level = 1) => {
    const admin = await login('admin@acme.test');
    const res = await call('POST', '/roles', { token: admin.token, body: { name, level, grants } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id as string;
  };
  const person = async (fullName: string, email: string, username: string, roleIds: string[], platformRole = 'member') => {
    const owner = await login('olivia');
    const res = await call('POST', '/people', { token: owner.token, body: { fullName, email, platformRole, login: { username, password: PASSWORD } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const given = await call('PUT', `/people/${res.body.person.id}/roles`, { token: owner.token, body: { roleIds } });
    assert.equal(given.status, 200, JSON.stringify(given.body));
    return res.body.person.id as string;
  };

  test('a member with "Manage people" lists and adds people, but cannot touch roles, settings or admins', async () => {
    made.peopleRole = await role('People desk', [{ app: 'platform', permission: 'people.manage' }]);
    made.pam = await person('Pam People', 'pam19@acme.test', 'pam', [made.peopleRole]);
    const pam = await login('pam');
    const me = await call('GET', '/auth/me', { token: pam.token });
    assert.deepEqual(me.body.permissions, ['people.manage']);
    assert.equal((await call('GET', '/people', { token: pam.token })).status, 200);
    assert.equal((await call('GET', '/roles', { token: pam.token })).status, 200, 'People & access shows role names');
    const added = await call('POST', '/people', { token: pam.token, body: { fullName: 'Nina New', email: 'nina19@acme.test' } });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    made.nina = added.body.person.id;
    assert.equal((await call('PATCH', `/people/${made.nina}`, { token: pam.token, body: { designation: 'Clerk' } })).status, 200);
    assert.equal((await call('POST', '/people', { token: pam.token, body: { fullName: 'Ada Admin', email: 'ada19@acme.test', platformRole: 'admin' } })).status, 403, 'cannot make admins');
    assert.equal((await call('PATCH', `/people/${ids.admin}`, { token: pam.token, body: { designation: 'X' } })).status, 403, 'cannot change an admin');
    assert.equal((await call('POST', '/roles', { token: pam.token, body: { name: 'Mine' } })).status, 403, 'not roles');
    assert.equal((await call('PUT', `/people/${made.nina}/roles`, { token: pam.token, body: { roleIds: [] } })).status, 403);
    assert.equal((await call('PATCH', '/company', { token: pam.token, body: { shortName: 'X' } })).status, 403, 'not settings');
    assert.equal((await call('PUT', `/people/${made.nina}/login`, { token: pam.token, body: { username: 'nina' } })).status, 403, 'not passwords');
    assert.equal((await call('DELETE', `/people/${made.nina}`, { token: pam.token, body: { confirm: 'Nina New' } })).status, 403, 'not delete');
  });

  test('each Admin permission opens exactly its own action; taking the role away closes it at once', async () => {
    made.deskRole = await role('Settings and passwords', [
      { app: 'platform', permission: 'company.settings' },
      { app: 'platform', permission: 'people.passwords' },
      { app: 'platform', permission: 'people.delete' },
    ]);
    made.sam = await person('Sal Settings', 'sal19@acme.test', 'sal', [made.deskRole]);
    const sal = await login('sal');
    assert.equal((await call('PATCH', '/company', { token: sal.token, body: { shortName: 'Acme' } })).status, 200);
    assert.equal((await call('PUT', `/people/${made.nina}/login`, { token: sal.token, body: { username: 'nina2', password: PASSWORD } })).status, 200);
    assert.equal((await call('PUT', `/people/${ids.admin}/login`, { token: sal.token, body: { password: PASSWORD } })).status, 403, "not an admin's password");
    assert.equal((await call('POST', '/people', { token: sal.token, body: { fullName: 'Not Allowed' } })).status, 403);
    assert.equal((await call('GET', '/roles', { token: sal.token })).status, 200, 'People & access opens for passwords');
    assert.equal((await call('DELETE', `/people/${made.nina}`, { token: sal.token, body: { confirm: 'Nina New' } })).status, 200, 'deletes a member');
    const owner = await login('olivia');
    assert.equal((await call('PUT', `/people/${made.sam}/roles`, { token: owner.token, body: { roleIds: [] } })).status, 200);
    assert.equal((await call('PATCH', '/company', { token: sal.token, body: { shortName: 'Acme' } })).status, 403, 'checked against the database on every call');
  });

  test('the owner is never locked out: everything without any role, through the hidden Owner role (§19.28)', async () => {
    const owner = await login('olivia');
    const me = await call('GET', '/auth/me', { token: owner.token });
    assert.deepEqual(me.body.permissions, ['billing.manage', 'company.settings', 'people.delete', 'people.exit', 'people.manage', 'people.passwords', 'roles.manage']);
    const list = await call('GET', '/roles', { token: owner.token });
    assert.ok(!list.body.some((r: { code: string }) => r.code === 'ff_owner' || r.code === 'ff_super_admin'), 'no Super Admin / Owner role in the list');
    const [ownerRole] = await dbs.db.select().from(roles).where(and(eq(roles.companyId, ids.acme), eq(roles.kind, 'owner')));
    assert.equal((await call('PATCH', `/roles/${ownerRole.id}`, { token: owner.token, body: { grants: [] } })).status, 404);
    assert.equal((await call('DELETE', `/roles/${ownerRole.id}`, { token: owner.token })).status, 404);
    const admin = (list.body as Array<{ id: string; code: string }>).find((r) => r.code === 'ff_admin')!.id;
    const before = await call('PUT', `/people/${ids.owner}/roles`, { token: owner.token, body: { roleIds: [] } });
    assert.equal(before.status, 200);
    const again = await login('olivia');
    assert.equal((await call('GET', '/people', { token: again.token })).status, 200, 'owners keep the Admin workspace without roles');
    assert.deepEqual(decodeJwt(again.token).apps, { tasks: '42' }, 'and every app, through the Owner role');
    const held = await dbs.db.select().from(personRoles).where(eq(personRoles.personId, ids.owner));
    assert.deepEqual(held.map((h) => h.roleId), [ownerRole.id], 'the Owner role stays when their listed roles go');
    assert.equal((await call('PUT', `/people/${ids.owner}/roles`, { token: again.token, body: { roleIds: [admin] } })).status, 200);
  });

  test("a new catalogue version upgrades every role once; the Owner role follows the catalogue; pushes say which version", async () => {
    const rolesSvc = app.get(RolesService);
    const saved = JSON.parse(JSON.stringify(FAKE_CATALOGUE));
    Object.assign(FAKE_CATALOGUE, {
      version: 2,
      retired: ['tasks.assign'],
      permissions: [
        ...FAKE_CATALOGUE.permissions.filter((p) => p.key !== 'tasks.assign'),
        { key: 'tasks.give', label: 'Give tasks', group: 'Tasks', scopes: null, upgrade: [{ from: 'tasks.assign' }] },
        { key: 'groups.create', label: 'Create groups', group: 'Tasks', scopes: null, upgrade: [{ from: 'tasks.assign' }] },
        { key: 'notices.view', label: 'Notices', group: 'Notices', scopes: null, upgrade: [{ everyone: true }] },
        { key: 'leads.delete', label: 'Delete leads', group: 'Leads', scopes: null, upgrade: [{ minLevel: 3 }] },
        { key: 'hr.live', label: 'Live', group: 'Attendance', scopes: ['team', 'department', 'company'], upgrade: [{ from: 'tasks.view', fromScopes: ['company'], scope: 'company' }, { from: 'tasks.view', scope: 'team' }] },
      ],
    });
    try {
      (rolesSvc as unknown as { catalogues: Map<string, unknown> }).catalogues.clear();
      const admin = await login('olivia');
      const list = await call('GET', '/roles', { token: admin.token });
      const byCode = Object.fromEntries(list.body.map((r: { code: string }) => [r.code, r]));
      const perms = (code: string) => byCode[code].grants.filter((g: { app: string }) => g.app === 'tasks').map((g: { permission: string; scope: string }) => `${g.permission}@${g.scope}`).sort();
      const floor = list.body.find((r: { name: string }) => r.name === 'Floor Lead');
      assert.deepEqual(
        floor.grants.map((g: { permission: string; scope: string }) => `${g.permission}@${g.scope}`).sort(),
        ['groups.create@', 'hr.live@team', 'notices.view@', 'tasks.give@', 'tasks.view@department'],
        'same powers in the new catalogue; the retired permission is replaced',
      );
      assert.ok(perms('ff_admin').includes('leads.delete@'), `Admin level gets what level 3 had: ${JSON.stringify(byCode.ff_admin)}`);
      assert.ok(perms('ff_admin').includes('hr.live@company'), 'the widest matching scope');
      const grantsOf = async (where: ReturnType<typeof eq>) => {
        const [r] = await dbs.db.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, ids.acme), where));
        return (await dbs.db.select().from(roleGrants).where(and(eq(roleGrants.roleId, r.id), eq(roleGrants.app, 'tasks')))).map((g) => `${g.permission}@${g.scope}`).sort();
      };
      assert.deepEqual(await grantsOf(eq(roles.personId, ids.member)), ['hr.live@team', 'notices.view@', 'tasks.view@team'], 'personal roles are upgraded too');
      assert.deepEqual(await grantsOf(eq(roles.kind, 'owner')), ['groups.create@', 'hr.live@company', 'leads.delete@', 'notices.view@', 'tasks.delete_admin_work@', 'tasks.give@', 'tasks.view@company']);
      const peopleDesk = list.body.find((r: { id: string }) => r.id === made.peopleRole);
      assert.deepEqual(peopleDesk.grants.map((g: { app: string }) => g.app), ['platform'], 'a role without Tasks permissions gets none');
      const [c] = await dbs.db.select({ upgrades: companies.accessUpgrades }).from(companies).where(eq(companies.id, ids.acme));
      assert.equal(c.upgrades.tasks, 2);

      // Once only: a permission an admin then takes away stays away.
      const edited = await call('PATCH', `/roles/${floor.id}`, { token: admin.token, body: { grants: [{ app: 'tasks', permission: 'tasks.give' }] } });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      const again = await call('GET', '/roles', { token: admin.token });
      assert.equal(again.body.find((r: { id: string }) => r.id === floor.id).grants.length, 1);
      assert.deepEqual(accessPushes.at(-1)!.body.catalogueVersions, { tasks: 2, platform: 1 });
    } finally {
      Object.keys(FAKE_CATALOGUE).forEach((k) => delete (FAKE_CATALOGUE as unknown as Record<string, unknown>)[k]);
      Object.assign(FAKE_CATALOGUE, saved);
      (rolesSvc as unknown as { catalogues: Map<string, unknown> }).catalogues.clear();
    }
  });
});

describe('settings center (Phase 4)', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

  test('members cannot see or change the company settings', async () => {
    const mia = await login('mia');
    assert.equal((await call('GET', '/company', { token: mia.token })).status, 403);
    assert.equal((await call('PATCH', '/company', { token: mia.token, body: { shortName: 'X' } })).status, 403);
  });

  test('admins rename the company and set its colour; the apps get it', async () => {
    const admin = await login('admin@acme.test');
    const res = await call('PATCH', '/company', { token: admin.token, body: { name: 'Acme Industries', shortName: 'Acme', colour: '#0F7B5F' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.colour, '#0f7b5f');
    assert.equal(res.body.sync.tasks, 'ok');
    const pushed = companyPushes.at(-1)!;
    assert.equal(pushed.cid, ids.acme);
    assert.deepEqual({ name: pushed.body.name, shortName: pushed.body.shortName, colour: pushed.body.colour }, { name: 'Acme Industries', shortName: 'Acme', colour: '#0f7b5f' });
    assert.equal((await call('PATCH', '/company', { token: admin.token, body: { colour: 'green' } })).status, 400);
    const me = await call('GET', '/auth/me', { token: admin.token });
    assert.equal(me.body.company.shortName, 'Acme');
  });

  test('logo: images only, checked by content; served publicly; removable', async () => {
    const admin = await login('admin@acme.test');
    const bad = await call('PUT', '/company/logo', { token: admin.token, body: { image: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` } });
    assert.equal(bad.status, 400);
    const ok = await call('PUT', '/company/logo', { token: admin.token, body: { image: `data:image/png;base64,${PNG.toString('base64')}` } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.logoUrl.startsWith(`/api/platform/brand/${ids.acme}/logo?v=`), ok.body.logoUrl);
    assert.equal(companyPushes.at(-1)!.body.logoUrl, ok.body.logoUrl);
    const img = await fetch(`${base}/brand/${ids.acme}/logo`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    const gone = await call('DELETE', '/company/logo', { token: admin.token });
    assert.equal(gone.body.logoUrl, null);
    assert.equal((await fetch(`${base}/brand/${ids.acme}/logo`)).status, 404);
  });

  test('modules come from the apps; only offered modules in apps of the plan can be switched', async () => {
    const admin = await login('admin@acme.test');
    const before = await call('GET', '/company', { token: admin.token });
    const tasks = before.body.modules.find((m: { app: string }) => m.app === 'tasks');
    assert.deepEqual(tasks.modules.map((m: { key: string; on: boolean }) => [m.key, m.on]), [['leads', true], ['payroll', true]], 'nothing set = on (existing companies)');
    const res = await call('PUT', '/company/modules', { token: admin.token, body: { tasks: { payroll: false } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(companyPushes.at(-1)!.body.modules, { payroll: false });
    assert.equal((await call('PUT', '/company/modules', { token: admin.token, body: { tasks: { rockets: true } } })).status, 400);
    assert.equal((await call('PUT', '/company/modules', { token: admin.token, body: { assets: { sims: true } } })).status, 400, 'Acme has no Assets');
  });

  test('a new company starts with the launch defaults', async () => {
    const [c] = await app.get(DbService).db.insert(companies).values({ name: 'Newco', code: 'NEWCO', enabledApps: ['tasks'] }).returning();
    await app.get(CompanyService).applyLaunchDefaults(c.id);
    const [row] = await app.get(DbService).db.select({ modules: companies.modules }).from(companies).where(eq(companies.id, c.id));
    assert.deepEqual(row.modules, { tasks: { leads: false, payroll: false } });
  });

  test('an app ahead of the Platform still gets the profile', async () => {
    const admin = await login('admin@acme.test');
    fakeProfileVersion += 500;
    const res = await call('PATCH', '/company', { token: admin.token, body: { shortName: 'ACME' } });
    assert.equal(res.body.sync.tasks, 'ok');
    assert.ok(companyPushes.at(-1)!.body.version >= fakeProfileVersion);
  });
});

describe('people directory (Phase 5)', () => {
  const dept: Record<string, string> = {};

  test('departments: admins add and rename; codes stay; names are unique', async () => {
    const admin = await login('admin@acme.test');
    const mia = await login('mia');
    assert.equal((await call('POST', '/departments', { token: mia.token, body: { name: 'Sales' } })).status, 403);
    const sales = await call('POST', '/departments', { token: admin.token, body: { name: 'Sales & Marketing' } });
    assert.equal(sales.status, 201, JSON.stringify(sales.body));
    assert.equal(sales.body.code, 'sales-marketing');
    dept.sales = sales.body.id;
    assert.equal((await call('POST', '/departments', { token: admin.token, body: { name: 'sales & marketing' } })).status, 400);
    const ops = await call('POST', '/departments', { token: admin.token, body: { name: 'Operations' } });
    dept.ops = ops.body.id;
    const renamed = await call('PATCH', `/departments/${dept.sales}`, { token: admin.token, body: { name: 'Sales' } });
    assert.equal(renamed.body.code, 'sales-marketing', 'the code never changes');
    const list = await call('GET', '/departments', { token: mia.token });
    assert.deepEqual(list.body.map((d: { name: string }) => d.name), ['Operations', 'Sales']);
  });

  test('a person gets a department, designation, manager and join date; loops and strangers are refused', async () => {
    const admin = await login('admin@acme.test');
    const res = await call('PATCH', `/people/${ids.member}`, {
      token: admin.token,
      body: { departmentId: dept.sales, designation: 'Sales Executive', reportsTo: ids.admin, joinDate: '2026-04-01' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reportsTo, ids.admin);
    // Mia reports to Adam, so Adam cannot report to Mia.
    assert.equal((await call('PATCH', `/people/${ids.admin}`, { token: admin.token, body: { reportsTo: ids.member } })).status, 400);
    assert.equal((await call('PATCH', `/people/${ids.member}`, { token: admin.token, body: { reportsTo: ids.member } })).status, 400);
    assert.equal((await call('PATCH', `/people/${ids.member}`, { token: admin.token, body: { departmentId: '00000000-0000-4000-8000-000000000000' } })).status, 400);
    assert.equal((await call('PATCH', `/people/${ids.member}`, { token: admin.token, body: { reportsTo: ids.otherShared } })).status, 400, 'someone from another company');
  });

  test('the directory is pushed to the apps, with each app\'s people only; deactivation travels too', async () => {
    const admin = await login('admin@acme.test');
    await app.get(DbService).db.insert(personApps).values({ personId: ids.member, app: 'tasks', localUserId: '77' }).onConflictDoNothing();
    const res = await call('PATCH', `/people/${ids.member}`, { token: admin.token, body: { designation: 'Senior Sales Executive' } });
    assert.equal(res.body.sync.tasks, 'ok');
    const pushed = peoplePushes.at(-1)!;
    assert.equal(pushed.cid, ids.acme);
    assert.deepEqual(pushed.body.departments.map((d: { code: string }) => d.code).sort(), ['operations', 'sales-marketing']);
    const mia = pushed.body.people.find((p: { personId: string }) => p.personId === ids.member);
    assert.deepEqual(mia, { personId: ids.member, status: 'active', departmentCode: 'sales-marketing', designation: 'Senior Sales Executive', reportsTo: ids.admin, joinDate: '2026-04-01', employeeCode: 'SHARED1' });
    for (const p of pushed.body.people) {
      const [has] = await app.get(DbService).db.select().from(personApps).where(eq(personApps.personId, p.personId));
      assert.ok(has, 'only people who have Tasks are sent to Tasks');
    }
  });

  test('an existing company is brought in from its apps once', async () => {
    const dbs = app.get(DbService);
    const [c] = await dbs.db.insert(companies).values({ name: 'Oldco', code: 'OLDCO', enabledApps: ['tasks'] }).returning();
    const [boss] = await dbs.db.insert(people).values({ companyId: c.id, fullName: 'Old Boss' }).returning();
    const [worker] = await dbs.db.insert(people).values({ companyId: c.id, fullName: 'Old Worker' }).returning();
    fakePeopleExport = {
      departments: [{ code: 'sales', name: 'Sales' }, { code: 'warehouse', name: 'Warehouse', active: false }],
      people: [
        { personId: worker.id, departmentCode: 'warehouse', reportsTo: boss.id },
        { personId: boss.id, departmentCode: 'sales', reportsTo: null },
        { personId: ids.member, departmentCode: 'sales', reportsTo: boss.id },
      ],
    };
    const dir = app.get(DirectoryService);
    const first = await dir.sync(c.id);
    assert.equal(first.imported, true);
    const depts = await dbs.db.select().from(departments).where(eq(departments.companyId, c.id));
    assert.deepEqual(depts.map((d) => [d.code, d.active]).sort(), [['sales', true], ['warehouse', false]]);
    const [w] = await dbs.db.select().from(people).where(eq(people.id, worker.id));
    assert.equal(w.reportsTo, boss.id);
    assert.equal(w.departmentId, depts.find((d) => d.code === 'warehouse')!.id);
    const [m] = await dbs.db.select().from(people).where(eq(people.id, ids.member));
    assert.notEqual(m.reportsTo, boss.id, 'a person of another company is never changed');
    assert.equal((await dir.sync(c.id)).imported, false, 'only the first time');
    fakePeopleExport = { departments: [], people: [] };
  });
});

describe('role duties (Phase 5)', () => {
  test('duties are saved with lasting ids, checked, and sent to the apps with the role', async () => {
    const admin = await login('olivia');
    const bad = await call('POST', '/roles', { token: admin.token, body: { name: 'Duty Bad', grants: [], duties: [{ title: 'Weekly sweep', frequency: 'weekly' }] } });
    assert.equal(bad.status, 400, 'weekly needs a day');
    const created = await call('POST', '/roles', {
      token: admin.token,
      body: {
        name: 'Store Keeper',
        grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }],
        duties: [
          { title: 'Open the store', frequency: 'daily', steps: ['Unlock', 'Count cash'] },
          { title: 'Stock count', frequency: 'monthly', monthDay: 25 },
          { title: 'Read the store SOP', frequency: 'once' },
        ],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const duties = created.body.duties as Array<{ id: string; title: string; weekday: number | null; monthDay: number | null }>;
    assert.equal(duties.length, 3);
    assert.ok(duties.every((d) => /^[0-9a-f-]{36}$/.test(d.id)));
    assert.equal(duties[1].monthDay, 25);
    const pushed = accessPushes.at(-1)!.body.roles.find((r: { id: string }) => r.id === created.body.id);
    assert.deepEqual(pushed.duties.map((d: { title: string }) => d.title), ['Open the store', 'Stock count', 'Read the store SOP']);

    // Editing keeps the ids of the duties that stay.
    const kept = duties.slice(0, 2).map((d) => ({ ...d }));
    const updated = await call('PATCH', `/roles/${created.body.id}`, { token: admin.token, body: { duties: kept } });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.deepEqual(updated.body.duties.map((d: { id: string }) => d.id), duties.slice(0, 2).map((d) => d.id));
    const copy = await call('POST', `/roles/${created.body.id}/duplicate`, { token: admin.token });
    assert.notEqual(copy.body.duties[0].id, duties[0].id, 'a copy has its own duties');
  });
});

describe('cross-app flows (Phase 5)', () => {
  let fakeAssets: Server;
  const assetEvents: Array<{ id: number; type: string; payload: unknown }> = [];

  before(async () => {
    fakeAssets = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/events')) {
        // Like the real app: each company has its own outbox (here only Acme has events).
        const cid = decodeJwt(String(req.headers.authorization).slice(7)).cid;
        const after = Number(new URL(url, 'http://x').searchParams.get('after') ?? 0);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(cid === ids.acme ? assetEvents.filter((e) => e.id > after) : []));
        return;
      }
      flowCalls.push({ app: 'assets', method: req.method!, url, body: raw ? JSON.parse(raw) : null });
      if (url.endsWith('/provision')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ userId: 'a-77' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, caseNumber: 'EXIT-00001', applied: true, version: 1 }));
    });
    await new Promise<void>((r) => fakeAssets.listen(0, '127.0.0.1', r));
    process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${(fakeAssets.address() as AddressInfo).port}/api/internal`;
    await app.get(DbService).db.update(companies).set({ enabledApps: ['tasks', 'assets'] }).where(eq(companies.id, ids.acme));
  });

  after(async () => {
    delete process.env.ASSETS_INTERNAL_URL;
    await app.get(DbService).db.update(companies).set({ enabledApps: ['tasks'] }).where(eq(companies.id, ids.acme));
    await new Promise((r) => fakeAssets.close(r));
  });

  test('a new Assets ticket becomes a task for an owner who has Tasks, linked back to the ticket', async () => {
    const dbs = app.get(DbService);
    await dbs.db.insert(personApps).values({ personId: ids.admin, app: 'tasks', localUserId: '7' }).onConflictDoNothing();
    assetEvents.push({ id: 1, type: 'ticket.created', payload: { ticketId: 'tk-1', number: 'TKT-00001', title: 'Laptop dead', priority: 'HIGH', reporter: 'Mia', ownerPersonIds: [ids.otherShared, ids.admin] } });
    const before = flowCalls.length;
    await app.get(FlowsService).pollAll();
    const calls = flowCalls.slice(before);
    const made = calls.find((c) => c.app === 'tasks' && c.url.endsWith('/tasks'))!;
    assert.equal(made.body.assigneePersonId, ids.admin, 'the first owner in this company with Tasks');
    assert.equal(made.body.externalRef, 'assets:ticket:tk-1');
    const link = calls.find((c) => c.app === 'assets' && c.url.endsWith('/tickets/tk-1/link'))!;
    assert.deepEqual(link.body, { assigneePersonId: ids.admin, ref: 'T-00042', url: '/tasks/tasks/42' });
    const again = flowCalls.length;
    await app.get(FlowsService).pollAll();
    assert.equal(flowCalls.length, again, 'each event is handled once');
  });

  test('completing the linked task resolves the ticket', async () => {
    fakeTaskEvents.push({ id: 1, type: 'task.completed', payload: { externalRef: 'assets:ticket:tk-1', code: 'T-00042', remarks: 'New battery' } });
    const before = flowCalls.length;
    await app.get(FlowsService).pollAll();
    const resolve = flowCalls.slice(before).find((c) => c.url.endsWith('/tickets/tk-1/resolve'))!;
    assert.equal(resolve.body.resolution, 'New battery (T-00042 in Tasks)');
  });

  test('start exit: Assets opens the case and Tasks makes the checklist; the completed exit switches the person off', async () => {
    const admin = await login('admin@acme.test');
    const dbs = app.get(DbService);
    await dbs.db.insert(personApps).values({ personId: ids.member, app: 'assets', localUserId: 'a-9' }).onConflictDoNothing();
    const mia = await login('mia');
    assert.equal((await call('POST', `/people/${ids.member}/exit`, { token: mia.token, body: { lastWorkingDate: '2026-12-31' } })).status, 403);
    const res = await call('POST', `/people/${ids.member}/exit`, { token: admin.token, body: { lastWorkingDate: '2026-12-31', reason: 'Moving' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.assets.caseNumber, 'EXIT-00001');
    assert.equal(res.body.tasks.code, 'T-00042');
    const [p] = await dbs.db.select().from(people).where(eq(people.id, ids.member));
    assert.equal(p.lastWorkingDate, '2026-12-31');
    assert.equal(p.status, 'active', 'still active until the exit is complete');

    const [otherBefore] = await dbs.db.select().from(people).where(eq(people.id, ids.otherShared));
    assetEvents.push({ id: 2, type: 'exit.completed', payload: { personIds: [ids.member, ids.otherShared] } });
    await app.get(FlowsService).pollAll();
    const [after] = await dbs.db.select().from(people).where(eq(people.id, ids.member));
    assert.equal(after.status, 'inactive');
    const [other] = await dbs.db.select().from(people).where(eq(people.id, ids.otherShared));
    assert.equal(other.status, otherBefore.status, 'never someone from another company');
    assert.equal((await call('POST', '/auth/login', { body: { login: 'mia', password: PASSWORD } })).status, 401);
    await dbs.db.update(people).set({ status: 'active', lastWorkingDate: null }).where(eq(people.id, ids.member));
  });

  test('a new joiner given Assets is onboarded, with their role names for the kit', async () => {
    const admin = await login('admin@acme.test');
    const created = await call('POST', '/people', { token: admin.token, body: { fullName: 'Joe Joiner', email: 'joe@acme.test', joinDate: '2099-01-15' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const before = flowCalls.length;
    const granted = await call('PUT', `/people/${created.body.person.id}/apps/assets`, { token: admin.token, body: {} });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    const onboard = flowCalls.slice(before).find((c) => c.url.endsWith('/onboarding'))!;
    assert.deepEqual(onboard.body, { personId: created.body.person.id, joinDate: '2099-01-15', roleNames: [] });
  });
});

describe('reset with a chosen password (§19.12)', () => {
  test('at least 6 characters; weak ones are accepted; never a forced change (R3, R7)', async () => {
    const admin = await login('admin@acme.test');
    const short = await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'abcde' } });
    assert.equal(short.status, 400);
    assert.match(short.body.message, /at least 6/);

    const keep = await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'abc123', mustChangePassword: false } });
    assert.equal(keep.status, 200, JSON.stringify(keep.body));
    assert.equal(keep.body.generatedPassword, undefined, 'a typed password is never sent back');
    const first = await call('POST', '/auth/login', { body: { login: 'mia', password: 'abc123' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.mustChangePassword, false);

    const ask = await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'abc1234', mustChangePassword: true } });
    assert.equal(ask.status, 200, 'an old client asking for a forced change is fine');
    assert.equal((await call('POST', '/auth/login', { body: { login: 'mia', password: 'abc1234' } })).body.mustChangePassword, false, 'but nothing forces it');
    const weak = await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'mia123' } });
    assert.equal(weak.status, 200, 'a weak password (their own name) is only warned about in the web app, never refused');
    assert.equal((await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: 'abc1234' } })).status, 200);
    const [row] = await dbs.db.select().from(logins).where(eq(logins.personId, ids.member));
    assert.match(row.passwordHash, /^\$argon2id\$/, 'hashed only');

    // Changing your own password also accepts 6 characters.
    const mia = await login('mia', 'abc1234');
    assert.equal((await call('POST', '/auth/change-password', { token: mia.token, body: { currentPassword: 'abc1234', newPassword: 'short' } })).status, 400);
    assert.equal((await call('POST', '/auth/change-password', { token: mia.token, body: { currentPassword: 'abc1234', newPassword: 'six666' } })).status, 200);
    await dbs.db.update(logins).set({ passwordHash: await hashPassword(PASSWORD), mustChangePassword: false }).where(eq(logins.personId, ids.member));
  });
});

describe('delete a person permanently (§19.12)', () => {
  let fakeAssets: Server;
  let assetsDelete: { status: number; body: unknown } = { status: 200, body: { deleted: true, counts: { requests: 2 } } };
  const add = async (fullName: string, extra: Partial<typeof people.$inferInsert> = {}) => {
    const [p] = await dbs.db.insert(people).values({ companyId: ids.acme, fullName, ...extra }).returning();
    return p.id;
  };

  before(async () => {
    fakeAssets = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const url = req.url ?? '';
      if (req.method === 'DELETE') {
        deleteCalls.push({ app: 'assets', cid: decodeJwt(String(req.headers.authorization).slice(7)).cid, url, body: raw ? JSON.parse(raw) : null });
        res.writeHead(assetsDelete.status, { 'content-type': 'application/json' }).end(JSON.stringify(assetsDelete.body));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ applied: true, version: 1 }));
    });
    await new Promise<void>((r) => fakeAssets.listen(0, '127.0.0.1', r));
    process.env.ASSETS_INTERNAL_URL = `http://127.0.0.1:${(fakeAssets.address() as AddressInfo).port}/api/internal`;
    await dbs.db.update(companies).set({ enabledApps: ['tasks', 'assets'] }).where(eq(companies.id, ids.acme));
  });

  after(async () => {
    delete process.env.ASSETS_INTERNAL_URL;
    await dbs.db.update(companies).set({ enabledApps: ['tasks'] }).where(eq(companies.id, ids.acme));
    await new Promise((r) => fakeAssets.close(r));
  });

  test('who may delete whom', async () => {
    const admin = await login('admin@acme.test');
    const owner = await login('olivia');
    const mia = await login('mia');
    const other = await add('Alan Otheradmin', { platformRole: 'admin' });
    const before = deleteCalls.length;
    assert.equal((await call('DELETE', `/people/${ids.admin}`, { token: mia.token, body: { confirm: 'Adam Admin' } })).status, 403, 'members delete nobody');
    assert.equal((await call('DELETE', `/people/${ids.admin}`, { token: admin.token, body: { confirm: 'Adam Admin' } })).status, 400, 'not yourself');
    assert.equal((await call('DELETE', `/people/${ids.owner}`, { token: admin.token, body: { confirm: 'Olivia Owner' } })).status, 403, 'never the owner');
    assert.equal((await call('DELETE', `/people/${ids.owner}`, { token: owner.token, body: { confirm: 'Olivia Owner' } })).status, 400, 'the owner is themselves');
    assert.equal((await call('DELETE', `/people/${other}`, { token: admin.token, body: { confirm: 'Alan Otheradmin' } })).status, 403, 'admins do not delete admins');
    assert.equal((await call('DELETE', `/people/${ids.otherShared}`, { token: owner.token, body: { confirm: 'Sam Shared' } })).status, 404, 'other companies are invisible');
    assert.equal(deleteCalls.length, before, 'no app was called');
    const [still] = await dbs.db.select().from(people).where(eq(people.id, other));
    assert.equal(still.status, 'active');
    const done = await call('DELETE', `/people/${other}`, { token: owner.token, body: { confirm: 'Alan Otheradmin' } });
    assert.equal(done.status, 200, 'the owner deletes an admin: ' + JSON.stringify(done.body));
  });

  test('the full name must be typed (case and spaces do not matter)', async () => {
    const admin = await login('admin@acme.test');
    const id = await add('Nora Name');
    const wrong = await call('DELETE', `/people/${id}`, { token: admin.token, body: { confirm: 'Nora' } });
    assert.equal(wrong.status, 400);
    assert.equal((await call('DELETE', `/people/${id}`, { token: admin.token, body: {} })).status, 400);
    const [p] = await dbs.db.select().from(people).where(eq(people.id, id));
    assert.equal(p.status, 'active', 'nothing happens on a mismatch');
    assert.equal((await call('DELETE', `/people/${id}`, { token: admin.token, body: { confirm: '  nora   NAME ' } })).status, 200);
  });

  test('an app that cannot delete stops everything: they stay switched off, the admin can retry', async () => {
    const admin = await login('admin@acme.test');
    const created = await call('POST', '/people', { token: admin.token, body: { fullName: 'Dora Delete', email: 'dora@acme.test', login: { username: 'dora', password: 'dora12' } } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const dora = created.body.person.id as string;
    await dbs.db.insert(personApps).values([
      { personId: dora, app: 'tasks', localUserId: '91' },
      { personId: dora, app: 'assets', localUserId: 'a-91' },
    ]);
    const report = await add('Rex Report', { reportsTo: dora });
    const session = await login('dora', 'dora12');

    assetsDelete = { status: 409, body: { message: 'They still hold 2 assets on an open exit' } };
    const blocked = await call('DELETE', `/people/${dora}`, { token: admin.token, body: { confirm: 'Dora Delete' } });
    assert.equal(blocked.status, 502);
    assert.equal(blocked.body.message, 'Assets could not delete their data: They still hold 2 assets on an open exit');
    const [kept] = await dbs.db.select().from(people).where(eq(people.id, dora));
    assert.equal(kept.status, 'inactive', 'switched off');
    assert.equal((await dbs.db.select().from(logins).where(eq(logins.personId, dora))).length, 1, 'login kept');
    assert.equal((await call('POST', '/auth/refresh', { cookie: session.cookie })).status, 401, 'sessions ended');
    assert.equal((await call('POST', '/auth/login', { body: { login: 'dora', password: 'dora12' } })).status, 401);

    fakeTasksDelete = { status: 500, body: { detail: 'boom' } };
    assetsDelete = { status: 200, body: { deleted: true, counts: { requests: 2 } } };
    const down = await call('DELETE', `/people/${dora}`, { token: admin.token, body: { confirm: 'Dora Delete' } });
    assert.equal(down.status, 502);
    assert.equal(down.body.message, 'Tasks could not delete their data: boom');
    fakeTasksDelete = { status: 200, body: { deleted: true, counts: { tasks: 3, comments: 1 } } };

    const before = deleteCalls.length;
    const pushesBefore = peoplePushes.length;
    const ok = await call('DELETE', `/people/${dora}`, { token: admin.token, body: { confirm: 'Dora Delete' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(
      { deleted: ok.body.deleted, apps: ok.body.apps },
      { deleted: true, apps: { tasks: { tasks: 3, comments: 1 }, assets: { requests: 2 } } },
    );
    assert.deepEqual(
      deleteCalls.slice(before).map((c) => [c.app, c.cid, c.url]),
      [
        ['tasks', ids.acme, `/api/internal/people/${dora}`],
        ['assets', ids.acme, `/api/internal/people/${dora}`],
      ],
    );
    assert.deepEqual(deleteCalls.slice(before).map((c) => c.body), [null, null], 'no choices: no body (delete everything)');
    assert.equal((await dbs.db.select().from(people).where(eq(people.id, dora))).length, 0);
    assert.equal((await dbs.db.select().from(logins).where(eq(logins.personId, dora))).length, 0);
    assert.equal((await dbs.db.select().from(personApps).where(eq(personApps.personId, dora))).length, 0);
    assert.equal((await dbs.db.select().from(refreshSessions).where(eq(refreshSessions.personId, dora))).length, 0);
    const [rex] = await dbs.db.select().from(people).where(eq(people.id, report));
    assert.equal(rex.reportsTo, null, 'nobody reports to a deleted person');
    const push = peoplePushes.slice(pushesBefore).at(-1);
    assert.ok(push && !push.body.people.some((x: { personId: string }) => x.personId === dora), 'the directory is pushed without them');
    assert.equal((await call('POST', '/auth/login', { body: { login: 'dora', password: 'dora12' } })).status, 401);
  });

  test('choices: hand over and keep history; each app gets only its own choices', async () => {
    const admin = await login('admin@acme.test');
    const manager = await add('Max Manager');
    await dbs.db.insert(personApps).values([
      { personId: manager, app: 'tasks', localUserId: '92' },
      { personId: manager, app: 'assets', localUserId: 'a-92' },
    ]);
    const leaver = await add('Lea Leaver', { reportsTo: manager });
    await dbs.db.insert(personApps).values([
      { personId: leaver, app: 'tasks', localUserId: '93' },
      { personId: leaver, app: 'assets', localUserId: 'a-93' },
    ]);
    fakeTasksDelete = { status: 200, body: { deleted: true, counts: { 'accounts.User': 1 }, handed_over: { tasks: 4, leads: 0, assets: 0 }, anonymised: true } };
    assetsDelete = { status: 200, body: { deleted: true, counts: { users: 1 }, handed_over: { tasks: 0, leads: 0, assets: 2 }, anonymised: true } };
    const options = {
      tasks: { mode: 'hand_over', to: manager },
      leads: { mode: 'delete' },
      history: { mode: 'keep' },
      assets: { mode: 'hand_over', to: manager },
    };
    const before = deleteCalls.length;
    const res = await call('DELETE', `/people/${leaver}`, { token: admin.token, body: { confirm: 'Lea Leaver', options } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      deleteCalls.slice(before).map((c) => [c.app, c.body]),
      [
        ['tasks', { tasks: options.tasks, leads: options.leads, history: options.history }],
        ['assets', { history: options.history, assets: options.assets }],
      ],
    );
    assert.deepEqual(res.body.handedOver, { tasks: { tasks: 4, leads: 0, assets: 0 }, assets: { tasks: 0, leads: 0, assets: 2 } });
    assert.deepEqual(res.body.anonymised, { tasks: true, assets: true });
    assert.equal((await dbs.db.select().from(people).where(eq(people.id, leaver))).length, 0);
    fakeTasksDelete = { status: 200, body: { deleted: true, counts: { tasks: 3, comments: 1 } } };
    assetsDelete = { status: 200, body: { deleted: true, counts: { requests: 2 } } };
  });

  test('hand-over people are checked first: nothing happens and they stay active when the choice is wrong', async () => {
    const admin = await login('admin@acme.test');
    const leaver = await add('Ben Bad Choice');
    const asleep = await add('Ivy Inactive', { status: 'inactive' });
    await dbs.db.insert(personApps).values({ personId: asleep, app: 'tasks', localUserId: '94' });
    const noTasks = await add('Nat No Tasks');
    const del = (options: unknown) => call('DELETE', `/people/${leaver}`, { token: admin.token, body: { confirm: 'Ben Bad Choice', options } });
    const before = deleteCalls.length;
    for (const [options, why] of [
      [{ tasks: { mode: 'hand_over', to: leaver } }, 'not the person'],
      [{ tasks: { mode: 'hand_over', to: asleep } }, 'not an inactive person'],
      [{ leads: { mode: 'hand_over', to: noTasks } }, 'leads need someone with Tasks'],
      [{ assets: { mode: 'hand_over', to: ids.admin } }, 'assets need someone with Assets'],
      [{ tasks: { mode: 'hand_over', to: ids.otherShared } }, 'not someone from another company'],
      [{ tasks: { mode: 'hand_over' } }, 'a hand-over needs a person'],
      [{ history: { mode: 'shred' } }, 'only keep or delete'],
      [{ tasks: { mode: 'delete' }, extra: true }, 'unknown choices are refused'],
    ] as const) {
      const res = await del(options);
      assert.equal(res.status, 400, `${why}: ${JSON.stringify(res.body)}`);
    }
    assert.equal(deleteCalls.length, before, 'no app was called');
    const [p] = await dbs.db.select().from(people).where(eq(people.id, leaver));
    assert.equal(p.status, 'active');
  });

  test('an app that refuses the choices: 400 with its message; switched back on unless an app already deleted', async () => {
    const admin = await login('admin@acme.test');
    const leaver = await add('Cid Choice');
    fakeTasksDelete = { status: 400, body: { detail: 'That person cannot take over leads' } };
    const refused = await call('DELETE', `/people/${leaver}`, { token: admin.token, body: { confirm: 'Cid Choice', options: { leads: { mode: 'delete' } } } });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.message, 'Tasks: That person cannot take over leads');
    const [p] = await dbs.db.select().from(people).where(eq(people.id, leaver));
    assert.equal(p.status, 'active', 'nothing was done, so they are switched back on');

    fakeTasksDelete = { status: 200, body: { deleted: true, counts: { tasks: 3, comments: 1 } } };
    assetsDelete = { status: 400, body: { statusCode: 400, message: ['to must be an active user'], error: 'Bad Request' } };
    const late = await call('DELETE', `/people/${leaver}`, { token: admin.token, body: { confirm: 'Cid Choice', options: { assets: { mode: 'stock' } } } });
    assert.equal(late.status, 400);
    assert.match(late.body.message, /^Assets: to must be an active user \(Tasks already removed their data/);
    const [q] = await dbs.db.select().from(people).where(eq(people.id, leaver));
    assert.equal(q.status, 'inactive', 'Tasks already deleted: they stay switched off');
    assetsDelete = { status: 200, body: { deleted: true, counts: { requests: 2 } } };
    assert.equal((await call('DELETE', `/people/${leaver}`, { token: admin.token, body: { confirm: 'Cid Choice', options: { assets: { mode: 'stock' } } } })).status, 200);
  });

  test('an app that never had them is fine; apps outside the plan are not called', async () => {
    const admin = await login('admin@acme.test');
    await dbs.db.update(companies).set({ enabledApps: ['tasks'] }).where(eq(companies.id, ids.acme));
    fakeTasksDelete = { status: 200, body: { deleted: false } };
    const id = await add('Paula Plain');
    const before = deleteCalls.length;
    const res = await call('DELETE', `/people/${id}`, { token: admin.token, body: { confirm: 'Paula Plain' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.apps, { tasks: {} });
    assert.deepEqual(deleteCalls.slice(before).map((c) => c.app), ['tasks']);
    fakeTasksDelete = { status: 200, body: { deleted: true, counts: { tasks: 3, comments: 1 } } };
    await dbs.db.update(companies).set({ enabledApps: ['tasks', 'assets'] }).where(eq(companies.id, ids.acme));
  });
});

describe('security hardening (docs/security/platform.md)', () => {
  const LOCKED = 'Too many failed attempts. Try again in a few minutes.';
  const WRONG = 'The email, mobile number, username or password is not right. Check them and try again.';
  const throttle = () => app.get(Throttle);
  const addPerson = async (companyId: string, fullName: string, username: string, platformRole = 'member') => {
    const [p] = await dbs.db.insert(people).values({ companyId, fullName, platformRole }).returning();
    await dbs.db.insert(logins).values({ personId: p.id, username, passwordHash: await hashPassword(PASSWORD) });
    return p.id;
  };

  /** The old lockout, turned back on with `LOGIN_MAX_FAILED` (off by default: founder decision 2026-10-19). */
  const withLockout = async (max: string, fn: () => Promise<void>) => {
    process.env.LOGIN_MAX_FAILED = max;
    try {
      await fn();
    } finally {
      delete process.env.LOGIN_MAX_FAILED;
    }
  };

  after(() => throttle().reset());

  test('LOGIN_MAX_FAILED=3: parallel wrong passwords cannot get past the lockout; a lock that ran out starts over', () =>
    withLockout('3', async () => {
      throttle().reset();
      const id = await addPerson(ids.acme, 'Rex Racer', 'sec_rex');
      const answers = await Promise.all(Array.from({ length: 20 }, () => call('POST', '/auth/login', { body: { login: 'sec_rex', password: 'wrong-pass' } })));
      const checked = answers.filter((a) => a.body.message === WRONG).length;
      assert.ok(checked <= 3, `at most 3 passwords were checked, not ${checked}`);
      assert.ok(answers.every((a) => a.status === 401 && (a.body.message === WRONG || a.body.message === LOCKED)));
      const right = await call('POST', '/auth/login', { body: { login: 'sec_rex', password: PASSWORD } });
      assert.equal(right.status, 401);
      assert.equal(right.body.message, LOCKED, 'locked, even with the right password');
      const [row] = await dbs.db.select().from(logins).where(eq(logins.personId, id));
      assert.equal(row.failedLogins, 3);
      assert.ok(row.lockedUntil && row.lockedUntil > new Date());
      await dbs.db.update(logins).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(logins.personId, id));
      await login('sec_rex');
      const [later] = await dbs.db.select().from(logins).where(eq(logins.personId, id));
      assert.equal(later.failedLogins, 0);
      throttle().reset();
    }));

  test('LOGIN_MAX_FAILED=3: a name that matches nobody answers exactly like a real account, "too many" included', () =>
    withLockout('3', async () => {
      throttle().reset();
      const answers: Res[] = [];
      for (let i = 0; i < 4; i++) answers.push(await call('POST', '/auth/login', { body: { login: 'nobody-at-all', password: 'wrong-pass' } }));
      assert.deepEqual(
        answers.slice(0, 3).map((a) => a.body.message),
        Array(3).fill(WRONG),
      );
      assert.equal(answers[3].status, 401);
      assert.equal(answers[3].body.message, LOCKED);
      throttle().reset();
    }));

  test('by default a name that matches nobody never answers "too many", like a real account', async () => {
    throttle().reset();
    assert.equal(maxFailedLogins(), 0, 'no lockout by default');
    assert.equal(ipLimit(), 1000, 'bot guard: 1000 failed sign-ins per network per 15 minutes');
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', '/auth/login', { body: { login: 'nobody-at-all', password: 'wrong-pass' } });
      assert.equal(res.status, 401);
      assert.equal(res.body.message, WRONG);
    }
    throttle().reset();
  });

  test('too many failed sign-ins from one address are refused for a while (password spraying)', async () => {
    throttle().reset();
    process.env.LOGIN_IP_LIMIT = '3';
    try {
      for (const name of ['spray-a', 'spray-b', 'spray-c']) {
        assert.equal((await call('POST', '/auth/login', { body: { login: name, password: 'Summer2026' } })).status, 401);
      }
      const next = await call('POST', '/auth/login', { body: { login: 'mia', password: PASSWORD } });
      assert.equal(next.status, 429);
      assert.equal(next.body.message, 'Too many sign-in attempts from this network. Wait a few minutes.');
    } finally {
      delete process.env.LOGIN_IP_LIMIT;
      throttle().reset();
    }
    await login('mia');
  });

  test('LOGIN_MAX_FAILED=3, change password: a stolen access token cannot be used to guess the current password', () =>
    withLockout('3', async () => {
      throttle().reset();
      const mia = await login('mia');
      for (let i = 0; i < 3; i++) {
        assert.equal((await call('POST', '/auth/change-password', { token: mia.token, body: { currentPassword: `guess-${i}`, newPassword: 'Another@123' } })).status, 400);
      }
      const blocked = await call('POST', '/auth/change-password', { token: mia.token, body: { currentPassword: PASSWORD, newPassword: 'Another@123' } });
      assert.equal(blocked.status, 429, 'refused even with the right password');
      throttle().reset();
    }));

  test('sign out, "sign out everywhere" and a password reset end Platform access at once, not after 15 minutes', async () => {
    const a = await login('mia');
    const b = await login('mia');
    assert.equal((await call('POST', '/auth/logout', { cookie: a.cookie })).status, 200);
    assert.equal((await call('GET', '/auth/me', { token: a.token })).status, 401, 'signed-out session');
    assert.equal((await call('GET', '/auth/me', { token: b.token })).status, 200, 'the other session goes on');
    const all = await call('POST', '/auth/logout-all', { token: b.token });
    assert.equal(all.status, 200);
    assert.equal((await call('GET', '/auth/me', { token: b.token })).status, 401);
    assert.equal((await call('POST', '/auth/refresh', { cookie: b.cookie })).status, 401);
    const c = await login('mia');
    const admin = await login('admin@acme.test');
    assert.equal((await call('PUT', `/people/${ids.member}/login`, { token: admin.token, body: { password: PASSWORD, mustChangePassword: false } })).status, 200);
    assert.equal((await call('GET', '/auth/me', { token: c.token })).status, 401, 'after a password reset');
  });

  test('answers are never cached', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ login: 'mia', password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/health`)).headers.get('cache-control'), 'no-store');
  });

  test('tokens: EdDSA only, user audience only; a key made by another Platform process is accepted', async () => {
    const mia = await login('mia');
    const claims = decodeJwt(mia.token);
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${mia.token.split('.')[1]}.`;
    assert.equal((await call('GET', '/auth/me', { token: unsigned })).status, 401, 'alg none');
    const hs = await new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(new TextEncoder().encode('x'.repeat(32)));
    assert.equal((await call('GET', '/auth/me', { token: hs })).status, 401, 'HS256');
    const service = await app.get(TokensService).signService('tasks', ids.acme);
    assert.equal((await call('GET', '/auth/me', { token: service })).status, 401, 'service token');
    // Another process rotates the key; this one has never seen the new kid.
    const otherKeys = new KeysService(dbs);
    const otherTokens = new TokensService(otherKeys);
    await otherKeys.rotate();
    const fresh = await otherTokens.signAccess({ personId: ids.member, companyId: ids.acme, name: 'Mia Member', role: 'member', apps: {}, sessionFamily: claims.fam as string });
    assert.notEqual(decodeJwtHeader(fresh).kid, decodeJwtHeader(mia.token).kid);
    assert.equal((await call('GET', '/auth/me', { token: fresh })).status, 200, 'new key picked up');
    assert.equal((await call('GET', '/auth/me', { token: mia.token })).status, 200, 'old key still valid until its tokens expire');
  });

  test('a member with Manage people cannot choose an app role; a member with Manage roles cannot change an admin', async () => {
    const owner = await login('olivia');
    const mkRole = async (name: string, permission: string) => {
      const r = await call('POST', '/roles', { token: owner.token, body: { name, grants: [{ app: 'platform', permission }] } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id as string;
    };
    const gina = await addPerson(ids.acme, 'Gina Grant', 'sec_gina');
    const rita = await addPerson(ids.acme, 'Rita Roles', 'sec_rita');
    const plain = await addPerson(ids.acme, 'Pete Plain', 'sec_pete');
    assert.equal((await call('PUT', `/people/${gina}/roles`, { token: owner.token, body: { roleIds: [await mkRole('Grant desk', 'people.manage')] } })).status, 200);
    assert.equal((await call('PUT', `/people/${rita}/roles`, { token: owner.token, body: { roleIds: [await mkRole('Role desk', 'roles.manage')] } })).status, 200);
    const g = await login('sec_gina');
    assert.equal((await call('PUT', `/people/${plain}/apps/tasks`, { token: g.token, body: { appRole: 'super_admin' } })).status, 403, 'app role = permissions');
    assert.equal((await call('PUT', `/people/${gina}/apps/tasks`, { token: g.token, body: { appRole: 'super_admin' } })).status, 403, 'not for themselves either');
    assert.equal((await call('PUT', `/people/${plain}/apps/tasks`, { token: g.token, body: {} })).status, 200, 'the app default is fine');
    assert.equal((await call('PUT', `/people/${plain}/apps/tasks`, { token: owner.token, body: { appRole: 'super_admin' } })).status, 200, 'owners may');
    const r = await login('sec_rita');
    assert.equal((await call('PUT', `/people/${ids.admin}/roles`, { token: r.token, body: { roleIds: [] } })).status, 403, 'not an admin');
    assert.equal((await call('PUT', `/people/${ids.owner}/roles`, { token: r.token, body: { roleIds: [] } })).status, 403, 'not the owner');
    assert.equal((await call('PUT', `/people/${plain}/roles`, { token: r.token, body: { roleIds: [] } })).status, 200, 'members: yes');
  });

  test('Manage roles gives only what you have: permissions, scopes, level; never Admin-level or Super Admin (R1)', async () => {
    const owner = await login('olivia');
    const roleList = async () => (await call('GET', '/roles', { token: owner.token })).body as Array<{ id: string; code: string; name: string }>;
    const mk = async (name: string, grants: Array<{ app: string; permission: string; scope?: string }>, level = 1) => {
      const r = await call('POST', '/roles', { token: owner.token, body: { name, level, grants } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id as string;
    };
    // Rex: Manage roles, Tasks "See tasks" at Team, and "Give tasks"; a Manager-level role.
    const rexRole = await mk('R1 Lead', [
      { app: 'platform', permission: 'roles.manage' },
      { app: 'tasks', permission: 'tasks.view', scope: 'team' },
      { app: 'tasks', permission: 'tasks.assign' },
    ], 2);
    const rex = await addPerson(ids.acme, 'Rex Roles', 'r1_rex');
    const pat = await addPerson(ids.acme, 'Pat Plain', 'r1_pat');
    assert.equal((await call('PUT', `/people/${rex}/roles`, { token: owner.token, body: { roleIds: [rexRole] } })).status, 200);
    const r = await login('r1_rex');
    const make = (body: unknown) => call('POST', '/roles', { token: r.token, body });

    const me = await call('GET', '/auth/me', { token: r.token });
    assert.equal(me.body.held.level, 2);
    assert.deepEqual(
      me.body.held.grants.map((g: { app: string; permission: string; scope: string }) => `${g.app}:${g.permission}@${g.scope}`).sort(),
      ['platform:roles.manage@', 'tasks:tasks.assign@', 'tasks:tasks.view@team'],
      '/auth/me says what they hold, for the role editor',
    );

    // Create: only what they hold, at no wider scope, no higher level, never Admin level.
    const ok = await make({ name: 'R1 Helper', level: 1, grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'own' }, { app: 'tasks', permission: 'tasks.assign' }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const own = await make({ name: 'R1 Same', level: 2, grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }, { app: 'platform', permission: 'roles.manage' }] });
    assert.equal(own.status, 201, 'their own permissions and level: yes');
    const wider = await make({ name: 'R1 Wider', grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'company' }] });
    assert.equal(wider.status, 403);
    assert.match(wider.body.message, /only give permissions you have yourself.*Tasks · See tasks at Company \(you have Team\)/);
    const notHeld = await make({ name: 'R1 More', grants: [{ app: 'platform', permission: 'people.delete' }] });
    assert.equal(notHeld.status, 403);
    assert.match(notHeld.body.message, /Admin · Delete people permanently/);
    const ownerOnly = await make({ name: 'R1 Boss', grants: [{ app: 'tasks', permission: 'tasks.delete_admin_work' }] });
    assert.equal(ownerOnly.status, 403);
    assert.match(ownerOnly.body.message, /Owner only/);
    const admin3 = await make({ name: 'R1 Admin', level: 3, grants: [] });
    assert.equal(admin3.status, 403);
    assert.match(admin3.body.message, /Only the owner can create or edit Admin-level roles/);
    assert.equal((await make({ name: 'R1 X', level: 3 })).status, 403);

    // Edit: not a role beyond them (as it is or as it would be), not to a higher level.
    const all = await roleList();
    const byCode = (code: string) => all.find((x) => x.code === code)!.id;
    const helper = ok.body.id as string;
    assert.equal((await call('PATCH', `/roles/${helper}`, { token: r.token, body: { description: 'Edited' } })).status, 200);
    assert.equal((await call('PATCH', `/roles/${helper}`, { token: r.token, body: { level: 3 } })).status, 403, 'not to Admin level');
    assert.equal((await call('PATCH', `/roles/${helper}`, { token: r.token, body: { grants: [{ app: 'platform', permission: 'people.manage' }] } })).status, 403, 'not adding what they lack');
    const editAdmin = await call('PATCH', `/roles/${byCode('ff_admin')}`, { token: r.token, body: { description: 'mine now' } });
    assert.equal(editAdmin.status, 403);
    assert.match(editAdmin.body.message, /Only the owner can edit Admin-level roles/);
    const bigger = await mk('R1 Bigger', [{ app: 'platform', permission: 'people.manage' }]);
    const editBigger = await call('PATCH', `/roles/${bigger}`, { token: r.token, body: { grants: [] } });
    assert.equal(editBigger.status, 403, 'not taking apart a role with more than they have');
    assert.match(editBigger.body.message, /Only the owner can edit "R1 Bigger": it has permissions you do not have yourself/);
    assert.equal((await call('DELETE', `/roles/${bigger}`, { token: r.token })).status, 403, 'nor archive it');
    assert.equal((await call('DELETE', `/roles/${byCode('ff_admin')}`, { token: r.token })).status, 403);

    // Duplicate: an Admin-level role's copy is Admin level too, so only the owner makes one; Member may be copied.
    assert.equal((await call('POST', `/roles/${byCode('ff_admin')}/duplicate`, { token: r.token })).status, 403);
    assert.equal((await call('POST', `/roles/${helper}/duplicate`, { token: r.token })).status, 201, 'a role within their powers: yes');

    // Giving roles: only within their own permissions and level, to others and to themselves.
    assert.equal((await call('PUT', `/people/${pat}/roles`, { token: r.token, body: { roleIds: [helper] } })).status, 200);
    const giveBigger = await call('PUT', `/people/${pat}/roles`, { token: r.token, body: { roleIds: [helper, bigger] } });
    assert.equal(giveBigger.status, 403);
    assert.match(giveBigger.body.message, /You cannot give "R1 Bigger": it has permissions you do not have yourself \(Admin · Manage people\)/);
    const selfRaise = await call('PUT', `/people/${rex}/roles`, { token: r.token, body: { roleIds: [rexRole, bigger] } });
    assert.equal(selfRaise.status, 403, 'nobody but the owner raises their own access');
    const level3 = await call('PUT', `/people/${pat}/roles`, { token: r.token, body: { roleIds: [byCode('ff_admin')] } });
    assert.equal(level3.status, 403);
    assert.match(level3.body.message, /You cannot give "Admin": it is an Admin-level role and your own level is Manager/);
    assert.equal((await call('PUT', `/people/${pat}/roles`, { token: r.token, body: { roleIds: [helper] } })).status, 200, 'keeping a role already held is fine');
    assert.equal((await call('PUT', `/people/${pat}/roles`, { token: r.token, body: { roleIds: [] } })).status, 200, 'taking roles away is fine');

    // A platform admin is limited the same way (only the owner keeps everything); the owner may do all of it.
    const adam = await login('admin@acme.test');
    // An app role is a role too: checked through the role builder's copy of it.
    const asApp = await call('PUT', `/people/${pat}/apps/tasks`, { token: adam.token, body: { appRole: 'super_admin' } });
    assert.equal(asApp.status, 403);
    assert.match(asApp.body.message, /Only the owner can choose "super_admin" inside Tasks: it is not a role in the role builder/, 'the template roles are gone');
    assert.equal((await call('POST', '/roles', { token: adam.token, body: { name: 'R1 Admin desk', grants: [{ app: 'platform', permission: 'people.manage' }] } })).status, 201, 'the Admin role holds every Admin permission but billing');
    assert.equal((await call('POST', '/roles', { token: adam.token, body: { name: 'R1 Tasks', grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'company' }] } })).status, 201, 'and the Tasks permissions at Company scope');
    const boss = await call('POST', '/roles', { token: adam.token, body: { name: 'R1 Boss 2', grants: [{ app: 'tasks', permission: 'tasks.delete_admin_work' }] } });
    assert.equal(boss.status, 403, 'but never an Owner-only one');
    const billing = await call('POST', '/roles', { token: adam.token, body: { name: 'R1 Billing', grants: [{ app: 'platform', permission: 'billing.manage' }] } });
    assert.equal(billing.status, 403, 'nor billing, which Admin does not hold');

    // Personal extra access follows the same rule (R1).
    const extra = (body: unknown, who = pat) => call('PUT', `/people/${who}/access/personal`, { token: r.token, body });
    assert.equal((await extra({ grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }] })).status, 200, 'what they hold: yes');
    const extraWide = await extra({ grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'company' }] });
    assert.equal(extraWide.status, 403);
    assert.match(extraWide.body.message, /See tasks at Company \(you have Team\)/);
    assert.equal((await extra({ grants: [{ app: 'platform', permission: 'people.delete' }] })).status, 403, 'not what they lack');
    assert.equal((await extra({ grants: [] }, rex)).status, 403, 'not for themselves');
    assert.equal((await extra({ grants: [] })).status, 200, 'taking it away');
    assert.equal((await call('POST', `/roles/${byCode('ff_admin')}/duplicate`, { token: owner.token })).status, 201, 'the owner may duplicate Admin');
    assert.equal((await call('PUT', `/people/${pat}/roles`, { token: owner.token, body: { roleIds: [bigger, byCode('ff_admin')] } })).status, 200, 'the owner gives anything');
  });

  test("another company's people, roles and departments: invisible and untouchable (404/400), no company smuggling", async () => {
    const [{ companyId: otherId }] = await dbs.db.select({ companyId: people.companyId }).from(people).where(eq(people.id, ids.otherShared));
    await addPerson(otherId, 'Oscar Other', 'sec_oscar', 'owner');
    const o = await login('sec_oscar');
    const acmeRole = (await dbs.db.select({ id: roles.id }).from(roles).where(eq(roles.companyId, ids.acme)).limit(1))[0].id;
    let [acmeDept] = await dbs.db.select({ id: departments.id }).from(departments).where(eq(departments.companyId, ids.acme)).limit(1);
    if (!acmeDept) [acmeDept] = await dbs.db.insert(departments).values({ companyId: ids.acme, code: 'secret', name: 'Secret' }).returning({ id: departments.id });
    const m = ids.member;
    const expect404: Array<[string, string, unknown?]> = [
      ['PATCH', `/people/${m}`, { designation: 'Spy' }],
      ['DELETE', `/people/${m}`, { confirm: 'Mia Member' }],
      ['PUT', `/people/${m}/login`, { password: 'Taken@123' }],
      ['DELETE', `/people/${m}/login`],
      ['PUT', `/people/${m}/apps/tasks`, {}],
      ['DELETE', `/people/${m}/apps/tasks`],
      ['POST', `/people/${m}/exit`, { lastWorkingDate: '2026-12-31' }],
      ['PUT', `/people/${m}/roles`, { roleIds: [] }],
      ['PATCH', `/roles/${acmeRole}`, { name: 'Mine now' }],
      ['POST', `/roles/${acmeRole}/duplicate`],
      ['DELETE', `/roles/${acmeRole}`],
      ['PATCH', `/departments/${acmeDept.id}`, { name: 'Mine now' }],
    ];
    for (const [method, path, body] of expect404) {
      const res = await call(method, path, { token: o.token, body });
      assert.equal(res.status, 404, `${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const [mia] = await dbs.db.select().from(people).where(eq(people.id, m));
    assert.equal(mia.status, 'active');
    assert.notEqual(mia.designation, 'Spy');
    // Lists hold only their own company.
    const list = await call('GET', '/people', { token: o.token });
    assert.ok(list.body.every((p: { id: string }) => p.id !== m));
    assert.ok((await call('GET', '/roles', { token: o.token })).body.every((r: { id: string }) => r.id !== acmeRole));
    assert.ok((await call('GET', '/departments', { token: o.token })).body.every((d: { id: string }) => d.id !== acmeDept.id));
    // Another company's ids inside a body are refused.
    assert.equal((await call('PUT', `/people/${ids.otherShared}/roles`, { token: o.token, body: { roleIds: [acmeRole] } })).status, 400);
    assert.equal((await call('POST', '/people', { token: o.token, body: { fullName: 'X', departmentId: acmeDept.id } })).status, 400);
    assert.equal((await call('POST', '/people', { token: o.token, body: { fullName: 'X', reportsTo: m } })).status, 400);
    const handOver = await call('DELETE', `/people/${ids.otherShared}`, { token: o.token, body: { confirm: 'Sam Shared', options: { tasks: { mode: 'hand_over', to: m } } } });
    assert.equal(handOver.status, 400, JSON.stringify(handOver.body));
    // A company id (or status, or id) in the body is ignored: the person lands in the caller's company.
    const made = await call('POST', '/people', { token: o.token, body: { fullName: 'Smuggled', companyId: ids.acme, status: 'inactive', id: m } });
    assert.equal(made.status, 201);
    const [row] = await dbs.db.select().from(people).where(eq(people.id, made.body.person.id));
    assert.equal(row.companyId, otherId);
    assert.equal(row.status, 'active');
    assert.notEqual(row.id, m);
  });

  test('the events poller works in one Platform process at a time', async () => {
    const holder = await dbs.pool.connect();
    const [cur] = await dbs.db.select({ lastId: eventCursors.lastId }).from(eventCursors).where(and(eq(eventCursors.companyId, ids.acme), eq(eventCursors.app, 'tasks')));
    const nextId = Math.max(cur?.lastId ?? 0, ...fakeTaskEvents.map((e) => e.id)) + 1;
    fakeTaskEvents.push({ id: nextId, type: 'nothing.to.do', payload: {} });
    try {
      await holder.query('select pg_advisory_lock($1)', [EVENTS_LOCK]);
      assert.equal(await app.get(FlowsService).pollAll(), 0, 'another process is polling');
    } finally {
      await holder.query('select pg_advisory_unlock($1)', [EVENTS_LOCK]);
      holder.release();
    }
    assert.ok((await app.get(FlowsService).pollAll()) >= 1);
  });

  test('ids from another app never reach a URL unchecked', () => {
    assert.equal(pathId('tk-1'), 'tk-1');
    assert.equal(pathId(42), '42');
    for (const bad of ['../people/x', 'a/b', 'a?b=1', '', 'x'.repeat(65), null, undefined, {}]) assert.equal(pathId(bad), null);
  });

  test('old refresh rows are cleaned up; live sessions stay', async () => {
    const live = await login('mia');
    const [{ familyId }] = await dbs.db
      .select({ familyId: refreshSessions.familyId })
      .from(refreshSessions)
      .where(eq(refreshSessions.personId, ids.member))
      .orderBy(desc(refreshSessions.createdAt))
      .limit(1);
    const old = (id: string, extra: Partial<typeof refreshSessions.$inferInsert>) => ({ id, familyId, personId: ids.member, expiresAt: new Date(Date.now() + 86_400_000), ...extra });
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    await dbs.db.insert(refreshSessions).values([
      old('prune-expired', { expiresAt: new Date(Date.now() - 1000) }),
      old('prune-revoked', { revokedAt: longAgo }),
      old('prune-rotated', { rotatedAt: longAgo }),
      old('keep-recent-rotated', { rotatedAt: new Date() }),
    ]);
    assert.ok((await app.get(AuthService).pruneSessions()) >= 3);
    const left = (await dbs.db.select({ id: refreshSessions.id }).from(refreshSessions)).map((r) => r.id);
    assert.ok(!left.includes('prune-expired') && !left.includes('prune-revoked') && !left.includes('prune-rotated'));
    assert.ok(left.includes('keep-recent-rotated'));
    assert.equal((await call('POST', '/auth/refresh', { cookie: live.cookie })).status, 200);
  });

  test('logs never carry query values (password hashes, token hashes)', async () => {
    const err = (await dbs.db
      .insert(logins)
      .values({ personId: ids.member, username: null, passwordHash: '$argon2id$not-for-logs' })
      .catch((e: unknown) => e)) as Error;
    assert.match(String(err.message), /not-for-logs/, 'the driver puts the values in the message');
    assert.doesNotMatch(redact(err.stack ?? err.message), /not-for-logs/);
    assert.match(redact(err.stack ?? err.message), /insert into "platform"."logins"/, 'the SQL stays');
  });

  test('the demo company (public password) is never seeded in production', async () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await assert.rejects(seed(), /development only/);
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});
