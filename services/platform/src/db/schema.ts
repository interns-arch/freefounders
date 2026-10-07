import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Everything the Platform owns lives in its own Postgres schema. */
export const platform = pgSchema('platform');

export const APPS = ['tasks', 'assets'] as const;
export type AppKey = (typeof APPS)[number];

/** Phase 1 access levels; custom roles arrive in Phase 3. Owner = company Super Admin. */
export const PLATFORM_ROLES = ['owner', 'admin', 'member'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PERSON_STATUSES = ['active', 'inactive'] as const;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const companies = platform.table('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  enabledApps: text('enabled_apps').array().notNull().default(sql`'{}'::text[]`),
  status: text('status').notNull().default('active'),
  ...timestamps,
});

export const people = platform.table(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    fullName: text('full_name').notNull(),
    employeeCode: text('employee_code'),
    email: text('email'),
    mobile: text('mobile'),
    platformRole: text('platform_role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    // Email signs you in, so it must point at exactly one person across all companies.
    uniqueIndex('people_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('people_company_code_uq').on(t.companyId, sql`lower(${t.employeeCode})`),
    index('people_company_idx').on(t.companyId),
  ],
);

/** Sign-in credentials. A person without a row here cannot sign in. Passwords are hashed only, never stored reversibly. */
export const logins = platform.table(
  'logins',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => people.id, { onDelete: 'cascade' }),
    username: text('username'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex('logins_username_uq').on(sql`lower(${t.username})`)],
);

/** Which apps a person can open, and who they are inside that app (the app's own user id). */
export const personApps = platform.table(
  'person_apps',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    app: text('app').notNull(),
    localUserId: text('local_user_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.app] })],
);

/**
 * Refresh sessions. Only the sha256 of the token is stored. Each refresh rotates the token: the old row is
 * marked `rotatedAt` and a new row joins the same `familyId`. Presenting a rotated token after the grace
 * period means it was copied, so the whole family is revoked.
 */
export const refreshSessions = platform.table(
  'refresh_sessions',
  {
    id: text('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    client: text('client').notNull().default('web'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_sessions_person_idx').on(t.personId), index('refresh_sessions_family_idx').on(t.familyId)],
);

/** Ed25519 signing keys. The private key is encrypted with PLATFORM_SECRET; public keys are published as JWKS. */
export const signingKeys = platform.table('signing_keys', {
  kid: text('kid').primaryKey(),
  publicJwk: jsonb('public_jwk').notNull(),
  privateEnc: text('private_enc').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
