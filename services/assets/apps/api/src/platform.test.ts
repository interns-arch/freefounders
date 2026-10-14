// FreeFounders Platform sign-in tests. Run with `npm test`; shares the throwaway `eam_test` database
// with integration.test.ts, so it only adds its own rows and never assumes an empty database.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { exportJWK, SignJWT } from 'jose';
import { type Permission, SYSTEM_ROLES } from '@eam/shared';
import { DbService } from './db/db.service';
import {
  allocations,
  assetCategories,
  assetRequests,
  assets,
  assetTypes,
  departments,
  employees,
  ffEvents,
  historyEvents,
  onboardingItems,
  onboardingKits,
  roles,
  sessions,
  syncState,
  tickets,
  users,
} from './db/schema';
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

  test("a new exchange clears that person's expired sessions (the table does not keep growing)", async () => {
    await dbs.root.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, ids.mia));
    const expired = (await dbs.root.select().from(sessions).where(eq(sessions.userId, ids.mia))).length;
    assert.ok(expired >= 2, `expired sessions before: ${expired}`);
    const { status } = await exchange(await access(ids.person, ids.mia));
    assert.equal(status, 200);
    const left = await dbs.root.select().from(sessions).where(eq(sessions.userId, ids.mia));
    assert.equal(left.length, 1, 'only the new session is left');
    assert.ok(left[0].expiresAt.getTime() > Date.now());
  });

  test('a read-only subscription (token claim ro, PLAN.md §21): reads work, writes get 402, also through the session cookie', async () => {
    const ro = await sign({ cid: randomUUID(), apps: { assets: ids.mia }, ro: true }, { sub: ids.person });
    assert.equal((await call('GET', '/auth/me', ro)).status, 200);
    const write = await call('POST', '/auth/change-password', ro, { currentPassword: 'x', newPassword: 'Another@123' });
    assert.equal(write.status, 402);
    assert.match(write.body.message, /read-only/);
    // The exchanged session carries it.
    const { status, cookie } = await exchange(ro);
    assert.equal(status, 200);
    assert.equal(await meWithCookie(cookie!), 200);
    const viaCookie = await fetch(`${base}/auth/change-password`, {
      method: 'POST',
      headers: { cookie: cookie!, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ currentPassword: 'x', newPassword: 'Another@123' }),
    });
    assert.equal(viaCookie.status, 402);
    // Without the claim the same write is not refused for that reason.
    const normal = await call('POST', '/auth/change-password', await access(ids.person, ids.mia), { currentPassword: 'x', newPassword: 'Another@123' });
    assert.notEqual(normal.status, 402);
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
    assert.ok(!('passwordSaved' in u), 'no reversible password copy');
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

  test('company owners and admins become Admins when no role is chosen', async () => {
    const adminRole = (await dbs.root.select().from(roles).where(eq(roles.name, 'Admin')))[0];
    const owner = await provision({ email: 'pf-owner@t.test', platformRole: 'owner' });
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, owner.body.userId)))[0].roleId, adminRole.id);
    const member = await provision({ email: 'pf-member@t.test', platformRole: 'member' });
    assert.notEqual((await dbs.root.select().from(users).where(eq(users.id, member.body.userId)))[0].roleId, adminRole.id);
    const chosen = await provision({ email: 'pf-chosen@t.test', platformRole: 'owner', appRole: 'manager' });
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, chosen.body.userId)))[0].roleId, ids.managerRole);
  });

  test('bad input is refused', async () => {
    assert.equal((await call('POST', '/internal/provision', await service(), { personId: 'nope', fullName: 'X' })).status, 400);
    assert.equal((await call('POST', '/internal/provision', await service(), { personId: randomUUID(), fullName: ' ' })).status, 400);
  });
});

describe('internal roles', () => {
  test('lists Assets roles for the Platform only', async () => {
    assert.equal((await call('GET', '/internal/roles')).status, 401);
    assert.equal((await call('GET', '/internal/roles', await access(ids.person, ids.mia))).status, 401);
    const res = await call('GET', '/internal/roles', await service());
    assert.equal(res.status, 200);
    assert.ok(res.body.some((r: { value: string }) => r.value === 'Manager'));
  });
});

