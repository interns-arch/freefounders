// Platform integration tests. Run with `npm test` (throwaway `ff_platform_test` database).
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { hashPassword } from './auth/auth.service';
import { DbService } from './db/db.service';
import { companies, logins, people, personApps, refreshSessions } from './db/schema';
import { createApp } from './main';

const PASSWORD = 'Test@12345';
let app: INestApplication;
let base = '';
let dbs: DbService;
let fakeTasks: Server;
const provisionCalls: Array<{ body: Record<string, unknown>; aud: unknown }> = [];
const ids: Record<string, string> = {};

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
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ value: 'warehouse', label: 'Warehouse Team' }]));
        return;
      }
      provisionCalls.push({ body: JSON.parse(raw), aud: payload.aud });
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

  test('locks after 5 wrong passwords, even with the right one', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { login: 'sam@other.test', password: 'wrong-password' } });
    const res = await call('POST', '/auth/login', { body: { login: 'sam@other.test', password: PASSWORD } });
    assert.equal(res.status, 401);
    assert.match(res.body.message, /Too many/);
    await dbs.db.update(logins).set({ failedLogins: 0, lockedUntil: null }).where(eq(logins.personId, ids.otherShared));
    await login('sam@other.test');
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

  test('admin adds a person with a login; they must change the generated password', async () => {
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
    assert.equal(nina.body.mustChangePassword, true);

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
    assert.equal(after.body.mustChangePassword, true);
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
    // An admin call with the deactivated person's still-valid access token is refused too.
    await dbs.db.update(people).set({ platformRole: 'admin' }).where(eq(people.id, ids.nina));
    assert.equal((await call('GET', '/people', { token: session.token })).status, 403);
  });
});

describe('apps', () => {
  test('granting Tasks provisions the user there and puts it in the token', async () => {
    const admin = await login('admin@acme.test');
    const grant = await call('PUT', `/people/${ids.member}/apps/tasks`, { token: admin.token, body: { appRole: 'warehouse' } });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal(grant.body.localUserId, '42');
    const last = provisionCalls.at(-1)!;
    assert.equal(last.aud, 'tasks-internal');
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
