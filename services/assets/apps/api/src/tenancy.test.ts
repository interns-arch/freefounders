// Kaampilot multi-company mode (TENANCY=schemas): one schema per company, nothing visible across.
// Runs in its own process with `npm test`; creates two company schemas in the throwaway test database
// and drops them afterwards.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { exportJWK, SignJWT } from 'jose';
import { DbService } from './db/db.service';
import { deletableSchema, dropCompany } from './db/tenancy';
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

  test('company -- delete: GET lists, DELETE removes only that company; the same code can be set up again', async () => {
    const GONE = { companyId: randomUUID(), code: 'gone_t', schema: 'co_gone_t', name: 'Gone Test Pvt Ltd' };
    const dir = await mkdtemp(path.join(tmpdir(), 'ff-uploads-'));
    const before = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = dir;
    const extraIds: string[] = [];
    try {
      await dbs.pool.query(`drop schema if exists "${GONE.schema}" cascade`);
      assert.equal((await call('POST', '/internal/companies', { token: await service(), body: GONE })).status, 201);
      const owner = await provision('Gita', GONE);
      const cat = await call('POST', '/categories', { token: await access(owner), body: { name: 'Gone cat', code: 'GNC' } });
      const type = await call('POST', '/asset-types', { token: await access(owner), body: { categoryId: cat.body.id, name: 'Gone type', code: 'GNT', trackingMode: 'INDIVIDUAL' } });
      const asset = await call('POST', '/assets', { token: await access(owner), body: { assetTypeId: type.body.id, name: 'Gone asset', status: 'AVAILABLE', attributes: {} } });
      assert.equal(asset.status, 201, JSON.stringify(asset.body));
      // An older photo kept on disk (no data in the row), and a file of nobody's that must stay.
      await dbs.pool.query(
        `insert into "${GONE.schema}".allocation_photos (asset_id, kind, file_name, mime_type, size_bytes) values ($1, 'ASSET', 'legacy-gone.jpg', 'image/jpeg', 3)`,
        [asset.body.id],
      );
      await writeFile(path.join(dir, 'legacy-gone.jpg'), 'abc');
      await writeFile(path.join(dir, 'other.jpg'), 'keep');
      const url = `/internal/companies/${GONE.companyId}`;

      const info = await call('GET', url, { token: await service() });
      assert.equal(info.status, 200, JSON.stringify(info.body));
      assert.equal(info.body.registered, true);
      assert.equal(info.body.schema, GONE.schema);
      assert.ok(info.body.tables > 10 && info.body.rows > 0);
      assert.equal(info.body.files.count, 1);

      assert.equal((await call('DELETE', url)).status, 401, 'service token only');
      // An access token is not a service token (refused before anything is touched; the guard's own lookup fails closed).
      assert.ok((await call('DELETE', url, { token: await access(owner) })).status >= 400);
      assert.equal((await call('GET', url, { token: await service() })).body.registered, true);
      assert.equal((await call('DELETE', url, { token: await service(ACME.companyId) })).status, 403, 'token for another company');
      assert.equal((await call('DELETE', '/internal/companies/not-a-uuid', { token: await service() })).status, 400);

      const res = await call('DELETE', url, { token: await service() });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.deleted, true);
      const left = await dbs.pool.query(
        `select (select count(*)::int from information_schema.schemata where schema_name = $1) as schemas, (select count(*)::int from ff.companies where company_id = $2) as registry`,
        [GONE.schema, GONE.companyId],
      );
      assert.deepEqual(left.rows[0], { schemas: 0, registry: 0 });
      await assert.rejects(stat(path.join(dir, 'legacy-gone.jpg')));
      assert.equal(await readFile(path.join(dir, 'other.jpg'), 'utf8'), 'keep');
      assert.equal((await call('GET', '/auth/me', { token: await access(owner) })).status, 401, 'the company is gone (cache forgotten)');
      // Other companies untouched.
      const { rows } = await dbs.pool.query(`select (select count(*)::int from "${ACME.schema}".users) as acme, (select count(*)::int from "${BETA.schema}".users) as beta`);
      assert.ok(rows[0].acme > 0 && rows[0].beta > 0);
      assert.deepEqual((await call('DELETE', url, { token: await service() })).body, { registered: false, schema: null, deleted: false });

      // The same code again, as a new company: a fresh schema, the same employee and email free again.
      const again = { ...GONE, companyId: randomUUID() };
      extraIds.push(again.companyId);
      const created = await call('POST', '/internal/companies', { token: await service(), body: again });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.created, true);
      const back = await provision('Gita', again);
      assert.equal((await call('GET', '/auth/me', { token: await access(back) })).status, 200);
      const assets = await dbs.pool.query(`select count(*)::int as n from "${GONE.schema}".assets`);
      assert.equal(assets.rows[0].n, 0);

      // A registry row naming a non-company schema is never dropped.
      const bad = randomUUID();
      extraIds.push(bad);
      await dbs.pool.query("insert into ff.companies (company_id, schema_name, name) values ($1, 'ff_none', 'Bad')", [bad]);
      assert.equal((await call('DELETE', `/internal/companies/${bad}`, { token: await service() })).status, 409);
      assert.ok(deletableSchema('co_x') && !deletableSchema('ff_none') && !deletableSchema('public') && !deletableSchema('ff'));
      await assert.rejects(dropCompany(dbs.pool, again.companyId, ACME.schema), /not this company/);
    } finally {
      await dbs.pool.query(`drop schema if exists "${GONE.schema}" cascade`);
      await dbs.pool.query('delete from ff.companies where company_id = any($1::uuid[])', [[GONE.companyId, ...extraIds]]);
      if (before === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = before;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
