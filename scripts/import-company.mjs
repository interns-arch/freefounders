// Imports an existing single-company install (CarTrends) into Kaampilot as one company (PLAN.md §14.6).
//
//   node scripts/import-company.mjs --code CARTRENDS --name "CarTrends Autoparts Pvt Ltd" \
//        --tasks-source postgres://…/cartrends_tasks_copy  [--assets-source postgres://…/cartrends_assets_copy] \
//        [--owner-email founder@cartrends.net] [--report-dir import-report]  [--apply]
//
// Sources are RESTORED COPIES of the live databases (pg_restore a pg_dump into a scratch database first);
// they are only read. Without --apply nothing is written: the dry run prints what would be copied and writes
// people.csv + review.csv to the report folder. With --apply it:
//   1. creates the company's Tasks schema (manage.py company_create) and Assets schema (Assets migrator),
//   2. copies every table, keeping ids (values pass through as text, so dates, JSON and photos are exact),
//   3. creates the company, its people, their logins (Tasks password hashes keep working; argon2id from the
//      first sign-in) and their app links in the Platform, and links the app users to those people.
// Roles: the next `company sync` gives the company Admin and Member only (PLAN.md §19.28) and maps each person from
// their old app roles: Tasks Super Admin / Admin → Admin; anyone else → Member + a personal role ("extra access")
// with exactly what their old roles gave beyond Member (RolesService.importFromApps).
// It refuses to run when the company code or its schemas already exist. On failure before step 3 it removes
// the schemas it created, so the run can be repeated.
//
// Targets default to the local dev suite; override with --platform-db, --tasks-db, --assets-db.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'services/platform/package.json'));
const pg = require('pg');
const WIN = process.platform === 'win32';
const TASKS_PY = path.join(ROOT, 'services/tasks/backend', WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python');

// ---------------------------------------------------------------- arguments
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(process.argv[i]);
  if (m) opts[m[1]] = m[2] ?? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
}
const APPLY = opts.apply === 'true';
const CODE = (opts.code ?? '').trim().toUpperCase();
const NAME = (opts.name ?? '').trim();
const SCHEMA = 'co_' + CODE.toLowerCase().replace(/[^a-z0-9_]/g, '_');
const OWNER_EMAIL = opts['owner-email']?.trim().toLowerCase();
const REPORT_DIR = path.resolve(opts['report-dir'] ?? `import-report-${CODE.toLowerCase()}`);
const TARGET = {
  platform: opts['platform-db'] ?? 'postgres://postgres:postgres@localhost:5434/ff_platform',
  tasks: opts['tasks-db'] ?? 'postgres://postgres:postgres@localhost:5434/ff_tasks',
  assets: opts['assets-db'] ?? 'postgres://postgres:postgres@localhost:5433/eam',
};
if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(CODE) || !NAME || (!opts['tasks-source'] && !opts['assets-source'])) {
  console.error('Usage: node scripts/import-company.mjs --code CODE --name "Company name" --tasks-source URL [--assets-source URL] [--owner-email E] [--apply]');
  process.exit(2);
}

// Tables that are not copied: framework bookkeeping, ids that differ per database, old sessions/tokens
// (everyone signs in through the Platform now) and tables that only exist in Kaampilot.
const SKIP = {
  tasks: new Set([
    'django_migrations', 'django_content_type', 'auth_permission', 'auth_group_permissions', 'accounts_user_user_permissions',
    'django_session', 'django_admin_log', 'token_blacklist_outstandingtoken', 'token_blacklist_blacklistedtoken', 'tenancy_companysetting',
    // The founder removed the Idea board and Web forms (2026-10-13, PLAN.md §19.23): their old data is not carried over.
    'workspace_idea', 'workspace_idea_votes', 'workspace_ideacomment',
    'webforms_form', 'webforms_formfield', 'webforms_formsubmission', 'webforms_submissionfile',
  ]),
  assets: new Set(['__ff_migrations', 'sessions']),
};

// Every value as text in and out, so nothing is reinterpreted on the way (timestamps, dates, json, bytea, arrays).
const rawTypes = { getTypeParser: () => (v) => v };
const pool = (url, raw = false) => new pg.Pool({ connectionString: url, max: 2, ...(raw ? { types: rawTypes } : {}) });

