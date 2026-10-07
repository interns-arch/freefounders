// Local PostgreSQL helpers: runs a real PostgreSQL server from npm (embedded-postgres), so nothing
// needs to be installed. Set DATABASE_URL to use your own server instead.
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '..');
// 5434 so it can run next to the Assets database (5433).
export const PG_PORT = Number(process.env.PG_PORT ?? 5434);
export const localUrl = (db) => `postgres://postgres:postgres@localhost:${PG_PORT}/${db}`;
export const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

async function canConnect() {
  const client = new pg.Client({ connectionString: localUrl('postgres'), connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** Starts the bundled PostgreSQL (data in ./.data/pg), or reuses one already listening. */
export async function startPostgres() {
  if (process.env.DATABASE_URL) return { external: true, stop: async () => {} };
  if (await canConnect()) return { external: true, stop: async () => {} };
  const dir = path.join(ROOT, '.data', 'pg');
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'],
    onLog: () => {},
    onError: (msg) => {
      const text = String(msg).trim();
      if (/\b(ERROR|FATAL|PANIC)\b/.test(text)) console.error(`[postgres] ${text}`);
    },
  });
  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
    console.log('• First run: initialising the local PostgreSQL database…');
    await server.initialise();
  }
  await server.start();
  return { external: false, stop: () => server.stop() };
}

export async function ensureDatabase(name, { recreate = false } = {}) {
  if (process.env.DATABASE_URL) return;
  const client = new pg.Client({ connectionString: localUrl('postgres') });
  await client.connect();
  try {
    if (recreate) await client.query(`drop database if exists "${name}" with (force)`);
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!exists.rowCount) await client.query(`create database "${name}" encoding 'UTF8' template template0`);
  } finally {
    await client.end();
  }
}

/** Runs a node script from the package and resolves when it exits successfully. */
export function run(args, { env = {}, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`))));
  });
}
