import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { databaseSsl, databaseUrl } from './db.service';
import { ensureRegistry, listCompanies, migrateCompanySchema, tenancyEnabled } from './tenancy';

export async function runMigrations(url = databaseUrl()) {
  const pool = new pg.Pool({ connectionString: url, ssl: databaseSsl(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
    // Multi-company mode: bring every company's schema up to date too.
    if (tenancyEnabled()) {
      await ensureRegistry(pool);
      for (const company of await listCompanies(pool)) {
        const applied = await migrateCompanySchema(pool, company.schema);
        if (applied.length) console.log(`✔ ${company.name} (${company.schema}): ${applied.length} migration(s)`);
      }
    }
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
