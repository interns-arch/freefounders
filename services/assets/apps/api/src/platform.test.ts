// FreeFounders Platform sign-in tests. Run with `npm test`; shares the throwaway `eam_test` database
// with integration.test.ts, so it only adds its own rows and never assumes an empty database.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { exportJWK, SignJWT } from 'jose';
import { type Permission, SYSTEM_ROLES } from '@eam/shared';
import { DbService } from './db/db.service';
import { employees, roles, sessions, users } from './db/schema';
import { createApp } from './main';
import { hashPassword } from './modules/auth/auth.service';

const key = generateKeyPairSync('ed25519');
const forger = generateKeyPairSync('ed25519');
let app: INestApplication;
let base = '';
let dbs: DbService;
const ids: Record<string, string> = {};

function sign(claims: Record<string, unknown>, opts: { sub: string; aud?: string; ttl?: number; signer?: typeof key; iss?: string }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setSubject(opts.sub)
    .setIssuer(opts.iss ?? 'freefounders-platform')
    .setAudience(opts.aud ?? 'freefounders')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.ttl ?? 900))
    .sign((opts.signer ?? key).privateKey);
}

const access = (person: string, assetsUserId: string | undefined, extra: Partial<Parameters<typeof sign>[1]> = {}) =>
  sign({ cid: randomUUID(), apps: assetsUserId ? { assets: assetsUserId } : {} }, { sub: person, ...extra });
const service = (extra: Partial<Parameters<typeof sign>[1]> = {}) => sign({}, { sub: 'platform', aud: 'assets-internal', ...extra });

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const provision = async (body: Record<string, unknown>, token?: string) =>
  call('POST', '/internal/provision', token ?? (await service()), { personId: randomUUID(), fullName: 'Nina New', ...body });

before(async () => {
  process.env.PLATFORM_JWKS = JSON.stringify({ keys: [{ ...(await exportJWK(key.publicKey)), kid: 'k1', alg: 'EdDSA' }] });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  dbs = app.get(DbService);
  const db = dbs.root;

  await db
    .insert(roles)
    .values(SYSTEM_ROLES.map((r) => ({ name: r.name, description: r.description, permissions: r.permissions as Permission[], isSystem: true })))
    .onConflictDoNothing();
  const roleRows = await db.select().from(roles).where(inArray(roles.name, ['Manager', 'Employee']));
  ids.managerRole = roleRows.find((r) => r.name === 'Manager')!.id;
  ids.person = randomUUID();
  const [u] = await db
    .insert(users)
    .values({ email: 'pf-mia@t.test', name: 'PF Mia', passwordHash: await hashPassword('Test@12345'), roleId: ids.managerRole, platformPersonId: ids.person })
    .returning();
  ids.mia = u.id;
});

after(async () => {
  delete process.env.PLATFORM_JWKS;
  await app?.close();
});

describe('platform access tokens', () => {
  test('a valid token signs in as the linked user with their role permissions', async () => {
    const me = await call('GET', '/auth/me', await access(ids.person, ids.mia));
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'pf-mia@t.test');
    assert.equal(me.body.role.name, 'Manager');
    assert.ok(me.body.permissions.includes('request:approve'));
  });

  test('bad tokens are refused', async () => {
    const cases: Record<string, string> = {
      expired: await access(ids.person, ids.mia, { ttl: -120 }),
      'forged with another key': await access(ids.person, ids.mia, { signer: forger }),
      'service token': await access(ids.person, ids.mia, { aud: 'assets-internal' }),
      'wrong issuer': await access(ids.person, ids.mia, { iss: 'someone-else' }),
      'no Assets access': await access(ids.person, undefined),
      'another person': await access(randomUUID(), ids.mia),
      'unknown user': await access(ids.person, randomUUID()),
    };
    for (const [name, token] of Object.entries(cases)) {
      assert.equal((await call('GET', '/auth/me', token)).status, 401, name);
    }
  });

  test('a deactivated user is refused', async () => {
    await dbs.root.update(users).set({ isActive: false }).where(eq(users.id, ids.mia));
    assert.equal((await call('GET', '/auth/me', await access(ids.person, ids.mia))).status, 401);
    await dbs.root.update(users).set({ isActive: true }).where(eq(users.id, ids.mia));
  });

  test('permissions still apply: an Employee cannot manage users', async () => {
    const created = await provision({ email: 'pf-emp@t.test' });
    const person = (await dbs.root.select().from(users).where(eq(users.id, created.body.userId)))[0].platformPersonId!;
    const token = await access(person, created.body.userId);
    assert.equal((await call('GET', '/auth/me', token)).status, 200);
    assert.equal((await call('GET', '/users', token)).status, 403);
  });
});

