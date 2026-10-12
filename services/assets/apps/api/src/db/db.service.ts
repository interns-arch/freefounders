import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { asc, desc } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';
import { NO_COMPANY, quoteSchema, tenancyEnabled } from './tenancy';

// Return DATE columns as 'YYYY-MM-DD' strings and COUNT(*) as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/eam';
}

/**
 * Remote Postgres (Render, Supabase, RDS, ...) needs TLS; the bundled local one does not.
 * PGSSLMODE=verify-full (recommended in production) also checks the server's certificate, against the CA file in
 * PGSSLROOTCERT when set (e.g. the RDS bundle), else the system's trusted CAs. Without it the connection is encrypted
 * but the certificate is not checked (the earlier behaviour).
 */
export function databaseSsl(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  const mode = process.env.PGSSLMODE;
  if (mode === 'disable') return undefined;
  if (mode === 'verify-full' || mode === 'verify-ca') {
    const caFile = process.env.PGSSLROOTCERT;
    return { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) };
  }
  const url = databaseUrl();
  const isLocal = /^postgres:\/\/[^@]+@(localhost|127\.0\.0\.1|\[::1\])/.test(url);
  if (isLocal && mode !== 'require') return undefined;
  return { rejectUnauthorized: false };
}

interface Bound {
  exec: Executor;
  inTx: boolean;
  /** The company schema this work runs in (multi-company mode), else null. */
  schema: string | null;
}

/**
 * Owns the connection pool. `db` returns the transaction (or, in multi-company mode, the company-pinned
 * connection) bound to the current async context, so services can call each other inside one transaction
 * without passing it around.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  // Multi-company mode: a connection that is not pinned to a company sees only the empty ff_none schema.
  readonly pool = new pg.Pool({
    connectionString: databaseUrl(),
    ssl: databaseSsl(),
    max: Number(process.env.DB_POOL_SIZE ?? 20),
    ...(tenancyEnabled() ? { options: `-c search_path=${NO_COMPANY}` } : {}),
  });
  readonly root: Database = drizzle(this.pool, { schema });
  private readonly als = new AsyncLocalStorage<Bound>();

  constructor() {
    // An idle connection can be dropped (DB restart, failover). Log it; the pool reconnects on next use.
    this.pool.on('error', (err) => new Logger('Database').warn(`Idle connection error: ${err.message}`));
  }

  get db(): Executor {
    return this.als.getStore()?.exec ?? this.root;
  }

  get inTransaction(): boolean {
    return this.als.getStore()?.inTx ?? false;
  }

  /** The company schema the current work runs in (multi-company mode), else null. */
  get companySchema(): string | null {
    return this.als.getStore()?.schema ?? null;
  }

  /** Runs `fn` in a transaction, joining the current one if already inside a transaction. */
  async tx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const current = this.als.getStore();
    if (current?.inTx) return fn(current.exec);
    const base = (current?.exec ?? this.root) as Database;
    return base.transaction((tx) => this.als.run({ exec: tx, inTx: true, schema: current?.schema ?? null }, () => fn(tx)));
  }

  /**
   * Multi-company mode: takes one connection, points it at `schemaName` only, and runs `fn` (and everything it
   * starts) on it. Returns a release function the caller must call when the work is finished (for a request:
   * when the response closes). The connection is pointed back at ff_none before it returns to the pool.
   */
  async bindCompany(schemaName: string, fn: () => void): Promise<() => void> {
    const client = await this.pool.connect();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      client
        .query(`set search_path to ${NO_COMPANY}`)
        .then(() => client.release())
        .catch((err: Error) => client.release(err));
    };
    try {
      await client.query(`set search_path to ${quoteSchema(schemaName)}`);
    } catch (err) {
      release();
      throw err;
    }
    this.als.run({ exec: drizzle(client, { schema }), inTx: false, schema: schemaName }, fn);
    return release;
  }

  /** Runs `fn` to completion inside one company's schema (workers, scripts, internal setup). */
  async inCompany<T>(schemaName: string, fn: () => Promise<T>): Promise<T> {
    let result!: Promise<T>;
    const release = await this.bindCompany(schemaName, () => {
      result = fn();
    });
    try {
      return await result;
    } finally {
      release();
    }
  }

  /** The system runs for a single company; records created without one belong to it. */
  async defaultCompanyId(): Promise<string | null> {
    const [row] = await this.db.select({ id: schema.companies.id }).from(schema.companies).orderBy(asc(schema.companies.createdAt)).limit(1);
    return row?.id ?? null;
  }

  /** The company's store for anything "in store"; created on first use if there is none. */
  async defaultStoreId(): Promise<string> {
    const [store] = await this.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .orderBy(desc(schema.locations.isStore), asc(schema.locations.createdAt))
      .limit(1);
    if (store) return store.id;
    const [created] = await this.db.insert(schema.locations).values({ name: 'Main store', type: 'WAREHOUSE', isStore: true }).returning({ id: schema.locations.id });
    return created.id;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
