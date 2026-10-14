// Creates the first company and its owner login when the database is empty. Safe to run on every start.
//   node dist/seed.js            demo company for local development, plus the dev staff account (below)
//   node dist/seed.js --bootstrap  real install: COMPANY_NAME, COMPANY_CODE, OWNER_NAME, OWNER_EMAIL, OWNER_LOGIN, OWNER_PASSWORD
import { eq, sql } from 'drizzle-orm';
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

/**
 * Dev staff account (test values, public like the demo password): an account (PLAN.md §21) marked FreeFounders staff,
 * a member of the demo company without apps, so it can sign in and open the owner console (/console).
 * Never on a real install; there, sign up and run `npm run company -- staff --email <e>`.
 */
export const DEV_STAFF = { email: 'staff@freefounders.test', password: 'Demo@1234', fullName: 'FreeFounders Staff (dev)' };

export async function seedStaff(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return false;
  const pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const [demo] = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.code, DEMO.companyCode)).limit(1);
    if (!demo) return false;
    const [existing] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(sql`lower(${schema.accounts.email}) = ${DEV_STAFF.email}`).limit(1);
    if (existing) return false;
    await db.transaction(async (tx) => {
      const [account] = await tx
        .insert(schema.accounts)
        .values({ email: DEV_STAFF.email, fullName: DEV_STAFF.fullName, passwordHash: await hashPassword(DEV_STAFF.password), isStaff: true })
        .returning();
      await tx.insert(schema.people).values({ companyId: demo.id, fullName: DEV_STAFF.fullName, email: DEV_STAFF.email, platformRole: 'member', accountId: account.id });
    });
    return true;
  } finally {
    await pool.end();
  }
}

export async function seed(bootstrap = false) {
  // The demo owner's password is public (it is in this file): never on a real install.
  if (!bootstrap && process.env.NODE_ENV === 'production') throw new Error('The demo company is for development only; use --bootstrap on a real install');
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
    if (cfg.ownerPassword!.length < 6) throw new Error('OWNER_PASSWORD must be at least 6 characters');

    const apps = (env('COMPANY_APPS') ?? 'tasks,assets').split(',').map((a) => a.trim()).filter((a) => (schema.APPS as readonly string[]).includes(a));
    await db.transaction(async (tx) => {
      const [company] = await tx.insert(schema.companies).values({ name: cfg.companyName!, code: cfg.companyCode!.toUpperCase(), enabledApps: apps }).returning();
      const [owner] = await tx
        .insert(schema.people)
        .values({ companyId: company.id, fullName: cfg.ownerName!, email: cfg.ownerEmail!, platformRole: 'owner' })
        .returning();
      await tx.insert(schema.logins).values({ personId: owner.id, username: cfg.ownerLogin ?? null, passwordHash: await hashPassword(cfg.ownerPassword!) });
      // The first company of an install is ours, not sold through sign-up: no billing (PLAN.md §21).
      await tx.insert(schema.subscriptions).values({ companyId: company.id, plan: 'complimentary', state: 'active' }).onConflictDoNothing();
    });
    return true;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const bootstrap = process.argv.includes('--bootstrap');
  seed(bootstrap)
    .then(async (created) => {
      console.log(created ? '✔ Company and owner created' : '• Company already exists, nothing to seed');
      if (!bootstrap && (await seedStaff())) console.log(`✔ Dev staff account ${DEV_STAFF.email} created (owner console)`);
    })
    .catch((err) => {
      console.error('✖ Seed failed:', err.message);
      process.exit(1);
    });
}