describe('platform session exchange', () => {
  async function exchange(token?: string) {
    const res = await fetch(`${base}/auth/platform-session`, {
      method: 'POST',
      headers: { 'x-requested-with': 'XMLHttpRequest', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const meWithCookie = async (cookie: string) =>
    (await fetch(`${base}/auth/me`, { headers: { cookie } })).status;

  test('a Platform token becomes a short session cookie that works like a normal one', async () => {
    const { status, cookie } = await exchange(await access(ids.person, ids.mia, { ttl: 600 }));
    assert.equal(status, 200);
    assert.match(cookie!, /^eam_session=/);
    assert.equal(await meWithCookie(cookie!), 200);
    const rows = await dbs.root.select().from(sessions).where(eq(sessions.userId, ids.mia));
    const s = rows.find((r) => r.fixedExpiry)!;
    assert.ok(s.expiresAt.getTime() <= Date.now() + 600_000 + 1000, 'ends with the token');
  });

  test('it is never extended, and stops working when it ends', async () => {
    const { cookie } = await exchange(await access(ids.person, ids.mia));
    await dbs.root.update(sessions).set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(sessions.fixedExpiry, true));
    const [before] = await dbs.root.select().from(sessions).where(eq(sessions.fixedExpiry, true)).limit(1);
    assert.equal(await meWithCookie(cookie!), 200);
    const [afterUse] = await dbs.root.select().from(sessions).where(eq(sessions.id, before.id));
    assert.equal(afterUse.expiresAt.getTime(), before.expiresAt.getTime(), 'not slid forward');
    await dbs.root.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.fixedExpiry, true));
    assert.equal(await meWithCookie(cookie!), 401);
  });

  test('bad or missing tokens get no session', async () => {
    assert.equal((await exchange()).status, 401);
    assert.equal((await exchange(await access(ids.person, ids.mia, { signer: forger }))).status, 401);
    assert.equal((await exchange(await access(randomUUID(), ids.mia))).status, 401);
  });
});

describe('provision', () => {
  test('needs a Platform service token', async () => {
    assert.equal((await call('POST', '/internal/provision', undefined, { personId: randomUUID(), fullName: 'X' })).status, 401);
    assert.equal((await provision({}, await access(ids.person, ids.mia))).status, 401, 'access token is not a service token');
    assert.equal((await provision({}, await service({ sub: 'someone' }))).status, 401);
    assert.equal((await provision({}, await service({ signer: forger }))).status, 401);
  });

  test('creates an Employee login with a staff employee record and no known password', async () => {
    const person = randomUUID();
    const res = await provision({ personId: person, fullName: 'Nina New', email: 'PF-Nina@t.test', username: 'pf-nina', mobile: '9876543210' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.created, true);
    const [u] = await dbs.root.select().from(users).where(eq(users.id, res.body.userId));
    assert.equal(u.email, 'pf-nina@t.test');
    assert.equal(u.username, 'pf-nina');
    assert.equal(u.platformPersonId, person);
    assert.equal(u.passwordSaved, null, 'no reversible password copy');
    const [emp] = await dbs.root.select().from(employees).where(eq(employees.id, u.employeeId!));
    assert.equal(emp.fullName, 'Nina New');
    assert.match(emp.employeeCode, /^STAFF-/);
    const again = await provision({ personId: person, fullName: 'Nina New' });
    assert.deepEqual(again.body, { userId: res.body.userId, created: false }, 'idempotent');
  });

  test('links existing logins by employee ID, email or login ID; they keep their password', async () => {
    const [emp] = await dbs.root.insert(employees).values({ employeeCode: 'PF-E1', firstName: 'Ravi' }).returning();
    const [byCode] = await dbs.root.insert(users).values({ name: 'Ravi', passwordHash: 'x', roleId: ids.managerRole, employeeId: emp.id }).returning();
    const [byEmail] = await dbs.root.insert(users).values({ name: 'Esha', email: 'pf-esha@t.test', passwordHash: 'x', roleId: ids.managerRole }).returning();
    const [byName] = await dbs.root.insert(users).values({ name: 'Kiran', username: 'pf-kiran', passwordHash: 'x', roleId: ids.managerRole }).returning();
    assert.equal((await provision({ employeeCode: 'pf-e1' })).body.userId, byCode.id);
    assert.equal((await provision({ email: 'PF-ESHA@t.test' })).body.userId, byEmail.id);
    assert.equal((await provision({ username: 'PF-KIRAN' })).body.userId, byName.id);
    const [after] = await dbs.root.select().from(users).where(eq(users.id, byEmail.id));
    assert.equal(after.passwordHash, 'x');
  });

  test('never takes over a login linked to another person', async () => {
    assert.equal((await provision({ email: 'pf-mia@t.test' })).status, 409);
  });

  test('roles: chosen by name, unknown names refused, leadership gets no employee record', async () => {
    const mgr = await provision({ email: 'pf-mgr@t.test', appRole: 'manager' });
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, mgr.body.userId)))[0].roleId, ids.managerRole);
    assert.equal((await provision({ email: 'pf-x@t.test', appRole: 'Emperor' })).status, 400);
    const ceo = await provision({ email: 'pf-ceo@t.test', appRole: 'Leadership' });
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, ceo.body.userId)))[0].employeeId, null);
  });

  test('bad input is refused', async () => {
    assert.equal((await call('POST', '/internal/provision', await service(), { personId: 'nope', fullName: 'X' })).status, 400);
    assert.equal((await call('POST', '/internal/provision', await service(), { personId: randomUUID(), fullName: ' ' })).status, 400);
  });
});