describe('roles from the FreeFounders role builder', () => {
  const push = async (version: number, rolesIn: unknown[], people: unknown[]) =>
    call('PUT', '/internal/access', await service(), { version, roles: rolesIn, people });

  test('the catalogue and the endpoints are for the Platform only', async () => {
    assert.equal((await call('GET', '/internal/permissions')).status, 401);
    assert.equal((await call('PUT', '/internal/access', await access(ids.person, ids.mia), {})).status, 401);
    const res = await call('GET', '/internal/permissions', await service());
    assert.equal(res.status, 200);
    assert.equal(res.body.permissions.length, 24);
    assert.ok(res.body.permissions.some((p: { key: string; group: string }) => p.key === 'asset:view' && p.group === 'Assets'));
  });

  test('pushed roles replace the user role, add up, and can be taken away', async () => {
    const person = randomUUID();
    const user = await provision({ personId: person, email: 'pf-roles@t.test' });
    const [deskId, approverId] = [randomUUID(), randomUUID()];
    const res = await push(
      10,
      [
        { id: deskId, name: 'Help desk', grants: [{ app: 'assets', permission: 'ticket:manage' }, { app: 'assets', permission: 'nonsense:x' }, { app: 'tasks', permission: 'tasks.view', scope: 'company' }] },
        { id: approverId, name: 'Approver', grants: [{ app: 'assets', permission: 'request:approve' }] },
      ],
      [{ personId: person, roleIds: [deskId, approverId] }],
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.problems.length, 1);
    const me = await call('GET', '/auth/me', await access(person, user.body.userId));
    assert.deepEqual([...me.body.permissions].sort(), ['request:approve', 'ticket:manage']);

    // An older push arriving late changes nothing.
    assert.equal((await push(9, [], [{ personId: person, roleIds: [] }])).body.applied, false);
    // The Platform deletes "Help desk": archived here, and its permission is gone.
    await push(11, [{ id: approverId, name: 'Approver', grants: [{ app: 'assets', permission: 'request:approve' }] }], [{ personId: person, roleIds: [deskId, approverId] }]);
    const after = await call('GET', '/auth/me', await access(person, user.body.userId));
    assert.deepEqual(after.body.permissions, ['request:approve']);
    assert.equal((await dbs.root.select().from(roles).where(eq(roles.platformRoleId, deskId)))[0].archived, true);
    // No roles from the Platform: back to the user's own role (Employee).
    await push(12, [], [{ personId: person, roleIds: [] }]);
    const back = await call('GET', '/auth/me', await access(person, user.body.userId));
    assert.deepEqual([...back.body.permissions].sort(), ['request:create', 'ticket:create']);
  });

  test('an existing role with the same name is updated in place; export lists roles and people', async () => {
    const managerId = randomUUID();
    await push(20, [{ id: managerId, name: 'Manager', grants: [{ permission: 'request:approve' }, { permission: 'asset:view' }] }], []);
    const [mgr] = await dbs.root.select().from(roles).where(eq(roles.id, ids.managerRole));
    assert.equal(mgr.platformRoleId, managerId);
    assert.deepEqual([...mgr.permissions].sort(), ['asset:view', 'request:approve']);
    const exported = await call('GET', '/internal/access', await service());
    assert.equal(exported.body.version, 20);
    assert.ok(exported.body.roles.some((r: { name: string }) => r.name === 'Manager'));
    assert.ok(exported.body.people.some((p: { personId: string }) => p.personId === ids.person));
  });
});

