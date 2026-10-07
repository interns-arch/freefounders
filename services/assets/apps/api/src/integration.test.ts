// API integration tests. Run with `npm test` (uses a throwaway `eam_test` database).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Permission, SYSTEM_ROLES } from '@eam/shared';
import { DbService } from './db/db.service';
import { roles, users } from './db/schema';
import { createApp } from './main';
import { hashPassword } from './modules/auth/auth.service';

const PASSWORD = 'Test@12345';
let app: INestApplication;
let base = '';
let dbs: DbService;
const cookies: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown, who: string | null = 'admin') {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(who && cookies[who] ? { cookie: cookies[who] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(who: string, email: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ login: email, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  cookies[who] = res.headers.get('set-cookie')!.split(';')[0];
}

async function upload(path: string, fields: Record<string, string>, files: Buffer[], who = 'admin') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append('photos', new Blob([new Uint8Array(f)], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(base + path, { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest', cookie: cookies[who] }, body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let ids: Record<string, string> = {};

before(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  dbs = app.get(DbService);

  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const [row] = await dbs.root.insert(roles).values({ name: r.name, description: r.description, permissions: r.permissions as Permission[], isSystem: true }).returning();
    roleIds[r.name] = row.id;
  }
  const passwordHash = await hashPassword(PASSWORD);
  await dbs.root.insert(users).values({ email: 'admin@t.test', name: 'Test Admin', passwordHash, roleId: roleIds.Admin });
  await dbs.root.insert(users).values({ email: 'it@t.test', name: 'Test IT', passwordHash, roleId: roleIds['IT / Asset Manager'] });
  await login('admin', 'admin@t.test');
  await login('it', 'it@t.test');

  // Master data used by the tests.
  const loc = await call('POST', '/locations', { name: 'Test Store', type: 'WAREHOUSE', isStore: true });
  const cat = await call('POST', '/categories', { name: 'Drones', code: 'DRN' });
  assert.equal(cat.status, 201);
  const type = await call('POST', '/asset-types', { categoryId: cat.body.id, name: 'Quadcopter', code: 'QDC', trackingMode: 'INDIVIDUAL' });
  assert.equal(type.status, 201);
  await call('POST', '/fields', { assetTypeId: type.body.id, label: 'Flight Time (min)', type: 'number', required: true, min: 1, max: 120 });
  await call('POST', '/fields', { assetTypeId: type.body.id, label: 'Aviation ID', type: 'text', isUnique: true });
  await call('POST', '/fields', { assetTypeId: type.body.id, label: 'Camera', type: 'select', options: ['4K', '6K'] });
  const alice = await call('POST', '/employees', { employeeCode: 'T001', firstName: 'Alice', lastName: 'Rao', email: 'alice@t.test' });
  const bob = await call('POST', '/employees', { employeeCode: 'T002', firstName: 'Bob', lastName: 'Iyer' });
  assert.equal(alice.status, 201);

  // An employee-role login linked to Bob.
  await dbs.root.insert(users).values({ email: 'bob@t.test', name: 'Bob Iyer', passwordHash, roleId: roleIds.Employee, employeeId: bob.body.id });
  await login('bob', 'bob@t.test');
  ids = { store: loc.body.id, category: cat.body.id, type: type.body.id, alice: alice.body.id, bob: bob.body.id };
});

after(async () => {
  await app?.close();
});

const newDrone = (extra: Record<string, unknown> = {}) =>
  call('POST', '/assets', { assetTypeId: ids.type, name: 'DJI Mavic 3', status: 'AVAILABLE', attributes: { flight_time_min: 40 }, ...extra });

describe('security', () => {
  test('requests without a session are rejected', async () => {
    const r = await call('GET', '/assets', undefined, null);
    assert.equal(r.status, 401);
  });

  test('mutations without the CSRF header are rejected', async () => {
    const res = await fetch(`${base}/assets`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.admin }, body: '{}' });
    assert.equal(res.status, 403);
  });

  test('employees only see their own assets and cannot list people', async () => {
    const mine = await newDrone({ attributes: { flight_time_min: 30, aviation_id: 'BOB-1' } });
    const other = await newDrone({ attributes: { flight_time_min: 30, aviation_id: 'OTHER-1' } });
    assert.equal((await call('POST', `/assets/${mine.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.bob })).status, 200);

    const list = await call('GET', '/assets', undefined, 'bob');
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.items.map((a: { id: string }) => a.id),
      [mine.body.id],
    );
    assert.equal((await call('GET', `/assets/${mine.body.id}`, undefined, 'bob')).status, 200);
    assert.equal((await call('GET', `/assets/${mine.body.id}/history`, undefined, 'bob')).status, 200);
    assert.equal((await call('GET', `/assets/${other.body.id}`, undefined, 'bob')).status, 404);
    assert.equal((await call('GET', '/employees', undefined, 'bob')).status, 403);
    assert.equal((await call('POST', '/categories', { name: 'Nope', code: 'NOPE' }, 'bob')).status, 403);
  });
});

describe('one QR per person and view-only logins', () => {
  test('a person QR holds their employee ID and resolves to the person', async () => {
    for (const code of ['T001', 't001', 'https://assets.example.com/id/T001']) {
      const r = await call('GET', `/employees/lookup?code=${encodeURIComponent(code)}`);
      assert.equal(r.status, 200, code);
      assert.equal(r.body.id, ids.alice);
    }
    // Employee IDs are unique regardless of case, so a QR can never match two people.
    assert.equal((await call('POST', '/employees', { employeeCode: 't001', firstName: 'Dup' })).status, 409);
    // An employee can resolve their own QR but not someone else's.
    assert.equal((await call('GET', '/employees/lookup?code=T002', undefined, 'bob')).status, 200);
    assert.equal((await call('GET', '/employees/lookup?code=T001', undefined, 'bob')).status, 404);
  });

  test('IT gives an employee a login; they sign in with their employee ID and can only view', async () => {
    const emp = await call('POST', '/employees', { employeeCode: 'ct000099', firstName: 'Test', lastName: 'Holder', email: 'NA', phone: 'NA', personalPhone: '9971194578' });
    assert.equal(emp.status, 201);
    assert.equal(emp.body.employeeCode, 'CT000099');
    assert.equal(emp.body.email, null, '"NA" is stored as empty');
    const laptop = await newDrone({ name: 'Assigned to Test Holder' });
    await call('POST', `/assets/${laptop.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: emp.body.id }, 'it');

    // IT has full access, including giving logins.
    const grant = await call('POST', `/employees/${emp.body.id}/access`, {}, 'it');
    assert.equal(grant.status, 200);
    assert.equal(grant.body.loginId, 'CT000099');
    assert.equal(grant.body.email, null);
    assert.ok(grant.body.password.length >= 8);

    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ login: 'ct000099', password: grant.body.password }),
    });
    assert.equal(res.status, 200);
    cookies.anurag = res.headers.get('set-cookie')!.split(';')[0];
    const me = await call('GET', '/auth/me', undefined, 'anurag');
    assert.equal(me.body.role.name, 'Employee');

    const mine = await call('GET', '/assets', undefined, 'anurag');
    assert.deepEqual(mine.body.items.map((x: { id: string }) => x.id), [laptop.body.id]);
    // View only: no changes to assets, people or logins.
    assert.equal((await call('PATCH', `/assets/${laptop.body.id}`, { name: 'Mine now', version: laptop.body.version }, 'anurag')).status, 403);
    assert.equal((await call('POST', `/assets/${laptop.body.id}/return`, { condition: 'GOOD' }, 'anurag')).status, 403);
    assert.equal((await call('POST', `/employees/${emp.body.id}/verify-assets`, {}, 'anurag')).status, 403);
    assert.equal((await call('POST', `/employees/${emp.body.id}/access`, {}, 'anurag')).status, 403);

    // Resetting issues a new password and signs the old sessions out.
    const reset = await call('POST', `/employees/${emp.body.id}/access`, {}, 'it');
    assert.equal(reset.body.created, false);
    assert.equal((await call('GET', '/auth/me', undefined, 'anurag')).status, 401);
  });

  test('an employee can request something that is not in the catalog', async () => {
    const r = await call('POST', '/requests', { itemName: 'Ergonomic footrest', reason: 'Back pain' }, 'bob');
    assert.equal(r.status, 201);
    assert.equal(r.body.assetTypeId, null);
    assert.equal((await call('POST', '/requests', { reason: 'Nothing chosen' }, 'bob')).status, 400);
    const mine = await call('GET', '/requests', undefined, 'bob');
    const row = mine.body.items.find((x: { id: string }) => x.id === r.body.id);
    assert.equal(row.typeName, 'Ergonomic footrest');
    assert.equal(row.custom, true);
    // IT approves and fulfils it with any asset.
    assert.equal((await call('POST', `/requests/${r.body.id}/decision`, { decision: 'APPROVE' }, 'it')).status, 200);
    const drone = await newDrone({ name: 'Footrest stand-in' });
    assert.equal((await call('POST', `/requests/${r.body.id}/fulfil`, { assetId: drone.body.id }, 'it')).status, 200);
  });

  test('IT records that a person still has their assets', async () => {
    const r = await call('POST', `/employees/${ids.bob}/verify-assets`, { note: 'Checked at desk' }, 'it');
    assert.equal(r.status, 200);
    assert.ok(r.body.assetsVerifiedAt);
    const history = await call('GET', `/employees/${ids.bob}/history`);
    assert.equal(history.body.items[0].action, 'ASSETS_VERIFIED');
  });
});

describe('dynamic asset types and custom fields', () => {
  test('required, range and option rules are enforced by the API', async () => {
    const missing = await call('POST', '/assets', { assetTypeId: ids.type, name: 'No specs', attributes: {} });
    assert.equal(missing.status, 400);
    assert.match(missing.body.errors['attributes.flight_time_min'], /required/);

    const outOfRange = await newDrone({ attributes: { flight_time_min: 500 } });
    assert.equal(outOfRange.status, 400);
    assert.match(outOfRange.body.errors['attributes.flight_time_min'], /at most 120/);

    const badOption = await newDrone({ attributes: { flight_time_min: 20, camera: '8K' } });
    assert.equal(badOption.status, 400);
  });

  test('assets get a tag from the type prefix and clean attribute values', async () => {
    const r = await newDrone({ attributes: { flight_time_min: '45', camera: '4K', aviation_id: 'AV-100' } });
    assert.equal(r.status, 201);
    assert.match(r.body.assetTag, /^QDC-\d{6}$/);
    assert.deepEqual(r.body.attributes, { flight_time_min: 45, camera: '4K', aviation_id: 'AV-100' });
  });

  test('unique custom fields reject duplicates', async () => {
    const dup = await newDrone({ attributes: { flight_time_min: 30, aviation_id: 'AV-100' } });
    assert.equal(dup.status, 400);
    assert.match(dup.body.message, /already used by QDC-/);
  });

  test('catalog and role listings report correct counts', async () => {
    const cats = await call('GET', '/categories');
    const drones = cats.body.find((c: { id: string }) => c.id === ids.category);
    assert.equal(drones.typeCount, 1);
    assert.ok(drones.assetCount >= 1);
    const types = await call('GET', `/asset-types?categoryId=${ids.category}`);
    assert.equal(types.body[0].fieldCount, 3);
    const roleList = await call('GET', '/roles');
    assert.equal(roleList.body.find((r: { name: string }) => r.name === 'Admin').userCount, 1);
    const stores = await call('GET', '/locations');
    assert.equal(typeof stores.body.items[0].assetCount, 'number');
  });

  test('custom fields can be filtered on', async () => {
    const r = await call('GET', `/assets?assetTypeId=${ids.type}&f.camera=4K`);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length >= 1);
    assert.ok(r.body.items.every((a: { attributes: { camera?: string } }) => a.attributes.camera === '4K'));
    const range = await call('GET', `/assets?assetTypeId=${ids.type}&f.flight_time_min.min=44`);
    assert.ok(range.body.items.every((a: { attributes: { flight_time_min: number } }) => a.attributes.flight_time_min >= 44));
  });
});

