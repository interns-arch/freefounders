// Creates the first company and its owner login when the database is empty. Safe to run on every start.
//   node dist/seed.js            demo company for local development
//   node dist/seed.js --bootstrap  real install: COMPANY_NAME, COMPANY_CODE, OWNER_NAME, OWNER_EMAIL, OWNER_LOGIN, OWNER_PASSWORD
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { hashPassword } from './auth/auth.service';
import { databaseSsl, databaseUrl } from './db/db.service';
import * as schema from './db/schema';

export const DEMO = {
  companyName: 'Demo Company',
  companyCode: 'DEMO',
  ownerName: 'Demo Owner',
  ownerEmail: 'owner@freefounders.test',
  ownerLogin: 'owner',
  ownerPassword: 'Demo@1234',
};

export async function seed(bootstrap = false) {
  const pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const existing = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1);
    if (existing.length) return false;

    const env = (k: string) => process.env[k]?.trim() || undefined;
    const cfg = bootstrap
      ? {
          companyName: env('COMPANY_NAME'),
          companyCode: env('COMPANY_CODE'),
          ownerName: env('OWNER_NAME'),
          ownerEmail: env('OWNER_EMAIL')?.toLowerCase(),
          ownerLogin: env('OWNER_LOGIN'),
          ownerPassword: env('OWNER_PASSWORD'),
        }
      : DEMO;
    const missing = Object.entries(cfg)
      .filter(([k, v]) => !v && k !== 'ownerLogin')
      .map(([k]) => k);
    if (missing.length) throw new Error(`Bootstrap needs: ${missing.join(', ')}`);
    if (cfg.ownerPassword!.length < 8) throw new Error('OWNER_PASSWORD must be at least 8 characters');

    const apps = (env('COMPANY_APPS') ?? 'tasks,assets').split(',').map((a) => a.trim()).filter((a) => (schema.APPS as readonly string[]).includes(a));
    await db.transaction(async (tx) => {
      const [company] = await tx.insert(schema.companies).values({ name: cfg.companyName!, code: cfg.companyCode!.toUpperCase(), enabledApps: apps }).returning();
      const [owner] = await tx
        .insert(schema.people)
        .values({ companyId: company.id, fullName: cfg.ownerName!, email: cfg.ownerEmail!, platformRole: 'owner' })
        .returning();
      await tx.insert(schema.logins).values({ personId: owner.id, username: cfg.ownerLogin ?? null, passwordHash: await hashPassword(cfg.ownerPassword!) });
    });
    return true;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seed(process.argv.includes('--bootstrap'))
    .then((created) => console.log(created ? '✔ Company and owner created' : '• Company already exists, nothing to seed'))
    .catch((err) => {
      console.error('✖ Seed failed:', err.message);
      process.exit(1);
    });
}