describe('settings center (Phase 4)', () => {
  const clear = () => dbs.root.delete(syncState).where(inArray(syncState.key, ['ff_profile', 'ff_profile_version']));

  test('the module list and the profile need the Platform', async () => {
    assert.equal((await call('GET', '/internal/modules')).status, 401);
    assert.equal((await call('PUT', '/internal/company', await access(ids.person, ids.mia), { version: 1 })).status, 401);
    const cat = await call('GET', '/internal/modules', await service());
    assert.equal(cat.status, 200);
    assert.deepEqual(cat.body.modules.map((m: { key: string; default: boolean }) => [m.key, m.default]), [['sims', false]]);
  });

  test('without a profile everything is on and /config is unbranded', async () => {
    await clear();
    const cfg = await call('GET', '/config');
    assert.equal(cfg.body.brand, null);
    assert.deepEqual(cfg.body.modules, { sims: true });
  });

  test('switching SIMs off closes reconciliation; branding reaches /config; older pushes are ignored', async () => {
    const [adminRole] = await dbs.root.select().from(roles).where(eq(roles.name, 'Admin'));
    const [admin] = await dbs.root
      .insert(users)
      .values({ email: 'pf-admin@t.test', name: 'PF Admin', passwordHash: await hashPassword('Test@12345'), roleId: adminRole.id, platformPersonId: randomUUID() })
      .returning();
    const token = await access(admin.platformPersonId!, admin.id);
    try {
      assert.equal((await call('GET', '/reconciliations', token)).status, 200);
      const pushed = await call('PUT', '/internal/company', await service(), {
        version: 3, name: 'Acme Industries', shortName: 'Acme', colour: '#0f7b5f', logoUrl: '/api/platform/brand/x/logo?v=3', modules: { sims: false, rockets: true },
      });
      assert.deepEqual(pushed.body, { version: 3, applied: true });
      const off = await call('GET', '/reconciliations', token);
      assert.equal(off.status, 404);
      assert.equal(off.body.message, 'This module is switched off');
      assert.equal((await call('GET', '/assets', token)).status, 200, 'the rest of Assets stays on');
      const cfg = await call('GET', '/config');
      assert.equal(cfg.body.companyName, 'Acme Industries');
      assert.deepEqual(cfg.body.brand, { shortName: 'Acme', colour: '#0f7b5f', logoUrl: '/api/platform/brand/x/logo?v=3' });
      assert.deepEqual(cfg.body.modules, { sims: false });

      const late = await call('PUT', '/internal/company', await service(), { version: 2, name: 'Old', modules: {} });
      assert.deepEqual(late.body, { version: 3, applied: false });
      assert.equal((await call('GET', '/reconciliations', token)).status, 404);

      const unsafe = await call('PUT', '/internal/company', await service(), { version: 4, name: 'Acme', colour: 'red', logoUrl: '//evil.example/x.png', modules: {} });
      assert.equal(unsafe.body.applied, true);
      const cfg2 = await call('GET', '/config');
      assert.equal(cfg2.body.brand.colour, null);
      assert.equal(cfg2.body.brand.logoUrl, null);
      assert.equal((await call('GET', '/reconciliations', token)).status, 200, 'switched back on');
    } finally {
      await clear();
      await dbs.root.delete(sessions).where(eq(sessions.userId, admin.id));
      await dbs.root.delete(users).where(eq(users.id, admin.id));
    }
  });
});