describe('custody and lifecycle', () => {
  test('an asset cannot be assigned twice, even by concurrent requests', async () => {
    const drone = await newDrone();
    const [a, b] = await Promise.all([
      call('POST', `/assets/${drone.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice }),
      call('POST', `/assets/${drone.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.bob }, 'it'),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const active = await dbs.root.execute<{ n: number }>(sql`select count(*)::int as n from allocations where asset_id = ${drone.body.id} and status = 'ACTIVE'`);
    assert.equal(active.rows[0].n, 1);
  });

  test('assign → transfer → return follows the lifecycle and keeps history', async () => {
    const drone = await newDrone();
    const id = drone.body.id;
    assert.equal((await call('POST', `/assets/${id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice })).status, 200);
    assert.equal((await call('POST', `/assets/${id}/transfer`, { holderType: 'EMPLOYEE', holderId: ids.bob })).status, 200);
    assert.equal((await call('POST', `/assets/${id}/return`, { condition: 'GOOD', makeAvailable: true })).status, 200);
    const detail = await call('GET', `/assets/${id}`);
    assert.equal(detail.body.status, 'AVAILABLE');
    const allocations = await call('GET', `/assets/${id}/allocations`);
    assert.deepEqual(
      allocations.body.map((a: { status: string }) => a.status),
      ['RETURNED', 'TRANSFERRED'],
    );
    const history = await call('GET', `/assets/${id}/history`);
    const actions = history.body.items.map((e: { action: string }) => e.action);
    for (const a of ['CREATED', 'ASSIGNED', 'TRANSFERRED', 'RETURNED']) assert.ok(actions.includes(a), `history has ${a}`);
  });

  test('handover and return photos are kept with the assignment and shown only to those who can see the asset', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const drone = await newDrone();
    const id = drone.body.id;
    const assigned = await call('POST', `/assets/${id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.bob });

    assert.equal((await upload(`/assets/${id}/photos`, { allocationId: assigned.body.id, kind: 'HANDOVER' }, [Buffer.from('not an image')])).status, 400);
    assert.equal((await upload(`/assets/${id}/photos`, { allocationId: assigned.body.id, kind: 'HANDOVER' }, [jpeg], 'bob')).status, 403);
    const saved = await upload(`/assets/${id}/photos`, { allocationId: assigned.body.id, kind: 'HANDOVER' }, [jpeg, jpeg]);
    assert.equal(saved.status, 201);
    assert.equal(saved.body.length, 2);

    // The holder can see the handover photos of their own asset.
    const res = await fetch(`${base}/assets/${id}/photos/${saved.body[0].id}`, { headers: { cookie: cookies.bob } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(jpeg));

    const returned = await call('POST', `/assets/${id}/return`, { condition: 'GOOD', makeAvailable: true });
    assert.equal(returned.body.allocationId, assigned.body.id);
    assert.equal((await upload(`/assets/${id}/photos`, { allocationId: assigned.body.id, kind: 'RETURN' }, [jpeg])).status, 201);
    const allocations = await call('GET', `/assets/${id}/allocations`);
    assert.deepEqual(
      allocations.body[0].photos.map((p: { kind: string }) => p.kind),
      ['HANDOVER', 'HANDOVER', 'RETURN'],
    );

    // Once the asset belongs to someone else, Bob can no longer open its photos.
    await call('POST', `/assets/${id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice });
    const denied = await fetch(`${base}/assets/${id}/photos/${saved.body[0].id}`, { headers: { cookie: cookies.bob } });
    assert.ok(denied.status === 403 || denied.status === 404);
  });

  test('photos taken when an asset is added need no assignment and show on the asset', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const drone = await newDrone({ name: 'Photo drone' });
    const id = drone.body.id;
    assert.equal((await upload(`/assets/${id}/photos`, { kind: 'ASSET' }, [png], 'bob')).status, 403);
    assert.equal((await upload(`/assets/${id}/photos`, { kind: 'HANDOVER' }, [png])).status, 400);
    const saved = await upload(`/assets/${id}/photos`, { kind: 'ASSET' }, [png]);
    assert.equal(saved.status, 201);
    assert.equal(saved.body[0].allocationId, null);

    const detail = await call('GET', `/assets/${id}`);
    assert.deepEqual(detail.body.photos.map((p: { id: string }) => p.id), [saved.body[0].id]);
    const res = await fetch(`${base}/assets/${id}/photos/${saved.body[0].id}`, { headers: { cookie: cookies.admin } });
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));
  });

  test('one branch: "in store" needs no location', async () => {
    const drone = await newDrone({ name: 'Store drone' });
    const r = await call('POST', `/assets/${drone.body.id}/assign`, { holderType: 'INVENTORY' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const detail = await call('GET', `/assets/${drone.body.id}`);
    assert.equal(detail.body.status, 'IN_INVENTORY');
    assert.equal(detail.body.holderName, 'Test Store');
    // Anyone else still needs a person / department / vendor.
    assert.equal((await call('POST', `/assets/${drone.body.id}/transfer`, { holderType: 'EMPLOYEE' })).status, 400);
  });

  test('a joining kit is given for good: stock goes down, nothing to return or recover', async () => {
    assert.equal((await call('POST', '/asset-types', { categoryId: ids.category, name: 'Bad kit', code: 'BKT', trackingMode: 'INDIVIDUAL', consumable: true })).status, 400);
    const type = await call('POST', '/asset-types', { categoryId: ids.category, name: 'Joining Kit', code: 'TJK', trackingMode: 'QUANTITY', consumable: true });
    assert.equal(type.status, 201);
    const stock = await call('POST', '/assets', { assetTypeId: type.body.id, name: 'Joining Kit', status: 'AVAILABLE', quantity: 5, attributes: {} });
    const joiner = await call('POST', '/employees', { employeeCode: 'T600', firstName: 'Kit', lastName: 'Getter' });

    const given = await call('POST', `/assets/${stock.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: joiner.body.id, quantity: 1 });
    assert.equal(given.status, 200);
    assert.equal(given.body.status, 'CONSUMED');
    const after = await call('GET', `/assets/${stock.body.id}`);
    assert.equal(after.body.availableQuantity, 4);
    assert.equal(after.body.status, 'AVAILABLE');
    assert.equal(after.body.activeAllocations.length, 0);

    const person = await call('GET', `/employees/${joiner.body.id}`);
    assert.equal(person.body.assets.length, 0, 'not something they hold');
    assert.equal(person.body.given[0].name, 'Joining Kit');
    assert.equal((await call('POST', `/assets/${stock.body.id}/return`, { condition: 'GOOD' })).status, 400, 'nothing to return');

    // Leaving: the kit is not on the recovery checklist.
    const notice = await call('POST', `/employees/${joiner.body.id}/status`, { status: 'NOTICE_PERIOD', lastWorkingDate: '2030-06-30' });
    const exit = await call('GET', `/exit-cases/${notice.body.exitCaseId}`);
    assert.equal(exit.body.items.length, 0);
  });

  test('invalid lifecycle transitions are refused', async () => {
    const drone = await newDrone();
    const dispose = await call('POST', `/assets/${drone.body.id}/lifecycle`, { action: 'dispose' });
    assert.equal(dispose.status, 409);
    assert.equal((await call('POST', `/assets/${drone.body.id}/lifecycle`, { action: 'retire' })).status, 200);
    assert.equal((await call('POST', `/assets/${drone.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice })).status, 409);
  });

  test('stale edits are rejected (optimistic locking)', async () => {
    const drone = await newDrone();
    const v = drone.body.version;
    assert.equal((await call('PATCH', `/assets/${drone.body.id}`, { name: 'First edit', version: v })).status, 200);
    assert.equal((await call('PATCH', `/assets/${drone.body.id}`, { name: 'Stale edit', version: v })).status, 409);
  });
});

describe('employee exit', () => {
  test('notice period builds the checklist and completion is blocked until cleared', async () => {
    const emp = await call('POST', '/employees', { employeeCode: 'T100', firstName: 'Leaving', lastName: 'Person' });
    const e = emp.body.id;
    const laptop = await newDrone({ name: 'Drone A' });
    const helmet = await newDrone({ name: 'Drone B' });
    await call('POST', `/assets/${laptop.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: e });
    await call('POST', `/assets/${helmet.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: e });

    // Exited is only reachable through the exit case.
    assert.equal((await call('POST', `/employees/${e}/status`, { status: 'EXITED' })).status, 400);

    const notice = await call('POST', `/employees/${e}/status`, { status: 'NOTICE_PERIOD', lastWorkingDate: '2030-01-31' });
    assert.equal(notice.status, 200);
    const caseId = notice.body.exitCaseId;
    const exit = await call('GET', `/exit-cases/${caseId}`);
    assert.equal(exit.body.items.length, 2);
    assert.equal(exit.body.canComplete, false);

    assert.equal((await call('POST', `/exit-cases/${caseId}/complete`)).status, 409);

    // Return one via the checklist, one via the normal asset return — both clear their item.
    const first = exit.body.items.find((i: { assetId: string }) => i.assetId === laptop.body.id);
    assert.equal((await call('PATCH', `/exit-cases/${caseId}/items/${first.id}`, { status: 'RETURNED' })).status, 200);
    assert.equal((await call('POST', `/exit-cases/${caseId}/complete`)).status, 409);
    assert.equal((await call('POST', `/assets/${helmet.body.id}/return`, { condition: 'DAMAGED', makeAvailable: false })).status, 200);

    const after = await call('GET', `/exit-cases/${caseId}`);
    assert.deepEqual(after.body.items.map((i: { status: string }) => i.status).sort(), ['DAMAGED', 'RETURNED']);
    assert.equal((await call('POST', `/exit-cases/${caseId}/complete`)).status, 200);
    assert.equal((await call('GET', `/employees/${e}`)).body.status, 'EXITED');
  });

  test('override needs the permission and a reason, and writes off missing assets', async () => {
    const emp = await call('POST', '/employees', { employeeCode: 'T200', firstName: 'Override', lastName: 'Case' });
    const drone = await newDrone({ name: 'Never returned' });
    await call('POST', `/assets/${drone.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: emp.body.id });
    const notice = await call('POST', `/employees/${emp.body.id}/status`, { status: 'NOTICE_PERIOD', lastWorkingDate: '2030-02-28' });
    const caseId = notice.body.exitCaseId;

    // Only full-access users (IT / Admin) may override; a reason is required.
    assert.equal((await call('POST', `/exit-cases/${caseId}/override`, { reason: 'Because I said so, really' }, 'bob')).status, 403);
    assert.equal((await call('POST', `/exit-cases/${caseId}/override`, { reason: 'short' }, 'it')).status, 400);
    const ok = await call('POST', `/exit-cases/${caseId}/override`, { reason: 'Cost recovered from final settlement' }, 'it');
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', `/assets/${drone.body.id}`)).body.status, 'LOST');
    const exit = await call('GET', `/exit-cases/${caseId}`);
    assert.equal(exit.body.overridden, true);
    assert.equal(exit.body.items[0].status, 'MISSING');
  });
});

describe('priority queue', () => {
  test('open tickets and requests are listed most urgent first, and only for the support team', async () => {
    await call('POST', '/tickets', { title: 'Low one', type: 'ISSUE', priority: 'LOW' });
    await call('POST', '/tickets', { title: 'Server room AC down', type: 'ISSUE', priority: 'URGENT' });
    await call('POST', '/requests', { employeeId: ids.alice, assetTypeId: ids.type, quantity: 1, priority: 'HIGH', reason: 'Site survey next week' });
    await call('POST', '/requests', { employeeId: ids.alice, itemName: 'Ring light', quantity: 1, priority: 'HIGH', reason: 'Product shoots', neededBy: '2020-01-01' });

    const q = await call('GET', '/queue', undefined, 'it');
    assert.equal(q.status, 200);
    const ranks = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as Record<string, number>;
    const order = q.body.items.map((i: { priority: string }) => ranks[i.priority]);
    assert.deepEqual(order, [...order].sort((a: number, b: number) => a - b));
    assert.equal(q.body.items[0].title, 'Server room AC down');
    // Within the same priority, an overdue request comes first.
    const high = q.body.items.filter((i: { priority: string }) => i.priority === 'HIGH');
    assert.equal(high[0].title, 'Ring light');
    assert.equal(high[0].overdue, true);
    assert.ok(q.body.counts.URGENT >= 1 && q.body.counts.LOW >= 1);

    const urgentOnly = await call('GET', '/queue?priority=URGENT', undefined, 'it');
    assert.ok(urgentOnly.body.items.every((i: { priority: string }) => i.priority === 'URGENT'));
    assert.equal((await call('GET', '/queue', undefined, 'bob')).status, 403);
  });
});

describe('logins of your choice', () => {
  const signIn = async (login: string, password: string) =>
    (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify({ login, password }) })).status;

  test('IT sets the login ID, email and password; any of them signs in', async () => {
    const emp = await call('POST', '/employees', { employeeCode: 'T300', firstName: 'Chosen', lastName: 'Login', email: 'chosen@t.test' });
    const r = await call('POST', `/employees/${emp.body.id}/access`, { username: 'chosen.login', email: 'Chosen.Login@T.test', password: 'MyOwnPass#1' }, 'it');
    assert.equal(r.status, 200);
    assert.equal(r.body.loginId, 'chosen.login');
    assert.equal(r.body.password, 'MyOwnPass#1');
    for (const id of ['chosen.login', 'CHOSEN.LOGIN', 'T300', 'chosen.login@t.test', 'CHOSEN.LOGIN@T.TEST']) assert.equal(await signIn(id, 'MyOwnPass#1'), 200, id);
    assert.equal(await signIn('chosen.login', 'wrong-password'), 401);

    // Login IDs are unique and cannot be another person's employee ID.
    const other = await call('POST', '/employees', { employeeCode: 'T301', firstName: 'Other', lastName: 'Person' });
    const dup = await call('POST', `/employees/${other.body.id}/access`, { username: 'Chosen.Login', password: 'Another#123' }, 'it');
    assert.equal(dup.status, 400);
    assert.ok(dup.body.errors.username);
    const clash = await call('POST', `/employees/${other.body.id}/access`, { username: 'T300', password: 'Another#123' }, 'it');
    assert.equal(clash.status, 400);
    assert.equal((await call('POST', `/employees/${other.body.id}/access`, { username: 'x', password: 'short' }, 'it')).status, 400);
  });

  test('an employee can be added with a role and login in one step', async () => {
    const roleList = await call('GET', '/roles');
    const managerRole = roleList.body.find((x: { name: string }) => x.name === 'Manager');
    const created = await call('POST', '/employees', { employeeCode: 'T310', firstName: 'New', lastName: 'Manager', access: { roleId: managerRole.id, username: 'new.manager', password: 'Manager#2026' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.credentials.loginId, 'new.manager');
    assert.equal(await signIn('new.manager', 'Manager#2026'), 200);
    const detail = await call('GET', `/employees/${created.body.id}`);
    assert.equal(detail.body.login.roleName, 'Manager');

    // A clash in the login details rolls the whole thing back — no half-created employee.
    const clash = await call('POST', '/employees', { employeeCode: 'T311', firstName: 'Clash', access: { username: 'new.manager', password: 'Another#123' } });
    assert.equal(clash.status, 400);
    const list = await call('GET', '/employees?search=T311');
    assert.equal(list.body.total, 0);
  });

  test('a user can be created with only a login ID', async () => {
    const roleList = await call('GET', '/roles');
    const roleId = roleList.body.find((x: { name: string }) => x.name === 'IT / Asset Manager').id;
    const created = await call('POST', '/users', { name: 'Store Keeper', username: 'store1', password: 'Store#2026', roleId });
    assert.equal(created.status, 201);
    assert.equal(await signIn('store1', 'Store#2026'), 200);
  });

  test('admins can look up the saved password of a login; every look is logged', async () => {
    const roleList = await call('GET', '/roles');
    const roleId = roleList.body.find((x: { name: string }) => x.name === 'HR').id;
    const created = await call('POST', '/users', { name: 'Saved Pass', username: 'saved.pass', password: 'First#2026', roleId });
    assert.equal(created.status, 201);
    const listed = (await call('GET', '/users?search=saved.pass')).body.items[0];
    assert.equal(listed.hasSavedPassword, true);
    assert.equal(listed.passwordSaved, undefined);

    const shown = await call('GET', `/users/${created.body.id}/password`);
    assert.equal(shown.body.password, 'First#2026');
    assert.equal(shown.body.loginId, 'saved.pass');
    assert.equal((await call('GET', `/users/${created.body.id}/password`, undefined, 'bob')).status, 403);

    await call('PATCH', `/users/${created.body.id}`, { password: 'Second#2026' });
    assert.equal((await call('GET', `/users/${created.body.id}/password`)).body.password, 'Second#2026');
    const log = await call('GET', `/history?entityType=USER&entityId=${created.body.id}`);
    assert.ok(log.body.items.some((e: { action: string }) => e.action === 'PASSWORD_VIEWED'));
  });

  test('every new login is on the employee list, except leadership', async () => {
    const roleList = await call('GET', '/roles');
    const roleId = (name: string) => roleList.body.find((x: { name: string }) => x.name === name).id;
    const users = async () => (await call('GET', '/users?pageSize=100')).body.items as { id: string; employeeId: string | null; employeeCode: string | null }[];

    const hr = await call('POST', '/users', { name: 'Neha Verma', username: 'neha.hr', password: 'Hr#2026ok', roleId: roleId('HR'), employeeCode: 't-hr01' });
    assert.equal(hr.status, 201);
    const hrRow = (await users()).find((u) => u.id === hr.body.id)!;
    assert.equal(hrRow.employeeCode, 'T-HR01');
    const person = await call('GET', `/employees/${hrRow.employeeId}`);
    assert.equal(person.body.fullName, 'Neha Verma');
    assert.equal(person.body.status, 'ACTIVE');

    const auto = await call('POST', '/users', { name: 'Ravi Admin', username: 'ravi.admin', password: 'Admin#2026', roleId: roleId('Admin') });
    assert.match((await users()).find((u) => u.id === auto.body.id)!.employeeCode ?? '', /^STAFF-\d{3}$/);

    const taken = await call('POST', '/users', { name: 'Clash', username: 'clash1', password: 'Clash#2026', roleId: roleId('HR'), employeeCode: 'T-HR01' });
    assert.equal(taken.status, 400);

    const ceo = await call('POST', '/users', { name: 'Test CEO', username: 'ceo1', password: 'Ceo#2026ok', roleId: roleId('Leadership') });
    assert.equal(ceo.status, 201);
    assert.equal((await users()).find((u) => u.id === ceo.body.id)!.employeeId, null);
    // With no employee behind it, the login ID is their only way in.
    assert.equal((await call('PATCH', `/users/${ceo.body.id}`, { username: null })).status, 400);
  });
});

describe('onboarding', () => {
  test('HR plans a joiner, IT prepares and issues, joining day makes them active', async () => {
    const kit = await call('POST', '/onboarding-kits', {
      name: 'Drone pilot',
      items: [
        { assetTypeId: ids.type, quantity: 1, notes: '4K camera' },
        { itemName: 'Safety vest', quantity: 1 },
      ],
    });
    assert.equal(kit.status, 201);
    const created = await call('POST', '/onboarding', { employeeCode: 'T500', firstName: 'Joiner', lastName: 'One', joinDate: '2030-01-15', kitId: kit.body.id, items: [{ itemName: 'Welcome kit' }] });
    assert.equal(created.status, 201);
    const caseId = created.body.id;
    const employeeId = created.body.employeeId;

    let emp = await call('GET', `/employees/${employeeId}`);
    assert.equal(emp.body.status, 'JOINING');
    assert.equal(emp.body.onboarding.id, caseId);
    assert.equal((await call('POST', `/employees/${employeeId}/status`, { status: 'NOTICE_PERIOD', lastWorkingDate: '2030-02-01' })).status, 400);
    assert.equal((await call('GET', '/onboarding', undefined, 'bob')).status, 403);

    let ob = await call('GET', `/onboarding/${caseId}`, undefined, 'it');
    assert.equal(ob.body.status, 'DRAFT');
    assert.deepEqual(ob.body.items.map((i: { itemName: string }) => i.itemName), ['Quadcopter', 'Safety vest', 'Welcome kit']);

    // HR sends it to IT: IT is notified and sees it in the priority queue, waiting for approval.
    assert.equal((await call('POST', `/onboarding/${caseId}/submit`)).status, 200);
    const notes = await call('GET', '/notifications', undefined, 'it');
    assert.ok(JSON.stringify(notes.body).includes('New joiner to approve: Joiner One'));
    const queue = await call('GET', '/queue?kind=ONBOARDING', undefined, 'it');
    assert.equal(queue.body.items.find((i: { id: string }) => i.id === caseId).status, 'SUBMITTED');

    // Nothing can be assigned before approval; IT can send it back to HR with a note.
    const [droneItem, vest] = ob.body.items;
    const drone = await newDrone({ name: 'Joiner drone' });
    assert.equal((await call('POST', `/onboarding/${caseId}/assign-all`, { assignments: [{ itemId: droneItem.id, assetId: drone.body.id }] }, 'it')).body.assigned, 0);
    assert.equal((await call('POST', `/onboarding/${caseId}/send-back`, { note: 'Add a charger too' }, 'it')).status, 200);
    ob = await call('GET', `/onboarding/${caseId}`, undefined, 'it');
    assert.equal(ob.body.status, 'DRAFT');
    assert.equal(ob.body.returnNote, 'Add a charger too');
    assert.equal((await call('POST', `/onboarding/${caseId}/submit`)).status, 200);

    // IT approves, skips the vest and assigns the drone in one go.
    assert.equal((await call('POST', `/onboarding/${caseId}/approve`, {}, 'it')).status, 200);
    assert.equal((await call('PATCH', `/onboarding/${caseId}/items/${vest.id}`, { status: 'SKIPPED', skipReason: 'Not needed for office role' }, 'it')).status, 200);
    const taken = await newDrone({ name: 'Already out' });
    await call('POST', `/assets/${taken.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice });
    const assigned = await call('POST', `/onboarding/${caseId}/assign-all`, { assignments: [{ itemId: droneItem.id, assetId: drone.body.id }] }, 'it');
    assert.equal(assigned.body.assigned, 1);
    ob = await call('GET', `/onboarding/${caseId}`, undefined, 'it');
    assert.equal(ob.body.ready, false, 'the welcome kit is still to assign');
    emp = await call('GET', `/employees/${employeeId}`);
    assert.ok(emp.body.assets.some((a: { assetId: string }) => a.assetId === drone.body.id));
    // An asset someone else holds cannot be assigned.
    const welcome = ob.body.items.find((i: { itemName: string }) => i.itemName === 'Welcome kit');
    const clash = await call('POST', `/onboarding/${caseId}/assign-all`, { assignments: [{ itemId: welcome.id, assetId: taken.body.id }] }, 'it');
    assert.equal(clash.body.assigned, 0);

    // Joining day: employee becomes active, the un-given welcome kit becomes an approved request.
    const done = await call('POST', `/onboarding/${caseId}/complete`, {}, 'it');
    assert.equal(done.status, 200);
    assert.equal(done.body.requests.length, 1);
    emp = await call('GET', `/employees/${employeeId}`);
    assert.equal(emp.body.status, 'ACTIVE');
    const reqs = await call('GET', `/requests?search=${done.body.requests[0]}&status=APPROVED`, undefined, 'it');
    assert.equal(reqs.body.items[0].typeName, 'Welcome kit');
    assert.equal((await call('POST', `/onboarding/${caseId}/cancel`, { reason: 'too late' })).status, 409);
  });

  test('a joiner who does not join is closed and marked exited', async () => {
    const created = await call('POST', '/onboarding', { employeeCode: 'T501', firstName: 'No', lastName: 'Show', joinDate: '2030-03-01', items: [{ itemName: 'Laptop' }] });
    assert.equal((await call('POST', `/onboarding/${created.body.id}/cancel`, { reason: 'Declined the offer' })).status, 200);
    const emp = await call('GET', `/employees/${created.body.employeeId}`);
    assert.equal(emp.body.status, 'EXITED');
  });
});

describe('leadership overview', () => {
  test('the Leadership role sees the overview; employees cannot', async () => {
    const roleList = await call('GET', '/roles');
    const leadership = roleList.body.find((x: { name: string }) => x.name === 'Leadership');
    assert.ok(leadership, 'Leadership role exists');
    await call('POST', '/users', { name: 'The CEO', username: 'ceo', password: PASSWORD, roleId: leadership.id });
    await login('ceo', 'ceo');

    const r = await call('GET', '/leadership?days=90', undefined, 'ceo');
    assert.equal(r.status, 200);
    assert.equal(r.body.days, 90);
    assert.ok(r.body.headline.headcount >= 2);
    assert.ok(r.body.service.handovers >= 1);
    const it = r.body.team.find((m: { name: string }) => m.name === 'Test IT');
    assert.ok(it, 'IT user is listed in the team');
    assert.ok(!r.body.team.some((m: { name: string }) => m.name === 'The CEO'), 'view-only roles are not in the team');

    // Read-only: the CEO can look but not change.
    assert.equal((await call('POST', '/assets', { assetTypeId: ids.type, name: 'x', attributes: {} }, 'ceo')).status, 403);
    assert.equal((await call('GET', '/leadership', undefined, 'bob')).status, 403);
    // CEO only: Admin and IT have full access to everything else, but not this page.
    assert.equal((await call('GET', '/leadership', undefined, 'admin')).status, 403);
    assert.equal((await call('GET', '/leadership', undefined, 'it')).status, 403);
  });
});

describe('reconciliation', () => {
  test('an Airtel dump is matched to SIM records by connection or SIM number', async () => {
    const cat = await call('POST', '/categories', { name: 'Telecom', code: 'TEL' });
    const type = await call('POST', '/asset-types', { categoryId: cat.body.id, name: 'SIM Card', code: 'SIM', trackingMode: 'INDIVIDUAL' });
    for (const label of ['Connection Number', 'SIM Number', 'Plan', 'Circle']) await call('POST', '/fields', { assetTypeId: type.body.id, label, type: 'text' });
    const sim = (attributes: Record<string, string>) => call('POST', '/assets', { assetTypeId: type.body.id, name: 'Airtel SIM', status: 'AVAILABLE', attributes });
    const good = await sim({ connection_number: '9000000775', sim_number: '8991000000000000110U', plan: 'INFINITY_299', circle: 'DL' });
    await sim({ connection_number: '9000000771', sim_number: '8991000000000000169U', plan: 'OLD_PLAN', circle: 'DL' });
    await sim({ connection_number: '9000000001', sim_number: '8991000000000000001U', plan: 'X', circle: 'DL' });
    await call('POST', `/assets/${good.body.id}/assign`, { holderType: 'EMPLOYEE', holderId: ids.alice });

    const rows = [
      { connectionNumber: '9000000775', simNumber: '8991000000000000110', plan: 'infinity_299', circle: 'DL', status: 'Active', email: 'alice@t.test' },
      { connectionNumber: '9000000771', simNumber: '8991000000000000169U', plan: 'INFINITY_299', circle: 'DL', status: 'Active' },
      { connectionNumber: '9000000458', simNumber: '8991000000000000497U', plan: 'INFINITY_299', circle: 'DL', status: 'Active' },
    ];
    assert.equal((await call('POST', '/reconciliations', { source: 'AIRTEL', fileName: 'airtel.xlsx', rows }, 'bob')).status, 403);
    const res = await call('POST', '/reconciliations', { source: 'AIRTEL', fileName: 'airtel.xlsx', rows }, 'it');
    assert.equal(res.status, 201);
    assert.deepEqual(
      { ...res.body.summary, warnings: undefined },
      { MATCHED: 1, MISMATCH: 1, MISSING_IN_SYSTEM: 1, MISSING_IN_DUMP: 1, INVALID: 0, warnings: undefined },
    );
    const run = await call('GET', `/reconciliations/${res.body.id}`, undefined, 'it');
    const plan = run.body.items.find((i: { key: string }) => i.key === '9000000771');
    assert.deepEqual(plan.issues.map((x: { field: string }) => x.field), ['plan']);

    // The team is notified of every run.
    const notes = await call('GET', '/notifications', undefined, 'admin');
    assert.ok(JSON.stringify(notes.body).includes('Airtel connections check'));
  });

  test('a connection saved as someone’s phone maps to them and can be added to the SIM register', async () => {
    const emp = await call('POST', '/employees', { employeeCode: 'T400', firstName: 'Phone', lastName: 'Owner', phone: '9000000510' });
    const rows = [{ connectionNumber: '9000000510', simNumber: '8991000000000000999U', plan: 'Postpaid 349', circle: 'DL', status: 'Active', name: 'Phone Owner' }];
    const first = await call('POST', '/reconciliations', { source: 'AIRTEL', fileName: 'airtel.xlsx', rows }, 'it');
    let run = await call('GET', `/reconciliations/${first.body.id}`, undefined, 'it');
    let item = run.body.items.find((i: { key: string }) => i.key === '9000000510');
    assert.equal(item.status, 'MATCHED');
    assert.equal(item.entity.id, emp.body.id);
    assert.equal(item.addSim.employeeId, emp.body.id);

    const added = await call('POST', `/reconciliations/${first.body.id}/add-sims`, { keys: ['9000000510'] }, 'it');
    assert.equal(added.status, 200);
    assert.equal(added.body.added, 1, JSON.stringify(added.body.results));
    run = await call('GET', `/reconciliations/${first.body.id}`, undefined, 'it');
    item = run.body.items.find((i: { key: string }) => i.key === '9000000510');
    assert.equal(item.entity.kind, 'ASSET');
    assert.equal(item.addSim, undefined);
    const held = await call('GET', `/employees/${emp.body.id}`);
    assert.ok(held.body.assets.some((a: { assetTag: string }) => a.assetTag.startsWith('SIM-')));

    // The next upload matches the SIM record directly.
    const second = await call('POST', '/reconciliations', { source: 'AIRTEL', fileName: 'airtel.xlsx', rows }, 'it');
    run = await call('GET', `/reconciliations/${second.body.id}`, undefined, 'it');
    item = run.body.items.find((i: { key: string }) => i.key === '9000000510');
    assert.equal(item.status, 'MATCHED');
    assert.equal(item.entity.kind, 'ASSET');
  });

  test('a Salary Box dump is matched to employees and what they hold', async () => {
    const rows = [
      { employeeCode: 'T0001', name: 'Alice Rao', officialEmail: 'alice@t.test', laptop: null, simDetails: '9000000775' },
      { employeeCode: 'T002', name: 'Bob Iyer', simDetails: '9000000771' },
      { employeeCode: 'T999', name: 'Ghost Person' },
    ];
    const res = await call('POST', '/reconciliations', { source: 'SALARYBOX', fileName: 'salarybox.xlsx', rows }, 'it');
    assert.equal(res.status, 201);
    const run = await call('GET', `/reconciliations/${res.body.id}`, undefined, 'it');
    const byKey = (k: string) => run.body.items.find((i: { key: string }) => i.key === k);
    // Alice holds the SIM she declared; her ID is only written with an extra zero.
    assert.equal(byKey('T001').status, 'MATCHED');
    assert.ok(byKey('T001').issues.some((x: { label: string }) => /written differently/.test(x.label)));
    // Bob declares a SIM that is not assigned to him.
    assert.equal(byKey('T002').status, 'MISMATCH');
    assert.equal(byKey('T999').status, 'MISSING_IN_SYSTEM');
    assert.ok(run.body.summary.MISSING_IN_DUMP >= 1);
    // Only the known columns are stored.
    const stored = await call('POST', '/reconciliations', { source: 'SALARYBOX', fileName: 'x.xlsx', rows: [{ employeeCode: 'T002', name: 'Bob Iyer', aadhar: '123412341234' }] }, 'it');
    const [raw] = (await dbs.root.execute<{ items: unknown }>(sql`select items from reconciliation_runs where id = ${stored.body.id}`)).rows;
    assert.ok(!JSON.stringify(raw).includes('123412341234'));
  });
});

describe('history', () => {
  test('history is append-only at the database level', async () => {
    // Drizzle wraps the PostgreSQL error; the trigger's message is on the cause.
    const appendOnly = (err: { message?: string; cause?: { message?: string } }) => /append-only/.test(`${err.message} ${err.cause?.message}`);
    await assert.rejects(dbs.root.execute(sql`update history_events set summary = 'tampered'`), appendOnly);
    await assert.rejects(dbs.root.execute(sql`delete from history_events`), appendOnly);
    await assert.rejects(dbs.root.execute(sql`truncate history_events`), appendOnly);
    const r = await dbs.root.execute<{ n: number }>(sql`select count(*)::int as n from history_events where summary = 'tampered'`);
    assert.equal(r.rows[0].n, 0);
  });
});
