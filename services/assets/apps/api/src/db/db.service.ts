import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { asc, desc } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

// Return DATE columns as 'YYYY-MM-DD' strings and COUNT(*) as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/eam';
}

/** Remote Postgres (Render, Supabase, RDS, ...) needs TLS; the bundled local one does not. */
export function databaseSsl(): { rejectUnauthorized: boolean } | undefined {
  if (process.env.PGSSLMODE === 'disable') return undefined;
  const url = databaseUrl();
  const isLocal = /^postgres:\/\/[^@]+@(localhost|127\.0\.0\.1|\[::1\])/.test(url);
  if (isLocal && process.env.PGSSLMODE !== 'require') return undefined;
  return { rejectUnauthorized: false };
}

/**
 * Owns the connection pool. `db` returns the transaction bound to the current async context
 * (if any), so services can call each other inside one transaction without passing it around.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: Number(process.env.DB_POOL_SIZE ?? 20) });
  readonly root: Database = drizzle(this.pool, { schema });
  private readonly als = new AsyncLocalStorage<Tx>();

  constructor() {
    // An idle connection can be dropped (DB restart, failover). Log it; the pool reconnects on next use.
    this.pool.on('error', (err) => new Logger('Database').warn(`Idle connection error: ${err.message}`));
  }

  get db(): Executor {
    return this.als.getStore() ?? this.root;
  }

  get inTransaction(): boolean {
    return this.als.getStore() !== undefined;
  }

  /** Runs `fn` in a transaction, joining the current one if already inside a transaction. */
  async tx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const current = this.als.getStore();
    if (current) return fn(current);
    return this.root.transaction((tx) => this.als.run(tx, () => fn(tx)));
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