describe('people directory (Phase 5)', () => {
  test('departments, manager, designation, join date and deactivation arrive from the Platform', async () => {
    assert.equal((await call('PUT', '/internal/people', undefined, { version: 1, departments: [], people: [] })).status, 401);
    const boss = await provision({ email: 'pf-boss@t.test', fullName: 'PF Boss' });
    const worker = await provision({ email: 'pf-worker@t.test', fullName: 'PF Worker' });
    assert.equal(boss.status, 200, JSON.stringify(boss.body));
    const [b] = await dbs.root.select().from(users).where(eq(users.id, boss.body.userId));
    const [w] = await dbs.root.select().from(users).where(eq(users.id, worker.body.userId));
    const version = Math.floor(Date.now() / 1000);
    const res = await call('PUT', '/internal/people', await service(), {
      version,
      departments: [{ code: 'pf-field', name: 'PF Field Team' }],
      people: [
        { personId: w.platformPersonId, status: 'active', departmentCode: 'pf-field', designation: 'Technician', reportsTo: b.platformPersonId, joinDate: '2026-05-01' },
        { personId: b.platformPersonId, status: 'active', departmentCode: 'pf-field', designation: 'Lead', reportsTo: null },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.applied, true);
    const [dept] = await dbs.root.select().from(departments).where(eq(departments.code, 'pf-field'));
    assert.equal(dept.name, 'PF Field Team');
    const [we] = await dbs.root.select().from(employees).where(eq(employees.id, w.employeeId!));
    assert.equal(we.departmentId, dept.id);
    assert.equal(we.managerId, b.employeeId);
    assert.equal(we.designation, 'Technician');
    assert.equal(we.joinDate, '2026-05-01');

    const exported = await call('GET', '/internal/people', await service());
    const row = exported.body.people.find((p: { personId: string }) => p.personId === w.platformPersonId);
    assert.deepEqual(row, { personId: w.platformPersonId, departmentCode: 'pf-field', designation: 'Technician', reportsTo: b.platformPersonId, joinDate: '2026-05-01' });

    // Deactivated in the Platform: the login stops at once.
    const token = await access(w.platformPersonId!, w.id);
    assert.equal((await call('GET', '/auth/me', token)).status, 200);
    await call('PUT', '/internal/people', await service(), { version: version + 1, departments: [], people: [{ personId: w.platformPersonId, status: 'inactive' }] });
    assert.equal((await call('GET', '/auth/me', token)).status, 401);
    const stale = await call('PUT', '/internal/people', await service(), { version, departments: [], people: [] });
    assert.deepEqual(stale.body, { version: version + 1, applied: false });
  });
});

describe('asset requests: the manager decides (Phase 5)', () => {
  test('a manager without the approver permission sees and decides their team’s requests only', async () => {
    const mk = async (email: string, fullName: string) => {
      const res = await provision({ email, fullName, appRole: 'Employee' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [u] = await dbs.root.select().from(users).where(eq(users.id, res.body.userId));
      return { user: u, token: await access(u.platformPersonId!, u.id) };
    };
    const boss = await mk('rq-boss@t.test', 'RQ Boss');
    const worker = await mk('rq-worker@t.test', 'RQ Worker');
    const outsider = await mk('rq-out@t.test', 'RQ Outsider');
    await dbs.root.update(employees).set({ managerId: boss.user.employeeId }).where(eq(employees.id, worker.user.employeeId!));

    const created = await call('POST', '/requests', worker.token, { itemName: 'Headset', quantity: 1, reason: 'Calls' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;

    const bossList = await call('GET', '/requests', boss.token);
    const row = bossList.body.items.find((r: { id: string }) => r.id === id);
    assert.ok(row, 'the manager sees it');
    assert.equal(row.canDecide, true);
    assert.equal((await call('GET', '/requests', outsider.token)).body.items.some((r: { id: string }) => r.id === id), false);
    // One request by id: the same rule (the requester, their manager, approvers) — anyone else gets 404.
    assert.equal((await call('GET', `/requests/${id}`, boss.token)).body.id, id);
    assert.equal((await call('GET', `/requests/${id}`, worker.token)).status, 200);
    assert.equal((await call('GET', `/requests/${id}`, outsider.token)).status, 404);
    const workerRow = (await call('GET', '/requests', worker.token)).body.items.find((r: { id: string }) => r.id === id);
    assert.equal(workerRow.canDecide, false, 'not for their own request');

    assert.equal((await call('POST', `/requests/${id}/decision`, outsider.token, { decision: 'APPROVE' })).status, 403);
    assert.equal((await call('POST', `/requests/${id}/decision`, worker.token, { decision: 'APPROVE' })).status, 403);
    const decided = await call('POST', `/requests/${id}/decision`, boss.token, { decision: 'APPROVE', note: 'OK' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.status, 'APPROVED');
  });
});

describe('cross-app flows (Phase 5)', () => {
  const person = async (email: string, fullName: string, appRole: string) => {
    const res = await provision({ email, fullName, appRole });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [u] = await dbs.root.select().from(users).where(eq(users.id, res.body.userId));
    return { user: u, token: await access(u.platformPersonId!, u.id) };
  };

  test('a new ticket is announced with its owners; the Platform links a task and resolves it', async () => {
    assert.equal((await call('GET', '/internal/events')).status, 401);
    const before = (await call('GET', '/internal/events', await service())).body as Array<{ id: number }>;
    const after = before.length ? before[before.length - 1].id : 0;
    const it = await person('fl-it@t.test', 'FL IT', 'Admin');
    const mia = await person('fl-mia@t.test', 'FL Mia', 'Employee');
    const t = await call('POST', '/tickets', mia.token, { title: 'Laptop will not start', type: 'ISSUE', priority: 'HIGH' });
    assert.equal(t.status, 201, JSON.stringify(t.body));

    const evts = (await call('GET', `/internal/events?after=${after}`, await service())).body as Array<{ type: string; payload: any }>;
    const e = evts.find((x) => x.type === 'ticket.created' && x.payload.ticketId === t.body.id)!;
    assert.ok(e, 'ticket.created is in the outbox');
    assert.equal(e.payload.title, 'Laptop will not start');
    assert.ok(e.payload.ownerPersonIds.includes(it.user.platformPersonId), 'people who manage tickets are listed');
    assert.ok(!e.payload.ownerPersonIds.includes(mia.user.platformPersonId));

    const linked = await call('PUT', `/internal/tickets/${t.body.id}/link`, await service(), { assigneePersonId: it.user.platformPersonId, ref: 'T-00042', url: '/tasks/tasks/42' });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    const [row] = await dbs.root.select().from(tickets).where(eq(tickets.id, t.body.id));
    assert.deepEqual(row.linkedTask, { ref: 'T-00042', url: '/tasks/tasks/42' });
    assert.equal(row.assigneeId, it.user.id);

    const resolved = await call('POST', `/internal/tickets/${t.body.id}/resolve`, await service(), { resolution: 'Replaced the battery' });
    assert.equal(resolved.status, 200);
    const [done] = await dbs.root.select().from(tickets).where(eq(tickets.id, t.body.id));
    assert.equal(done.status, 'RESOLVED');
    assert.equal(done.resolution, 'Replaced the battery');
    assert.equal((await call('POST', `/internal/tickets/${t.body.id}/resolve`, await service(), {})).body.already, true);
  });

  test('starting an exit puts the employee on notice with an exit case', async () => {
    const leaver = await person('fl-leaver@t.test', 'FL Leaver', 'Employee');
    const res = await call('POST', '/internal/exits', await service(), { personId: leaver.user.platformPersonId, lastWorkingDate: '2026-12-31', reason: 'Moving' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.caseNumber, /\w+/);
    const [emp] = await dbs.root.select().from(employees).where(eq(employees.id, leaver.user.employeeId!));
    assert.equal(emp.status, 'NOTICE_PERIOD');
    assert.equal(emp.lastWorkingDate, '2026-12-31');
    assert.equal((await call('POST', '/internal/exits', await service(), { personId: randomUUID(), lastWorkingDate: '2026-12-31' })).status, 404);
  });

  test('a new joiner gets an onboarding case with the kit named like their role, once', async () => {
    await dbs.root.insert(onboardingKits).values({ name: 'FL Store Keeper', items: [{ itemName: 'Barcode scanner', quantity: 1 }] as never });
    const joiner = await person('fl-joiner@t.test', 'FL Joiner', 'Employee');
    const body = { personId: joiner.user.platformPersonId, joinDate: '2026-12-01', roleNames: ['fl store keeper'] };
    const res = await call('POST', '/internal/onboarding', await service(), body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.created, true);
    assert.equal(res.body.kit, true);
    const items = await dbs.root.select().from(onboardingItems).where(eq(onboardingItems.caseId, res.body.onboardingId));
    assert.deepEqual(items.map((i) => i.itemName), ['Barcode scanner']);
    const again = await call('POST', '/internal/onboarding', await service(), body);
    assert.equal(again.body.created, false);
    assert.equal(again.body.onboardingId, res.body.onboardingId);
  });
});

describe('provision after the role builder synced (Phase 5 fix)', () => {
  test('the built-in Employee role still works once it carries its role-builder name', async () => {
    await dbs.root.update(roles).set({ name: 'Employee (Assets)' }).where(eq(roles.name, 'Employee'));
    try {
      const res = await provision({ email: 'rb-new@t.test', fullName: 'RB New' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [u] = await dbs.root.select({ roleName: roles.name }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, res.body.userId));
      assert.equal(u.roleName, 'Employee (Assets)');
    } finally {
      await dbs.root.update(roles).set({ name: 'Employee' }).where(eq(roles.name, 'Employee (Assets)'));
    }
  });
});

describe('delete a person completely', () => {
  test('the person and everything about them go; what they hold goes back to stock', async () => {
    const mk = async (email: string, fullName: string) => {
      const res = await provision({ email, fullName, appRole: 'Employee' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [u] = await dbs.root.select().from(users).where(eq(users.id, res.body.userId));
      return { user: u, token: await access(u.platformPersonId!, u.id) };
    };
    const leaver = await mk('del-leaver@t.test', 'Del Leaver');
    const other = await mk('del-other@t.test', 'Del Other');
    const E = leaver.user.employeeId!;
    assert.ok(E, 'the leaver has an employee record');
    await dbs.root.update(employees).set({ managerId: E }).where(eq(employees.id, other.user.employeeId!));

    // A laptop they hold.
    const suffix = randomUUID().slice(0, 8);
    const [cat] = await dbs.root.insert(assetCategories).values({ name: `Del cat ${suffix}`, code: `DC${suffix}` }).returning();
    const [type] = await dbs.root.insert(assetTypes).values({ categoryId: cat.id, name: 'Laptop', code: `DT${suffix}` }).returning();
    const [laptop] = await dbs.root
      .insert(assets)
      .values({ assetTag: `DEL-${suffix}`, qrCode: `q-${suffix}`, name: 'Del laptop', categoryId: cat.id, assetTypeId: type.id, status: 'ASSIGNED', holderType: 'EMPLOYEE', holderId: E, holderName: 'Del Leaver', assignedAt: new Date() })
      .returning();
    await dbs.root.insert(allocations).values({ assetId: laptop.id, holderType: 'EMPLOYEE', employeeId: E, holderName: 'Del Leaver', assignedBy: other.user.id });
    await dbs.root.insert(historyEvents).values({ actorName: 'IT', entityType: 'ASSET', entityId: laptop.id, action: 'ASSIGNED', summary: 'Assigned to Del Leaver', assetId: laptop.id, employeeId: E });
    await dbs.root.insert(historyEvents).values({ actorId: leaver.user.id, actorName: 'Del Leaver', entityType: 'ASSET', entityId: laptop.id, action: 'EDITED', summary: 'Edited', assetId: laptop.id });

    // A request and a ticket of theirs; another person's ticket assigned to them.
    const request = await call('POST', '/requests', leaver.token, { itemName: 'Mouse', quantity: 1, reason: 'Broken' });
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const ticket = await call('POST', '/tickets', leaver.token, { title: 'Screen flickers', type: 'ISSUE', priority: 'LOW' });
    assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
    const otherTicket = await call('POST', '/tickets', other.token, { title: 'Keyboard sticky', type: 'ISSUE', priority: 'LOW' });
    await dbs.root.update(tickets).set({ assigneeId: leaver.user.id }).where(eq(tickets.id, otherTicket.body.id));

    const url = `/internal/people/${leaver.user.platformPersonId}`;
    assert.equal((await call('DELETE', url)).status, 401);
    assert.equal((await call('DELETE', url, leaver.token)).status, 401);
    assert.equal((await call('DELETE', '/internal/people/not-a-uuid', await service())).status, 400);

    const res = await call('DELETE', url, await service());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.counts.users, 1);
    assert.equal(res.body.counts.employees, 1);
    assert.equal(res.body.counts.allocations, 1);
    assert.equal(res.body.counts.asset_requests, 1);
    assert.equal(res.body.counts.tickets, 1);
    assert.equal(res.body.counts.assets_returned_to_stock, 1);

    assert.equal((await dbs.root.select().from(users).where(eq(users.id, leaver.user.id))).length, 0);
    assert.equal((await dbs.root.select().from(employees).where(eq(employees.id, E))).length, 0);
    assert.equal((await dbs.root.select().from(allocations).where(eq(allocations.assetId, laptop.id))).length, 0);
    assert.equal((await dbs.root.select().from(assetRequests).where(eq(assetRequests.id, request.body.id))).length, 0);
    assert.equal((await dbs.root.select().from(tickets).where(eq(tickets.id, ticket.body.id))).length, 0);
    assert.equal((await dbs.root.select().from(ffEvents).where(sql`${ffEvents.payload}->>'ticketId' = ${ticket.body.id}`)).length, 0);
    const [back] = await dbs.root.select().from(assets).where(eq(assets.id, laptop.id));
    assert.equal(back.status, 'AVAILABLE');
    assert.equal(back.holderId, null);
    assert.equal(back.holderName, null);
    const history = await dbs.root.select().from(historyEvents).where(eq(historyEvents.assetId, laptop.id));
    assert.deepEqual(history.map((h) => [h.action, h.actorId, h.actorName]), [['EDITED', null, 'Deleted user']]);

    // Other people's rows stay, without the pointer to them.
    const [kept] = await dbs.root.select().from(tickets).where(eq(tickets.id, otherTicket.body.id));
    assert.equal(kept.assigneeId, null);
    const [otherEmp] = await dbs.root.select().from(employees).where(eq(employees.id, other.user.employeeId!));
    assert.equal(otherEmp.managerId, null);
    assert.equal((await call('GET', '/auth/me', other.token)).status, 200);

    // The history table is append-only again afterwards.
    await assert.rejects(dbs.root.delete(historyEvents).where(eq(historyEvents.assetId, laptop.id)));

    // Idempotent: the Platform may retry.
    const again = await call('DELETE', url, await service());
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { deleted: false });
  });
});

describe('delete a person: the founder chooses', () => {
  const mk = async (email: string, fullName: string) => {
    const res = await provision({ email, fullName, appRole: 'Employee' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [u] = await dbs.root.select().from(users).where(eq(users.id, res.body.userId));
    return { user: u, token: await access(u.platformPersonId!, u.id) };
  };
  const laptopFor = async (employeeId: string, holderName: string) => {
    const suffix = randomUUID().slice(0, 8);
    const [cat] = await dbs.root.insert(assetCategories).values({ name: `Ch cat ${suffix}`, code: `CC${suffix}` }).returning();
    const [type] = await dbs.root.insert(assetTypes).values({ categoryId: cat.id, name: 'Laptop', code: `CT${suffix}` }).returning();
    const [laptop] = await dbs.root
      .insert(assets)
      .values({ assetTag: `CH-${suffix}`, qrCode: `cq-${suffix}`, name: 'Choice laptop', categoryId: cat.id, assetTypeId: type.id, status: 'ASSIGNED', holderType: 'EMPLOYEE', holderId: employeeId, holderName, assignedAt: new Date() })
      .returning();
    await dbs.root.insert(allocations).values({ assetId: laptop.id, holderType: 'EMPLOYEE', employeeId, holderName });
    return laptop;
  };

  test('assets handed over: the receiver holds them, with an allocation and a history event', async () => {
    const leaver = await mk('ch-leaver@t.test', 'Ch Leaver');
    const receiver = await mk('ch-receiver@t.test', 'Ch Receiver');
    const laptop = await laptopFor(leaver.user.employeeId!, 'Ch Leaver');
    const res = await call('DELETE', `/internal/people/${leaver.user.platformPersonId}`, await service(), {
      assets: { mode: 'hand_over', to: receiver.user.platformPersonId },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.anonymised, false);
    assert.deepEqual(res.body.handed_over, { tasks: 0, leads: 0, assets: 1 });
    const [now] = await dbs.root.select().from(assets).where(eq(assets.id, laptop.id));
    assert.equal(now.status, 'ASSIGNED');
    assert.equal(now.holderId, receiver.user.employeeId);
    assert.equal(now.holderName, 'Ch Receiver');
    const allocs = await dbs.root.select().from(allocations).where(eq(allocations.assetId, laptop.id));
    assert.deepEqual(allocs.map((a) => [a.employeeId, a.status]), [[receiver.user.employeeId, 'ACTIVE']], 'the leaver’s custody history is deleted');
    const history = await dbs.root.select().from(historyEvents).where(eq(historyEvents.assetId, laptop.id));
    assert.equal(history.length, 1);
    assert.equal(history[0].employeeId, receiver.user.employeeId);
    assert.match(history[0].summary, /Handed over from Ch Leaver \(deleted\)/);
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, leaver.user.id))).length, 0);
    assert.equal((await dbs.root.select().from(employees).where(eq(employees.id, leaver.user.employeeId!))).length, 0);
  });

  test('history kept: the employee record stays anonymised, the login goes', async () => {
    const leaver = await mk('ch-keep@t.test', 'Ch Keeper');
    const E = leaver.user.employeeId!;
    const laptop = await laptopFor(E, 'Ch Keeper');
    const request = await call('POST', '/requests', leaver.token, { itemName: 'Mouse', quantity: 1, reason: 'Broken' });
    const ticket = await call('POST', '/tickets', leaver.token, { title: 'Fan noise', type: 'ISSUE', priority: 'LOW' });
    assert.equal(ticket.status, 201, JSON.stringify(ticket.body));

    const res = await call('DELETE', `/internal/people/${leaver.user.platformPersonId}`, await service(), { history: { mode: 'keep' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.anonymised, true);
    assert.deepEqual(res.body.handed_over, { tasks: 0, leads: 0, assets: 0 });

    assert.equal((await dbs.root.select().from(users).where(eq(users.id, leaver.user.id))).length, 0, 'the login is gone');
    const [emp] = await dbs.root.select().from(employees).where(eq(employees.id, E));
    assert.equal(emp.fullName, 'Deleted user');
    assert.equal(emp.email, null);
    assert.equal(emp.status, 'EXITED');
    assert.match(emp.employeeCode, /^DELETED-/);
    const [back] = await dbs.root.select().from(assets).where(eq(assets.id, laptop.id));
    assert.equal(back.status, 'AVAILABLE');
    assert.equal(back.holderId, null);
    const [alloc] = await dbs.root.select().from(allocations).where(eq(allocations.assetId, laptop.id));
    assert.equal(alloc.status, 'RETURNED');
    assert.equal(alloc.holderName, 'Deleted user');
    const [req] = await dbs.root.select().from(assetRequests).where(eq(assetRequests.id, request.body.id));
    assert.equal(req.status, 'CANCELLED');
    const [t] = await dbs.root.select().from(tickets).where(eq(tickets.id, ticket.body.id));
    assert.equal(t.reportedBy, null);
    assert.equal(t.reportedByName, 'Deleted user');
    assert.equal(t.reporterEmployeeId, E);

    assert.equal((await call('GET', '/auth/me', leaver.token)).status, 401);
    assert.deepEqual((await call('DELETE', `/internal/people/${leaver.user.platformPersonId}`, await service(), { history: { mode: 'keep' } })).body, { deleted: false });
  });

  test('a bad hand-over target is refused before anything changes', async () => {
    const leaver = await mk('ch-bad@t.test', 'Ch Bad');
    const inactive = await mk('ch-inactive@t.test', 'Ch Inactive');
    await dbs.root.update(users).set({ isActive: false }).where(eq(users.id, inactive.user.id));
    const laptop = await laptopFor(leaver.user.employeeId!, 'Ch Bad');
    const url = `/internal/people/${leaver.user.platformPersonId}`;
    const cases: Record<string, unknown> = {
      'unknown person': { assets: { mode: 'hand_over', to: randomUUID() } },
      themselves: { assets: { mode: 'hand_over', to: leaver.user.platformPersonId } },
      inactive: { assets: { mode: 'hand_over', to: inactive.user.platformPersonId } },
      'not a uuid': { assets: { mode: 'hand_over', to: 'bob' } },
      'bad mode': { history: { mode: 'shred' } },
    };
    for (const [name, body] of Object.entries(cases)) {
      const res = await call('DELETE', url, await service(), body);
      assert.equal(res.status, 400, name);
      assert.equal(typeof res.body.message, 'string', name);
    }
    assert.equal((await dbs.root.select().from(users).where(eq(users.id, leaver.user.id))).length, 1);
    const [still] = await dbs.root.select().from(assets).where(eq(assets.id, laptop.id));
    assert.equal(still.holderId, leaver.user.employeeId);
    // Tasks-only keys are ignored; an empty body deletes everything as before.
    const res = await call('DELETE', url, await service(), { tasks: { mode: 'hand_over', to: randomUUID() } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.anonymised, false);
    assert.equal((await dbs.root.select().from(employees).where(eq(employees.id, leaver.user.employeeId!))).length, 0);
  });
});
