// Kaampilot multi-company mode (TENANCY=schemas): one schema per company, nothing visible across.
// Runs in its own process with `npm test`; creates two company schemas in the throwaway test database
// and drops them afterwards.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { exportJWK, SignJWT } from 'jose';
import { DbService } from './db/db.service';
import { createApp } from './main';
import { hashPassword } from './modules/auth/auth.service';

process.env.TENANCY = 'schemas';
const key = generateKeyPairSync('ed25519');
let app: INestApplication;
let base = '';
let dbs: DbService;
const ACME = { companyId: randomUUID(), code: 'acme_t', schema: 'co_acme_t', name: 'Acme Test Pvt Ltd' };
const BETA = { companyId: randomUUID(), code: 'beta_t', schema: 'co_beta_t', name: 'Beta Test Pvt Ltd' };
const people: Record<string, { person: string; userId: string; company: typeof ACME }> = {};

function sign(claims: Record<string, unknown>, sub: string, aud = 'kaampilot', ttl = 900) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setSubject(sub)
    .setIssuer('kaampilot-platform')
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key.privateKey);
}
const service = (cid?: string) => sign(cid ? { cid } : {}, 'platform', 'assets-internal', 60);
const access = (who: { person: string; userId: string; company: typeof ACME }, cid = who.company.companyId) =>
  sign({ cid, apps: { assets: who.userId } }, who.person);

