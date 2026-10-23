// Kaampilot multi-company mode: one Postgres schema per company (PLAN.md §14).
// Off unless TENANCY=schemas. Each company's schema (co_<code>) holds the full set of Assets tables;
// a request is pinned to one schema and its search_path holds only that schema. Without a company the
// path is the empty `ff_none` schema, so a query fails instead of reading anyone's data.
// The registry of companies lives in the `ff` schema and is only ever addressed by its qualified name.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

export const NO_COMPANY = 'ff_none';
const SCHEMA_RE = /^co_[a-z0-9_]{1,50}$/;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

export function tenancyEnabled(): boolean {
  return process.env.TENANCY?.trim() === 'schemas';
}

export function validSchema(name: string): boolean {
  return name === NO_COMPANY || SCHEMA_RE.test(name);
}

/** co_<code>, from a Platform company code (validated, never trusted raw). */
export function schemaForCode(code: string): string {
  const name = 'co_' + String(code ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (name === 'co_' || !SCHEMA_RE.test(name)) throw new Error(`Invalid company code: ${code}`);
  return name;
}

/** Quoted identifier; `validSchema` limits names to [a-z0-9_] because identifiers cannot be bound parameters. */
export function quoteSchema(name: string): string {
  if (!validSchema(name)) throw new Error(`Invalid schema name: ${name}`);
  return `"${name}"`;
}

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface CompanyRow {
  companyId: string;
  schema: string;
  name: string;
}

export async function ensureRegistry(db: Queryable): Promise<void> {
  await db.query(`create schema if not exists ${NO_COMPANY}`);
  await db.query('create schema if not exists ff');
  await db.query(`create table if not exists ff.companies (
    company_id uuid primary key,
    schema_name text not null unique,
    name text not null,
    created_at timestamptz not null default now()
  )`);
}

const cache = new Map<string, string>();

export async function schemaFor(db: Queryable, companyId: string | undefined | null): Promise<string | null> {
  if (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId)) return null;
  const hit = cache.get(companyId);
  if (hit) return hit;
  try {
    const { rows } = await db.query<{ schema_name: string }>('select schema_name from ff.companies where company_id = $1', [companyId]);
    if (!rows[0]) return null;
    cache.set(companyId, rows[0].schema_name);
    return rows[0].schema_name;
  } catch {
    return null; // registry not created yet: no companies
  }
}

export async function listCompanies(db: Queryable): Promise<CompanyRow[]> {
  const { rows } = await db.query<{ company_id: string; schema_name: string; name: string }>(
    'select company_id::text, schema_name, name from ff.companies order by created_at, schema_name',
  );
  return rows.map((r) => ({ companyId: r.company_id, schema: r.schema_name, name: r.name }));
}

export async function registerCompany(db: Queryable, row: CompanyRow): Promise<void> {
  quoteSchema(row.schema);
  await db.query(
    `insert into ff.companies (company_id, schema_name, name) values ($1, $2, $3)
     on conflict (company_id) do update set name = excluded.name`,
    [row.companyId, row.schema, row.name],
  );
  cache.delete(row.companyId);
}

interface JournalEntry {
  idx: number;
  tag: string;
}

/**
 * Applies the app's migrations (drizzle/*.sql, in journal order) to one company's schema. Drizzle-kit writes
 * `"public".` into foreign keys; those are rewritten to the company schema. Each migration runs in its own
 * transaction with the search path set to the schema, and is recorded in <schema>.__ff_migrations.
 * Returns the tags it applied.
 */
export async function migrateCompanySchema(pool: pg.Pool, schema: string): Promise<string[]> {
  const q = quoteSchema(schema);
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`create schema if not exists ${q}`);
    await client.query(`create table if not exists ${q}.__ff_migrations (tag text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await client.query<{ tag: string }>(`select tag from ${q}.__ff_migrations`);
    const done = new Set(rows.map((r) => r.tag));
    for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      if (done.has(entry.tag)) continue;
      const sqlText = readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').replaceAll('"public".', `${q}.`);
      await client.query('begin');
      try {
        await client.query(`set local search_path to ${q}`);
        for (const statement of sqlText.split('--> statement-breakpoint')) {
          if (statement.trim()) await client.query(statement);
        }
        await client.query(`insert into ${q}.__ff_migrations (tag) values ($1)`, [entry.tag]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${entry.tag} failed for ${schema}: ${(err as Error).message}`);
      }
      applied.push(entry.tag);
    }
  } finally {
    client.release();
  }
  return applied;
}
