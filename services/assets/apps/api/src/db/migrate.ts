import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { databaseSsl, databaseUrl } from './db.service';

export async function runMigrations(url = databaseUrl()) {
  const pool = new pg.Pool({ connectionString: url, ssl: databaseSsl(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => console.log('✔ Database migrated'))
    .catch((err) => {
      console.error('✖ Migration failed', err);
      process.exit(1);
    });
}