const lower = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const digits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};
const csv = (rows) =>
  rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';

// ---------------------------------------------------------------- table copy
async function tables(db, schema) {
  const { rows } = await db.query(
    `select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE' order by table_name`,
    [schema],
  );
  return rows.map((r) => r.table_name);
}

async function columns(db, schema, table) {
  const { rows } = await db.query(
    `select column_name, is_generated, identity_generation from information_schema.columns
     where table_schema = $1 and table_name = $2 order by ordinal_position`,
    [schema, table],
  );
  return rows;
}

/** What would be copied: per table, source rows, and anything in the source the target has no place for. */
async function plan(app, src, dst, dstSchema) {
  const srcTables = await tables(src, 'public');
  const dstTables = new Set(await tables(dst, dstSchema));
  const out = { copy: [], missingTables: [], droppedColumns: [] };
  for (const t of srcTables) {
    if (SKIP[app].has(t)) continue;
    if (!dstTables.has(t)) {
      const { rows } = await src.query(`select count(*)::int as n from public."${t}"`);
      if (Number(rows[0].n) > 0) out.missingTables.push(`${t} (${rows[0].n} rows)`);
      continue;
    }
    const srcCols = (await columns(src, 'public', t)).map((c) => c.column_name);
    const dstCols = await columns(dst, dstSchema, t);
    const writable = new Set(dstCols.filter((c) => c.is_generated !== 'ALWAYS' && c.identity_generation !== 'ALWAYS').map((c) => c.column_name));
    const allDst = new Set(dstCols.map((c) => c.column_name));
    const cols = srcCols.filter((c) => writable.has(c));
    for (const c of srcCols) if (!allDst.has(c)) out.droppedColumns.push(`${t}.${c}`);
    const { rows } = await src.query(`select count(*)::int as n from public."${t}"`);
    out.copy.push({ table: t, columns: cols, rows: Number(rows[0].n) });
  }
  return out;
}