async function call(method: string, path: string, opts: { token?: string; cookie?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

async function provision(name: string, company: typeof ACME, employeeCode = `E-${name}`) {
  const person = randomUUID();
  const res = await call('POST', '/internal/provision', {
    token: await service(company.companyId),
    body: { personId: person, fullName: name, email: `${name.toLowerCase()}@x.test`, employeeCode, appRole: 'Admin' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  people[`${name}@${company.code}`] = { person, userId: res.body.userId, company };
  return people[`${name}@${company.code}`];
}

before(async () => {
  process.env.PLATFORM_JWKS = JSON.stringify({ keys: [{ ...(await exportJWK(key.publicKey)), kid: 'k1', alg: 'EdDSA' }] });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  dbs = app.get(DbService);
  for (const c of [ACME, BETA]) await dbs.pool.query(`drop schema if exists "${c.schema}" cascade`);
});

after(async () => {
  for (const c of [ACME, BETA]) {
    await dbs.pool.query(`drop schema if exists "${c.schema}" cascade`);
    await dbs.pool.query('delete from ff.companies where company_id = $1', [c.companyId]);
  }
  delete process.env.PLATFORM_JWKS;
  delete process.env.TENANCY;
  await app?.close();
});

describe('multi-company mode', () => {
  test('the Platform sets up companies; doing it again changes nothing', async () => {
    for (const c of [ACME, BETA]) {
      const res = await call('POST', '/internal/companies', { token: await service(), body: c });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body, { companyId: c.companyId, schema: c.schema, created: true });
    }
    const again = await call('POST', '/internal/companies', { token: await service(), body: ACME });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    const copycat = await call('POST', '/internal/companies', { token: await service(), body: { ...ACME, companyId: randomUUID() } });
    assert.equal(copycat.status, 409);
    assert.equal((await call('POST', '/internal/companies', { body: BETA })).status, 401);
  });

  test('each company starts with its own roles, company, store and catalog', async () => {
    const { rows } = await dbs.pool.query(`select (select count(*)::int from "${ACME.schema}".roles) as roles,
      (select name from "${ACME.schema}".companies) as company,
      (select count(*)::int from "${ACME.schema}".locations where is_store) as stores,
      (select count(*)::int from "${ACME.schema}".asset_categories) as categories`);
    assert.ok(rows[0].roles > 0);
    assert.equal(rows[0].company, ACME.name);
    assert.equal(rows[0].stores, 1);
    assert.ok(rows[0].categories > 0);
  });

  test('the same employee code and email can exist in two companies', async () => {
    const a = await provision('Asha', ACME, 'E001');
    const b = await provision('Asha', BETA, 'E001');
    assert.notEqual(a.person, b.person);
    const me = await call('GET', '/auth/me', { token: await access(a) });
    assert.equal(me.status, 200, JSON.stringify(me.body));
  });

  test('a company sees only its own people and its own name', async () => {
    const ravi = await provision('Ravi', BETA);
    const acmeUsers = await call('GET', '/users?pageSize=100', { token: await access(people['Asha@acme_t']) });
    assert.equal(acmeUsers.status, 200, JSON.stringify(acmeUsers.body));
    assert.ok(!acmeUsers.body.items.some((u: { id: string }) => u.id === ravi.userId));
    assert.ok(!acmeUsers.body.items.some((u: { name: string }) => u.name === 'Ravi'));

    // Through the cookie session the web app uses (photos, downloads): the cookie carries the company.
    const session = await call('POST', '/auth/platform-session', { token: await access(people['Asha@beta_t']) });
    assert.equal(session.status, 200, JSON.stringify(session.body));
    const cookie = session.setCookie!.split(';')[0];
    assert.ok(cookie.startsWith(`eam_session=${BETA.companyId}~`));
    const config = await call('GET', '/config', { cookie });
    assert.equal(config.body.companyName, BETA.name);
    const betaUsers = await call('GET', '/users?pageSize=100', { cookie });
    assert.ok(betaUsers.body.items.some((u: { name: string }) => u.name === 'Ravi'));
  });

  test('a session cookie relabelled for another company does not work there', async () => {
    const session = await call('POST', '/auth/platform-session', { token: await access(people['Asha@beta_t']) });
    const forged = session.setCookie!.split(';')[0].replace(BETA.companyId, ACME.companyId);
    assert.equal((await call('GET', '/auth/me', { cookie: forged })).status, 401);
  });

  test("a token for one company cannot borrow another company's user", async () => {
    const asha = people['Asha@acme_t'];
    assert.equal((await call('GET', '/auth/me', { token: await access(asha, BETA.companyId) })).status, 401);
  });

  test('requests without a company are refused, and fail closed underneath', async () => {
    const unknown = await call('GET', '/auth/me', { token: await access(people['Asha@acme_t'], randomUUID()) });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.code, 'no_company');
    assert.equal((await call('GET', '/users')).status, 401);
    // The app's own password login has no company to sign in to.
    assert.equal((await call('POST', '/auth/login', { body: { login: 'admin', password: 'x' } })).status, 401);
    // Provision must name a company.
    assert.equal((await call('POST', '/internal/provision', { token: await service(), body: { personId: randomUUID(), fullName: 'X' } })).status, 401);
    // Public endpoints still answer.
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('GET', '/config')).body.companyName, null);
    // A connection that is not pinned to a company sees no tables at all.
    await assert.rejects(dbs.pool.query('select count(*) from users'), /does not exist/);
  });

  test("the app's own password login stays off even when a cookie names the company", async () => {
    // A login that still has an Assets password (e.g. imported): only the Platform may sign it in.
    const asha = people['Asha@acme_t'];
    await dbs.pool.query(`update "${ACME.schema}".users set username = 'asha.local', password_hash = $1 where id = $2`, [await hashPassword('Local@12345'), asha.userId]);
    const cookie = `eam_session=${ACME.companyId}~${'x'.repeat(43)}`;
    const login = await call('POST', '/auth/login', { cookie, body: { login: 'asha.local', password: 'Local@12345' } });
    assert.equal(login.status, 401, JSON.stringify(login.body));
    assert.equal(login.body.code, 'no_company');
    assert.equal(login.setCookie, null);
    // Changing the app's own password is off too (the Platform owns passwords).
    const change = await call('POST', '/auth/change-password', { token: await access(asha), body: { currentPassword: 'Local@12345', newPassword: 'Other@12345' } });
    assert.equal(change.status, 401);
  });

  test('company schemas get the same database rules (history cannot be edited)', async () => {
    await assert.rejects(dbs.pool.query(`update "${ACME.schema}".history_events set summary = 'x'`), /append-only|not allowed|immutable|cannot/i);
  });

  test('an asset photo is served in its own company only (PLAN.md §19.34)', async () => {
    const asha = people['Asha@acme_t'];
    const beta = people['Asha@beta_t'];
    const cat = await call('POST', '/categories', { token: await access(asha), body: { name: 'Photo cat', code: 'PHC' } });
    assert.equal(cat.status, 201, JSON.stringify(cat.body));
    const type = await call('POST', '/asset-types', { token: await access(asha), body: { categoryId: cat.body.id, name: 'Photo type', code: 'PHT', trackingMode: 'INDIVIDUAL' } });
    assert.equal(type.status, 201, JSON.stringify(type.body));
    const asset = await call('POST', '/assets', { token: await access(asha), body: { assetTypeId: type.body.id, name: 'Photo asset', status: 'AVAILABLE', attributes: {} } });
    assert.equal(asset.status, 201, JSON.stringify(asset.body));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 3)]);
    const form = new FormData();
    form.append('kind', 'ASSET');
    form.append('photos', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
    const up = await fetch(`${base}/assets/${asset.body.id}/photos`, {
      method: 'POST',
      headers: { 'x-requested-with': 'XMLHttpRequest', authorization: `Bearer ${await access(asha)}` },
      body: form,
    });
    const upText = await up.text();
    assert.equal(up.status, 201, upText);
    const photoId = (JSON.parse(upText) as { id: string }[])[0].id;
    const url = `/assets/${asset.body.id}/photos/${photoId}`;
    const own = await fetch(base + url, { headers: { authorization: `Bearer ${await access(asha)}` } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('content-type'), 'image/png');
    // The same ids mean nothing in the other company: not found, not deletable, and the table there stays empty.
    assert.equal((await call('GET', url, { token: await access(beta) })).status, 404);
    assert.equal((await call('DELETE', url, { token: await access(beta) })).status, 404);
    assert.equal((await call('GET', `/assets/${asset.body.id}/photos`, { token: await access(beta) })).status, 404);
    const { rows } = await dbs.pool.query(
      `select (select count(*)::int from "${ACME.schema}".allocation_photos) as acme, (select count(*)::int from "${BETA.schema}".allocation_photos) as beta`,
    );
    assert.deepEqual(rows[0], { acme: 1, beta: 0 });
  });

  test('deleting a person works in the company of the token only', async () => {
    const person = randomUUID();
    for (const c of [ACME, BETA]) {
      const res = await call('POST', '/internal/provision', {
        token: await service(c.companyId),
        body: { personId: person, fullName: 'Del Twin', email: 'del.twin@x.test', employeeCode: 'E-DEL', appRole: 'Employee' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    assert.equal((await call('DELETE', `/internal/people/${person}`, { token: await service() })).status, 401);
    const res = await call('DELETE', `/internal/people/${person}`, { token: await service(ACME.companyId) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);
    const count = async (schema: string) =>
      (await dbs.pool.query(`select (select count(*)::int from "${schema}".users where platform_person_id = $1) as users,
        (select count(*)::int from "${schema}".employees where lower(employee_code) = 'e-del') as employees`, [person])).rows[0];
    assert.deepEqual(await count(ACME.schema), { users: 0, employees: 0 });
    assert.deepEqual(await count(BETA.schema), { users: 1, employees: 1 });
    // History stays append-only in the company schema afterwards.
    await assert.rejects(dbs.pool.query(`delete from "${ACME.schema}".history_events`), /append-only|not allowed/i);
  });
});
