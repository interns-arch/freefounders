import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ff_platform';
}

/** Remote Postgres needs TLS; the bundled local one does not. */
export function databaseSsl(): { rejectUnauthorized: boolean } | undefined {
  if (process.env.PGSSLMODE === 'disable') return undefined;
  const isLocal = /^postgres:\/\/[^@]+@(localhost|127\.0\.0\.1|\[::1\])/.test(databaseUrl());
  if (isLocal && process.env.PGSSLMODE !== 'require') return undefined;
  return { rejectUnauthorized: false };
}

/** Owns the pool. `db` is the transaction bound to the current async context, if any. */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: Number(process.env.DB_POOL_SIZE ?? 10) });
  readonly root: Database = drizzle(this.pool, { schema });
  private readonly als = new AsyncLocalStorage<Tx>();

  constructor() {
    this.pool.on('error', (err) => new Logger('Database').warn(`Idle connection error: ${err.message}`));
  }

  get db(): Executor {
    return this.als.getStore() ?? this.root;
  }

  /** Runs `fn` in a transaction, joining the current one if already inside one. */
  async tx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const current = this.als.getStore();
    if (current) return fn(current);
    return this.root.transaction((tx) => this.als.run(tx, () => fn(tx)));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
