import { sql } from 'drizzle-orm';
import { type AnyPgColumn, boolean, customType, date, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Everything the Platform owns lives in its own Postgres schema. */
export const platform = pgSchema('platform');

export const APPS = ['tasks', 'assets'] as const;
export type AppKey = (typeof APPS)[number];

/** Phase 1 access levels; custom roles arrive in Phase 3. Owner = company Super Admin. */
export const PLATFORM_ROLES = ['owner', 'admin', 'member'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PERSON_STATUSES = ['active', 'inactive'] as const;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** A duty of a role: Tasks creates it as a task for every holder, each period (PLAN.md §17.3). */
export interface RoleDuty {
  id: string;
  title: string;
  description?: string | null;
  steps?: string[];
  /** once = when someone gets the role (joining checklist). */
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  /** weekly: 0 = Monday … 6 = Sunday */
  weekday?: number | null;
  /** monthly: 1-28 */
  monthDay?: number | null;
}

/** Per app, module key -> on/off. A module missing here counts as on (existing companies are unchanged). */
export type ModuleSwitches = Partial<Record<AppKey, Record<string, boolean>>>;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const companies = platform.table('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  enabledApps: text('enabled_apps').array().notNull().default(sql`'{}'::text[]`),
  /** Goes up on every role change; the apps ignore an older role set arriving late. */
  accessVersion: integer('access_version').notNull().default(0),
  status: text('status').notNull().default('active'),
  // Settings Center (Phase 4): branding and module switches, pushed to the apps (PUT /internal/company).
  shortName: text('short_name'),
  brandColour: text('brand_colour'),
  logo: bytea('logo'),
  logoType: text('logo_type'),
  modules: jsonb('modules').$type<ModuleSwitches>().notNull().default({}),
  /** Goes up on every profile change; like accessVersion, the apps ignore an older profile arriving late. */
  profileVersion: integer('profile_version').notNull().default(0),
  /** Same for the People directory (departments, reports-to, active), Phase 5. */
  peopleVersion: integer('people_version').notNull().default(0),
  /** Per app, the permission-catalogue version the company's roles are written in (missing = 1; PLAN.md §19.19). */
  accessUpgrades: jsonb('access_upgrades').$type<Record<string, number>>().notNull().default({}),
  ...timestamps,
});

/** The company's departments: one list for every app (Phase 5). `code` is how the apps know a department. */
export const departments = platform.table(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('departments_company_code_uq').on(t.companyId, t.code), uniqueIndex('departments_company_name_uq').on(t.companyId, sql`lower(${t.name})`)],
);

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
    // People directory (Phase 5): pushed to every app the person has.
    departmentId: uuid('department_id').references(() => departments.id),
    designation: text('designation'),
    reportsTo: uuid('reports_to').references((): AnyPgColumn => people.id),
    joinDate: date('join_date'),
    /** Set by "Start exit" (Phase 5); the person stays active until the exit is complete. */
    lastWorkingDate: date('last_working_date'),
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

// ─── Roles (Phase 3, PLAN.md §15) ────────────────────────────────────────────

/**
 * A company's roles, built in the portal. Each role has permissions in one or more apps (role_grants); a person can
 * hold several roles (person_roles). The apps get a copy on every change (/internal/access). `code` is how the apps
 * recognise roles they already had (Tasks' built-in role codes, Assets' original role names).
 */
export const roles = platform.table(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    colour: text('colour'),
    /** 1 member, 2 manager, 3 admin. */
    level: integer('level').notNull().default(1),
    /** The locked Owner role (Super Admin): every permission, always; cannot be edited or archived (§19.19). */
    system: boolean('system').notNull().default(false),
    /** Responsibilities (Phase 5): recurring duties and joining checklist, pushed to Tasks with the role. */
    duties: jsonb('duties').$type<RoleDuty[]>().notNull().default([]),
    archived: boolean('archived').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('roles_company_code_uq').on(t.companyId, t.code),
    uniqueIndex('roles_company_name_uq').on(t.companyId, sql`lower(${t.name})`),
  ],
);

export const roleGrants = platform.table(
  'role_grants',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    app: text('app').notNull(),
    permission: text('permission').notNull(),
    /** own / team / department / company for permissions with scopes; '' for yes/no permissions. */
    scope: text('scope').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.app, t.permission] })],
);

export const personRoles = platform.table(
  'person_roles',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.personId, t.roleId] })],
);

/** How far the Platform has read each app's outbox, per company (cross-app rules, PLAN.md §17.4). */
export const eventCursors = platform.table(
  'event_cursors',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    app: text('app').notNull(),
    lastId: integer('last_id').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.app] })],
);
