// Creates the first company and its owner login when the database is empty. Safe to run on every start.
//   node dist/seed.js            demo company for local development, plus the dev staff account (below)
//   node dist/seed.js --bootstrap  real install: COMPANY_NAME, COMPANY_CODE, OWNER_NAME, OWNER_EMAIL, OWNER_LOGIN, OWNER_PASSWORD
//                                  (+ optional STAFF_EMAIL, STAFF_PASSWORD: a Kaampilot staff account for /console)
import { and, eq, sql } from 'drizzle-orm';
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
 * Dev staff account (test values, public like the demo password): an account (PLAN.md §21) marked Kaampilot staff,
 * a member of the demo company without apps, so it can sign in and open the owner console (/console).
 * Never on a real install; there, sign up and run `npm run company -- staff --email <e>`.
 */
export const DEV_STAFF = { email: 'staff@freefounders.test', password: 'Demo@1234', fullName: 'Kaampilot Staff (dev)' };

export async function seedStaff(staff = DEV_STAFF, companyCode = DEMO.companyCode, bootstrap = false): Promise<boolean> {
  // The dev staff password is public (it is in this file): a real install passes its own (--bootstrap, STAFF_*).
  if (!bootstrap && process.env.NODE_ENV === 'production') return false;
  const pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const [demo] = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.code, companyCode.toUpperCase())).limit(1);
    if (!demo) return false;
    const email = staff.email.trim().toLowerCase();
    const [existing] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(sql`lower(${schema.accounts.email}) = ${email}`).limit(1);
    if (existing) {
      // Dev databases seeded before the Kaampilot rename still show the old visible name: fix it once.
      if (!bootstrap) {
        await db.update(schema.accounts).set({ fullName: staff.fullName }).where(and(eq(schema.accounts.id, existing.id), eq(schema.accounts.fullName, 'FreeFounders Staff (dev)')));
        await db.update(schema.people).set({ fullName: staff.fullName }).where(and(eq(schema.people.accountId, existing.id), eq(schema.people.fullName, 'FreeFounders Staff (dev)')));
      }
      return false;
    }
    await db.transaction(async (tx) => {
      const [account] = await tx
        .insert(schema.accounts)
        .values({ email, fullName: staff.fullName, passwordHash: await hashPassword(staff.password), isStaff: true })
        .returning();
      await tx.insert(schema.people).values({ companyId: demo.id, fullName: staff.fullName, email, platformRole: 'member', accountId: account.id });
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
      const staffEmail = process.env.STAFF_EMAIL?.trim();
      const staffPassword = process.env.STAFF_PASSWORD?.trim();
      const code = process.env.COMPANY_CODE?.trim();
      if (bootstrap && staffEmail && staffPassword && code) {
        if (staffPassword.length < 12) throw new Error('STAFF_PASSWORD must be at least 12 characters');
        const staff = { email: staffEmail, password: staffPassword, fullName: process.env.STAFF_NAME?.trim() || 'Kaampilot Staff' };
        if (await seedStaff(staff, code, true)) console.log(`✔ Staff account ${staffEmail} created (owner console)`);
      }
    })
    .catch((err) => {
      console.error('✖ Seed failed:', err.message);
      process.exit(1);
    });
}