async function copy(src, dst, dstSchema, planned) {
  const client = await dst.connect();
  try {
    await client.query('begin');
    // Foreign keys and triggers (e.g. append-only history) are not re-checked for rows copied as they were.
    await client.query('set local session_replication_role = replica');
    for (const { table, columns: cols, rows: total } of planned.copy) {
      await client.query(`delete from "${dstSchema}"."${table}"`);
      if (!total || !cols.length) continue;
      const list = cols.map((c) => `"${c}"`).join(', ');
      const batch = Math.max(1, Math.min(500, Math.floor(30000 / cols.length)));
      for (let offset = 0; offset < total; offset += batch) {
        const { rows } = await src.query(`select ${list} from public."${table}" order by 1 limit ${batch} offset ${offset}`);
        if (!rows.length) break;
        const values = [];
        const tuples = rows.map((row) => `(${cols.map((c) => (values.push(row[c]), `$${values.length}`)).join(', ')})`);
        await client.query(`insert into "${dstSchema}"."${table}" (${list}) values ${tuples.join(', ')}`, values);
      }
      // Counters continue after the highest copied id.
      const { rows: seqs } = await client.query(
        `select column_name, pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), column_name) as seq
         from information_schema.columns where table_schema = $1 and table_name = $2`,
        [dstSchema, table],
      );
      for (const s of seqs.filter((x) => x.seq)) {
        await client.query(`select setval($1, coalesce((select max("${s.column_name}") from "${dstSchema}"."${table}"), 0) + 1, false)`, [s.seq]);
      }
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- people
async function readPeople(srcTasks, srcAssets) {
  const tasks = srcTasks
    ? (
        await srcTasks.query(
          `select id, username, email, first_name, last_name, password, is_active, role, whatsapp_phone from public.accounts_user order by id`,
        )
      ).rows
    : [];
  const assets = srcAssets
    ? (
        await srcAssets.query(
          `select u.id, u.username, u.email, u.name, u.password_hash, u.is_active, r.name as role, e.employee_code, e.phone
           from public.users u join public.roles r on r.id = u.role_id left join public.employees e on e.id = u.employee_id
           order by u.created_at`,
        )
      ).rows
    : [];
  return { tasks, assets };
}

/** Pairs Tasks and Assets users that are the same person: employee code, then email, then mobile. */
function matchPeople({ tasks, assets }) {
  const review = [];
  const index = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const byCode = index(assets, (a) => lower(a.employee_code));
  const byEmail = index(assets, (a) => lower(a.email));
  const byMobile = index(assets, (a) => digits(a.phone));
  const used = new Set();
  const people = [];
  for (const t of tasks) {
    let match = null;
    let how = null;
    for (const [rule, map, key] of [
      ['employee code', byCode, lower(t.username)],
      ['email', byEmail, lower(t.email)],
      ['mobile', byMobile, digits(t.whatsapp_phone)],
    ]) {
      const hits = (key && map.get(key)?.filter((a) => !used.has(a.id))) ?? [];
      if (hits.length === 1) {
        match = hits[0];
        how = rule;
        break;
      }
      if (hits.length > 1) {
        review.push(['ambiguous', `Tasks user ${t.username}`, `${hits.length} Assets users share this ${rule}; linked to none`]);
        break;
      }
    }
    if (match) used.add(match.id);
    people.push({ tasks: t, assets: match, how });
  }
  for (const a of assets) if (!used.has(a.id)) people.push({ tasks: null, assets: a, how: null });
  return { people, review };
}

function personOf({ tasks: t, assets: a }) {
  const tasksName = t ? `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() : '';
  const usable = (h) => typeof h === 'string' && h.length > 0 && !h.startsWith('!');
  return {
    fullName: tasksName || a?.name || t?.username || 'Unknown',
    email: lower(t?.email) ?? lower(a?.email),
    employeeCode: a?.employee_code ?? null,
    mobile: t?.whatsapp_phone || a?.phone || null,
    active: Boolean((t && t.is_active) || (a && a.is_active)),
    username: t?.username ?? a?.username ?? null,
    // Tasks is the app in daily use, so its password wins; Assets' argon2id hash otherwise.
    passwordHash: usable(t?.password) && t.password.startsWith('pbkdf2_sha256$') ? t.password : usable(a?.password_hash) ? a.password_hash : null,
    platformRole:
      OWNER_EMAIL && (lower(t?.email) === OWNER_EMAIL || lower(a?.email) === OWNER_EMAIL)
        ? 'owner'
        : // Admin-like in Tasks (the old Super Admin / Admin) → the built-in Admin role on the next `company sync`
          // (PLAN.md §19.28). Everyone else, an Assets-only "Admin" included, becomes Member plus a personal role with
          // whatever their old app roles gave beyond Member, so nobody loses access and nobody gains Tasks admin.
          ['super_admin', 'admin'].includes(t?.role)
          ? 'admin'
          : 'member',
  };
}

// ---------------------------------------------------------------- main
const src = {
  tasks: opts['tasks-source'] ? pool(opts['tasks-source'], true) : null,
  assets: opts['assets-source'] ? pool(opts['assets-source'], true) : null,
};
const dst = { platform: pool(TARGET.platform), tasks: src.tasks ? pool(TARGET.tasks) : null, assets: src.assets ? pool(TARGET.assets) : null };
const created = [];

try {
  console.log(`\n${APPLY ? 'IMPORT' : 'DRY RUN (nothing is written; add --apply to import)'}: ${NAME} (${CODE}) → schema ${SCHEMA}\n`);

  // Refuse to overwrite anything.
  const { rows: existing } = await dst.platform.query('select 1 from platform.companies where upper(code) = $1', [CODE]);
  if (existing.length) throw new Error(`The Platform already has a company with code ${CODE}`);
  for (const app of ['tasks', 'assets']) {
    if (!dst[app]) continue;
    const { rows } = await dst[app].query('select 1 from information_schema.schemata where schema_name = $1', [SCHEMA]);
    if (rows.length) throw new Error(`${app} already has a schema ${SCHEMA}`);
  }

  // What would be copied (compared with the target app's current table layout in `public`).
  const plans = {};
  for (const app of ['tasks', 'assets']) {
    if (!src[app]) continue;
    plans[app] = await plan(app, src[app], dst[app], 'public');
    const p = plans[app];
    console.log(`${app}: ${p.copy.length} tables, ${p.copy.reduce((n, t) => n + t.rows, 0)} rows`);
    for (const t of p.copy.filter((x) => x.rows)) console.log(`   ${t.table.padEnd(40)} ${String(t.rows).padStart(8)}`);
    if (p.missingTables.length) console.log(`   ⚠ tables with data that Kaampilot does not have: ${p.missingTables.join(', ')}`);
    if (p.droppedColumns.length) console.log(`   ⚠ columns Kaampilot does not have: ${p.droppedColumns.join(', ')}`);
  }

  // People.
  const sourcePeople = await readPeople(src.tasks, src.assets);
  const { people, review } = matchPeople(sourcePeople);
  const planned = people.map((p) => ({ ...p, person: personOf(p) }));
  const emails = planned.map((p) => p.person.email).filter(Boolean);
  const usernames = planned.map((p) => lower(p.person.username)).filter(Boolean);
  const { rows: takenEmails } = await dst.platform.query('select lower(email) as e from platform.people where lower(email) = any($1)', [emails]);
  const { rows: takenNames } = await dst.platform.query('select lower(username) as u from platform.logins where lower(username) = any($1)', [usernames]);
  const taken = { email: new Set(takenEmails.map((r) => r.e)), username: new Set(takenNames.map((r) => r.u)) };
  const seen = { email: new Set(), username: new Set() };
  for (const p of planned) {
    const who = p.person.fullName;
    for (const field of ['email', 'username']) {
      const v = lower(p.person[field]);
      if (!v) continue;
      if (taken[field].has(v) || seen[field].has(v)) {
        review.push([`${field} clash`, who, `${v} is already used on Kaampilot; left blank, set one in People & access`]);
        p.person[field] = null;
      } else seen[field].add(v);
    }
    if (!p.person.passwordHash) review.push(['no password', who, 'cannot sign in until a password is set in People & access']);
    if (!p.person.email && !p.person.username && !p.person.employeeCode) review.push(['no sign-in name', who, 'no email, username or employee code']);
  }
  if (OWNER_EMAIL && !planned.some((p) => p.person.platformRole === 'owner')) review.push(['no owner', OWNER_EMAIL, 'nobody has this email; no owner set']);

  const linked = planned.filter((p) => p.tasks && p.assets).length;
  console.log(`\npeople: ${planned.length} (${linked} linked across Tasks and Assets, ${planned.filter((p) => p.tasks && !p.assets).length} Tasks only, ${planned.filter((p) => !p.tasks).length} Assets only)`);
  console.log(`        ${planned.filter((p) => p.person.platformRole === 'owner').length} owner, ${planned.filter((p) => p.person.platformRole === 'admin').length} admins, ${planned.filter((p) => !p.person.active).length} inactive`);
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    path.join(REPORT_DIR, 'people.csv'),
    csv([
      ['full_name', 'email', 'username', 'employee_code', 'mobile', 'platform_role', 'active', 'tasks_user', 'assets_user', 'matched_by', 'password_from'],
      ...planned.map((p) => [
        p.person.fullName, p.person.email, p.person.username, p.person.employeeCode, p.person.mobile, p.person.platformRole, p.person.active,
        p.tasks?.username, p.assets?.email ?? p.assets?.username, p.how,
        !p.person.passwordHash ? '' : p.person.passwordHash.startsWith('pbkdf2') ? 'tasks' : 'assets',
      ]),
    ]),
  );
  writeFileSync(path.join(REPORT_DIR, 'review.csv'), csv([['issue', 'who', 'detail'], ...review]));
  console.log(`        review list: ${review.length} item(s) → ${path.relative(ROOT, path.join(REPORT_DIR, 'review.csv'))}`);

  if (!APPLY) {
    console.log('\n✔ Dry run finished. Nothing was written.\n');
  } else {
    const companyId = randomUUID();
    const apps = Object.keys(plans);

    // 1-2. App schemas and data.
    if (src.tasks) {
      if (!existsSync(TASKS_PY)) throw new Error('Tasks virtualenv missing: run npm run setup');
      execFileSync(TASKS_PY, ['manage.py', 'company_create', companyId, CODE, NAME], {
        cwd: path.join(ROOT, 'services/tasks/backend'),
        env: { ...process.env, DATABASE_URL: TARGET.tasks, DB_SSLMODE: process.env.DB_SSLMODE ?? 'disable', TENANCY: 'schemas' },
        stdio: 'inherit',
      });
      created.push(['tasks', SCHEMA]);
      plans.tasks = await plan('tasks', src.tasks, dst.tasks, SCHEMA);
      await copy(src.tasks, dst.tasks, SCHEMA, plans.tasks);
      console.log(`✔ tasks: copied into ${SCHEMA}`);
    }
    if (src.assets) {
      const tenancy = require(path.join(ROOT, 'services/assets/apps/api/dist/db/tenancy.js'));
      await tenancy.ensureRegistry(dst.assets);
      created.push(['assets', SCHEMA]);
      await tenancy.migrateCompanySchema(dst.assets, SCHEMA);
      plans.assets = await plan('assets', src.assets, dst.assets, SCHEMA);
      await copy(src.assets, dst.assets, SCHEMA, plans.assets);
      await tenancy.registerCompany(dst.assets, { companyId, schema: SCHEMA, name: NAME });
      console.log(`✔ assets: copied into ${SCHEMA}`);
    }

    // 3. Platform: company, people, logins, app links.
    const pc = await dst.platform.connect();
    const links = [];
    try {
      await pc.query('begin');
      await pc.query('insert into platform.companies (id, name, code, enabled_apps) values ($1, $2, $3, $4)', [companyId, NAME, CODE, apps]);
      for (const p of planned) {
        const x = p.person;
        const { rows } = await pc.query(
          `insert into platform.people (company_id, full_name, employee_code, email, mobile, platform_role, status)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [companyId, x.fullName, x.employeeCode, x.email, x.mobile, x.platformRole, x.active ? 'active' : 'inactive'],
        );
        const personId = rows[0].id;
        if (x.passwordHash) {
          await pc.query('insert into platform.logins (person_id, username, password_hash) values ($1, $2, $3)', [personId, x.username, x.passwordHash]);
        }
        if (p.tasks) links.push(['tasks', personId, String(p.tasks.id)]);
        if (p.assets) links.push(['assets', personId, String(p.assets.id)]);
      }
      for (const [app, personId, localId] of links) {
        await pc.query('insert into platform.person_apps (person_id, app, local_user_id) values ($1, $2, $3)', [personId, app, localId]);
      }
      await pc.query('commit');
    } catch (err) {
      await pc.query('rollback').catch(() => {});
      throw err;
    } finally {
      pc.release();
    }
    created.length = 0; // from here on the import is in place; never drop it automatically

    // 4. Each app user knows its person.
    for (const [app, personId, localId] of links) {
      const table = app === 'tasks' ? 'accounts_user' : 'users';
      await dst[app].query(`update "${SCHEMA}"."${table}" set platform_person_id = $1 where id = $2`, [personId, app === 'tasks' ? Number(localId) : localId]);
    }
    console.log(`✔ platform: ${planned.length} people, ${planned.filter((p) => p.person.passwordHash).length} logins, ${links.length} app links`);
    console.log(`\n✔ Imported ${NAME}. Review ${path.relative(ROOT, path.join(REPORT_DIR, 'review.csv'))} with the founder.\n`);
  }
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  for (const [app, schema] of created) {
    await dst[app].query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    if (app === 'tasks') await dst.tasks.query('delete from public.ff_companies where schema_name = $1', [schema]).catch(() => {});
    if (app === 'assets') await dst.assets.query('delete from ff.companies where schema_name = $1', [schema]).catch(() => {});
    console.error(`  removed the partial ${app} schema ${schema}`);
  }
  process.exitCode = 1;
} finally {
  for (const p of [...Object.values(src), ...Object.values(dst)]) await p?.end().catch(() => {});
}
