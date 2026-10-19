// `npm run rehearse-import`: a full rehearsal of the CarTrends import on demo data (PLAN.md §14.6), against the
// running dev suite (`npm run dev` first). Safe to repeat: it removes the previous rehearsal first.
//
//  1. builds two "legacy" single-company databases like CarTrends has today: Tasks (demo team + tasks) and
//     Assets (full demo data); one person is in both apps, to exercise the matching
//  2. dry run, then --apply, with scripts/import-company.mjs
//  3. through the gateway: people sign in with their OLD passwords and see exactly the old data
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'services/platform/package.json'));
const pg = require('pg');
const WIN = process.platform === 'win32';
const TASKS_PY = path.join(ROOT, 'services/tasks/backend', WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const BASE = process.env.FF_URL ?? 'http://localhost:8080';
const CODE = 'REHEARSAL';
const SCHEMA = 'co_rehearsal';
const PG_TASKS = 'postgres://postgres:postgres@localhost:5434';
const PG_ASSETS = 'postgres://postgres:postgres@localhost:5433';
const LEGACY = { tasks: `${PG_TASKS}/legacy_tasks`, assets: `${PG_ASSETS}/legacy_eam` };

async function sql(url, text, params) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const step = (s) => console.log(`\n── ${s}`);

// ── 0. remove the previous rehearsal
step('Removing the previous rehearsal');
const old = await sql(`${PG_TASKS}/ff_platform`, 'select id from platform.companies where code = $1', [CODE]);
// Every Platform table that belongs to a company (roles, people, departments, billing…), in any order: a few passes
// get past the foreign keys between them.
const owned = (await sql(`${PG_TASKS}/ff_platform`, "select table_name from information_schema.columns where table_schema = 'platform' and column_name = 'company_id' and table_name <> 'companies'")).map((r) => r.table_name);
for (const { id } of old) {
  for (let pass = 0; pass < 5; pass++) {
    for (const t of owned) await sql(`${PG_TASKS}/ff_platform`, `delete from platform."${t}" where company_id = $1`, [id]).catch(() => {});
  }
  await sql(`${PG_TASKS}/ff_platform`, 'delete from platform.companies where id = $1', [id]);
}
await sql(`${PG_TASKS}/ff_tasks`, `drop schema if exists ${SCHEMA} cascade`);
await sql(`${PG_TASKS}/ff_tasks`, 'delete from public.ff_companies where schema_name = $1', [SCHEMA]).catch(() => {});
await sql(`${PG_ASSETS}/eam`, `drop schema if exists ${SCHEMA} cascade`);
await sql(`${PG_ASSETS}/eam`, 'delete from ff.companies where schema_name = $1', [SCHEMA]).catch(() => {});

// ── 1. legacy databases
step('Building a legacy Tasks database (single company, like CarTrends on EC2)');
await sql(`${PG_TASKS}/postgres`, 'drop database if exists legacy_tasks with (force)');
await sql(`${PG_TASKS}/postgres`, 'create database legacy_tasks');
const legacyTasksEnv = { ...process.env, DATABASE_URL: LEGACY.tasks, DB_SSLMODE: 'disable', TENANCY: '', NOTIF_SCHEDULER: 'false' };
const backend = path.join(ROOT, 'services/tasks/backend');
run(TASKS_PY, ['manage.py', 'migrate', '--noinput', '-v', '0'], { cwd: backend, env: legacyTasksEnv });
run(TASKS_PY, ['manage.py', 'seed_users', '--demo-team'], { cwd: backend, env: legacyTasksEnv, stdio: 'ignore' });
run(
  TASKS_PY,
  [
    'manage.py',
    'shell',
    '-c',
    [
      'from datetime import timedelta',
      'from django.utils import timezone',
      'from accounts.models import User, Role',
      'from crm.models import Task',
      // The same person as the Assets demo admin (matched by email).
      'aditi = User.objects.create_user("aditi", "admin@cartrend.test", "aditi@12345", first_name="Aditi", last_name="Rao", role=Role.ADMIN, department="management")',
      'rahul = User.objects.get(username="rahul")',
      'for i in range(12): Task.objects.create(title=f"Legacy task {i}", assigned_to=rahul, created_by=aditi, effort_minutes=30, due_at=timezone.now() + timedelta(days=i))',
    ].join('\n'),
  ],
  { cwd: backend, env: legacyTasksEnv },
);

step('Building a legacy Assets database (single company, demo data)');
await sql(`${PG_ASSETS}/postgres`, 'drop database if exists legacy_eam with (force)');
await sql(`${PG_ASSETS}/postgres`, 'create database legacy_eam');
const api = path.join(ROOT, 'services/assets/apps/api');
const legacyAssetsEnv = { ...process.env, DATABASE_URL: LEGACY.assets, TENANCY: '', NODE_ENV: 'development' };
run(process.execPath, ['dist/db/migrate.js'], { cwd: api, env: legacyAssetsEnv, stdio: 'ignore' });
run(process.execPath, ['dist/seed/seed.js'], { cwd: api, env: legacyAssetsEnv, stdio: 'ignore' });
// Handover photos live in the database as bytes; add a few so the copy is checked byte for byte.
await sql(
  LEGACY.assets,
  `insert into allocation_photos (asset_id, kind, data, file_name, mime_type, size_bytes)
   select id, 'ASSET', decode(md5(id::text) || repeat('ff00', 2000), 'hex'), 'photo.jpg', 'image/jpeg', 4016 from assets order by created_at limit 5`,
);

const counts = async () => ({
  tasks: Number((await sql(LEGACY.tasks, 'select count(*) as n from crm_task'))[0].n),
  tasksUsers: Number((await sql(LEGACY.tasks, 'select count(*) as n from accounts_user'))[0].n),
  assets: Number((await sql(LEGACY.assets, 'select count(*) as n from assets'))[0].n),
  assetsUsers: Number((await sql(LEGACY.assets, 'select count(*) as n from users'))[0].n),
  photos: Number((await sql(LEGACY.assets, 'select count(*) as n from allocation_photos'))[0].n),
});
const before = await counts();
console.log('legacy data:', before);

// ── 2. dry run, then import
const importer = path.join(ROOT, 'scripts/import-company.mjs');
const args = ['--code', CODE, '--name', 'Rehearsal Autoparts Pvt Ltd', '--tasks-source', LEGACY.tasks, '--assets-source', LEGACY.assets, '--owner-email', 'admin@cartrend.test', '--report-dir', path.join(ROOT, '.data', 'import-rehearsal')];
step('Dry run');
run(process.execPath, [importer, ...args]);
const after0 = await sql(`${PG_TASKS}/ff_platform`, 'select count(*)::int as n from platform.companies where code = $1', [CODE]);
assert.equal(after0[0].n, 0, 'the dry run must not write anything');
step('Import');
run(process.execPath, [importer, ...args, '--apply']);

// ── 2b. roles: the company gets Admin and Member only; people are mapped from their old app roles (PLAN.md §19.28)
step('Roles: Admin and Member, people mapped from their old roles');
run(process.execPath, ['dist/companies.js', 'sync', '--code', CODE], {
  cwd: path.join(ROOT, 'services/platform'),
  env: { ...process.env, DATABASE_URL: `${PG_TASKS}/ff_platform`, TASKS_INTERNAL_URL: 'http://127.0.0.1:8000/api/internal', ASSETS_INTERNAL_URL: 'http://127.0.0.1:3000/api/internal', FF_CLI: 'true' },
});

// ── 3. verify through the gateway, like a browser
step('Checking the result through the gateway');
async function call(method, p, { body, token, cookie } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}
async function signIn(login, password) {
  const res = await call('POST', '/api/platform/auth/login', { body: { login, password, client: 'mobile' } });
  assert.equal(res.status, 200, `${login} signs in with the old password: ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}
const list = (b) => (Array.isArray(b) ? b : b.results ?? b.items);

// A Tasks-only person keeps their Tasks password and sees their tasks.
const rahul = await signIn('rahul', 'rahul@12345');
const rahulMe = await call('GET', '/tasks/api/auth/me', { token: rahul });
assert.equal(rahulMe.status, 200, JSON.stringify(rahulMe.body));
assert.equal(rahulMe.body.username, 'rahul');
const rahulTasks = await call('GET', '/tasks/api/tasks/?page_size=100', { token: rahul });
assert.equal(list(rahulTasks.body).filter((t) => t.title.startsWith('Legacy task')).length, 12);
console.log('  ✔ rahul signs in with his old Tasks password and sees his 12 tasks');

// The person in both apps: one login (Tasks password), owner, opens both apps.
const aditi = await signIn('admin@cartrend.test', 'aditi@12345');
const aditiMe = await call('GET', '/api/platform/auth/me', { token: aditi });
assert.equal(aditiMe.body.person.role, 'owner');
assert.deepEqual(aditiMe.body.apps.map((a) => a.app).sort(), ['assets', 'tasks']);
const session = await call('POST', '/assets/api/auth/platform-session', { token: aditi });
assert.equal(session.status, 200, JSON.stringify(session.body));
const cookie = session.setCookie.split(';')[0];
const assetsList = await call('GET', '/assets/api/assets?pageSize=1', { cookie });
assert.equal(assetsList.status, 200, JSON.stringify(assetsList.body));
assert.equal(assetsList.body.total, before.assets, 'every asset came across');
console.log(`  ✔ Aditi (in both apps) is the owner, opens Tasks and Assets, and sees all ${before.assets} assets`);

const roleList = await call('GET', '/api/platform/roles', { token: aditi });
assert.deepEqual(roleList.body.map((r) => r.code).sort(), ['ff_admin', 'ff_member'], 'only the two built-in roles');
const byCode = Object.fromEntries(roleList.body.map((r) => [r.code, r.id]));
const peopleList = (await call('GET', '/api/platform/people', { token: aditi })).body;
const rahulPerson = peopleList.find((p) => p.login?.username === 'rahul');
assert.deepEqual(rahulPerson.roleIds, [byCode.ff_member], 'a Sales person becomes a Member');
assert.equal(rahulPerson.extraAccess, true, 'with what Sales gave beyond Member as extra access');
assert.deepEqual(peopleList.find((p) => p.email === 'admin@cartrend.test').roleIds, [byCode.ff_admin], 'the old Admin (the owner) holds Admin');
const others = peopleList.filter((p) => p.roleIds.length);
console.log(`  ✔ roles: Admin + Member only; ${others.filter((p) => p.roleIds.includes(byCode.ff_admin)).length} Admin, ${others.filter((p) => p.roleIds.includes(byCode.ff_member)).length} Member (${peopleList.filter((p) => p.extraAccess).length} with extra access)`);

// An Assets-only person keeps their Assets password.
const assetsOnly = await sql(LEGACY.assets, "select email from users where email is not null and email <> 'admin@cartrend.test' and is_active order by created_at limit 1");
const other = await signIn(assetsOnly[0].email, 'Demo@1234');
assert.equal((await call('POST', '/assets/api/auth/platform-session', { token: other })).status, 200);
console.log(`  ✔ ${assetsOnly[0].email} signs in with the old Assets password`);

// Row counts and photo bytes are identical.
const copied = {
  tasks: Number((await sql(`${PG_TASKS}/ff_tasks`, `select count(*) as n from ${SCHEMA}.crm_task`))[0].n),
  assets: Number((await sql(`${PG_ASSETS}/eam`, `select count(*) as n from ${SCHEMA}.assets`))[0].n),
  photos: Number((await sql(`${PG_ASSETS}/eam`, `select count(*) as n from ${SCHEMA}.allocation_photos`))[0].n),
};
assert.deepEqual(copied, { tasks: before.tasks, assets: before.assets, photos: before.photos });
assert.ok(copied.photos >= 5, 'photos were part of the rehearsal');
const [a] = await sql(LEGACY.assets, "select md5(string_agg(md5(data), '' order by id)) as h from allocation_photos");
const [b] = await sql(`${PG_ASSETS}/eam`, `select md5(string_agg(md5(data), '' order by id)) as h from ${SCHEMA}.allocation_photos`);
assert.equal(a.h, b.h, 'photo bytes identical');
console.log(`  ✔ ${copied.tasks} tasks, ${copied.assets} assets and ${copied.photos} photos copied exactly`);

// Nothing leaked into the demo company.
const demo = await signIn('owner', 'Demo@1234');
const demoTasks = await call('GET', '/tasks/api/tasks/?page_size=500', { token: demo });
assert.ok(!list(demoTasks.body).some((t) => t.title.startsWith('Legacy task')));
console.log('  ✔ the other companies see none of it');

// New ids continue after the copied ones.
const [{ n: maxTask }] = await sql(`${PG_TASKS}/ff_tasks`, `select max(id) as n from ${SCHEMA}.crm_task`);
const made = await call('POST', '/tasks/api/tasks/', {
  token: aditi,
  body: { title: 'First task after the import', assigned_to: rahulMe.body.id, priority: 'low', effort_minutes: 10, due_at: new Date(Date.now() + 86_400_000).toISOString() },
});
assert.equal(made.status, 201, JSON.stringify(made.body));
assert.ok(made.body.id > Number(maxTask));
console.log('  ✔ new records continue after the imported ids');

console.log('\n✔ Import rehearsal passed\n');
