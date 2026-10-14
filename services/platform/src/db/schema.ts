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

/**
 * A person's global identity (PLAN.md §21): email and/or Indian mobile (+91…), one password, in any number of companies.
 * Each company membership is a `people` row with `account_id` set. Admin-made logins (`logins`) keep working beside it.
 */
export const accounts = platform.table(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    mobile: text('mobile'),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** FreeFounders staff: the owner console (/console). */
    isStaff: boolean('is_staff').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('accounts_email_uq').on(sql`lower(${t.email})`), uniqueIndex('accounts_mobile_uq').on(t.mobile)],
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
    /** The account this membership belongs to (PLAN.md §21); null for admin-made people. */
    accountId: uuid('account_id').references(() => accounts.id),
    ...timestamps,
  },
  (t) => [
    // An admin-made person's email signs them in, so it points at exactly one such person across all companies. People
    // who belong to an account sign in through the account; their email is unique inside their company only.
    uniqueIndex('people_email_uq').on(sql`lower(${t.email})`).where(sql`account_id is null`),
    uniqueIndex('people_company_email_uq').on(t.companyId, sql`lower(${t.email})`),
    uniqueIndex('people_company_account_uq').on(t.companyId, t.accountId),
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

// ─── Sign-up, invites and billing (PLAN.md §21) ──────────────────────────────

/** One-time codes. Only the sha256 of the code is stored; 10 minutes, at most 5 tries, used once. */
export const otpCodes = platform.table(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    target: text('target').notNull(),
    channel: text('channel').notNull(),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_codes_target_idx').on(t.target, t.createdAt), index('otp_codes_ip_idx').on(t.ip, t.createdAt)],
);

/**
 * Short-lived proofs, stored as sha256 only: `signup` (the identifier was verified by a code, 30 min) and `login`
 * (an account gave its password and now picks a company, 5 min). Each is used once.
 */
export const authTickets = platform.table('auth_tickets', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  target: text('target'),
  channel: text('channel'),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Invite links (only the sha256 of the token is stored). */
export const invites = platform.table(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    tokenHash: text('token_hash').notNull().unique(),
    roleIds: uuid('role_ids').array().notNull().default(sql`'{}'::uuid[]`),
    apps: text('apps').array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invites_company_idx').on(t.companyId)],
);

/** What can be bought. Prices in paise per seat; `offered` = shown on the Billing page. */
export const plans = platform.table('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  apps: text('apps').array().notNull().default(sql`'{}'::text[]`),
  priceMonthly: integer('price_monthly').notNull().default(0),
  priceYearly: integer('price_yearly').notNull().default(0),
  minSeats: integer('min_seats').notNull().default(1),
  /** null = no limit */
  maxSeats: integer('max_seats'),
  offered: boolean('offered').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

/** One per company. States: trialing, active, cancelled, past_due, read_only, suspended (PLAN.md §21.1). */
export const subscriptions = platform.table('subscriptions', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id),
  plan: text('plan')
    .notNull()
    .references(() => plans.code),
  interval: text('interval').notNull().default('month'),
  state: text('state').notNull(),
  /** Since when (company clock) the subscription is in `state`: past_due → read_only after 7 days, read_only → suspended after 30. */
  stateSince: timestamp('state_since', { withTimezone: true }).notNull().defaultNow(),
  /** Paid seats (paid plans). */
  seats: integer('seats').notNull().default(0),
  /** A decrease waits for the next period. */
  nextPeriodSeats: integer('next_period_seats'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  /** Dev tools only: the company's billing clock runs this many days ahead. */
  clockOffsetDays: integer('clock_offset_days').notNull().default(0),
  ...timestamps,
});

export interface InvoiceLineInput {
  description: string;
  sac: string;
  quantity: number;
  /** paise */
  unitPrice: number;
  /** paise; negative for a credit */
  amount: number;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface GstParty {
  name: string;
  gstin: string | null;
  state: string;
  address: string | null;
  email?: string | null;
}

/** A purchase started on the Billing page and paid (or not) on the gateway's page. */
export const checkoutSessions = platform.table(
  'checkout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    gateway: text('gateway').notNull(),
    plan: text('plan')
      .notNull()
      .references(() => plans.code),
    interval: text('interval').notNull(),
    seats: integer('seats').notNull(),
    lines: jsonb('lines').$type<InvoiceLineInput[]>().notNull().default([]),
    subtotal: integer('subtotal').notNull(),
    cgst: integer('cgst').notNull().default(0),
    sgst: integer('sgst').notNull().default(0),
    igst: integer('igst').notNull().default(0),
    total: integer('total').notNull(),
    /** open, paid, failed, cancelled */
    status: text('status').notNull().default('open'),
    createdBy: uuid('created_by').references(() => people.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('checkout_sessions_company_idx').on(t.companyId)],
);

/** GST tax invoices: one number series per financial year (April–March), e.g. FF/2026-27/000001. */
export const invoices = platform.table(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    number: text('number').notNull().unique(),
    financialYear: text('financial_year').notNull(),
    seq: integer('seq').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    seller: jsonb('seller').$type<GstParty>().notNull(),
    buyer: jsonb('buyer').$type<GstParty>().notNull(),
    placeOfSupply: text('place_of_supply').notNull(),
    subtotal: integer('subtotal').notNull(),
    cgst: integer('cgst').notNull().default(0),
    sgst: integer('sgst').notNull().default(0),
    igst: integer('igst').notNull().default(0),
    total: integer('total').notNull(),
    status: text('status').notNull().default('paid'),
    checkoutSessionId: uuid('checkout_session_id').references(() => checkoutSessions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoices_fy_seq_uq').on(t.financialYear, t.seq), index('invoices_company_idx').on(t.companyId)],
);

export const invoiceLines = platform.table('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  description: text('description').notNull(),
  sac: text('sac').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
  amount: integer('amount').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
});

/** Last invoice number used per financial year (taken atomically). */
export const invoiceCounters = platform.table('invoice_counters', {
  financialYear: text('financial_year').primaryKey(),
  last: integer('last').notNull().default(0),
});

export const payments = platform.table(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    checkoutSessionId: uuid('checkout_session_id').references(() => checkoutSessions.id),
    gateway: text('gateway').notNull(),
    gatewayPaymentId: text('gateway_payment_id'),
    amount: integer('amount').notNull(),
    /** captured, failed */
    status: text('status').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_company_idx').on(t.companyId)],
);

/** Gateway webhooks, stored once by event id: a repeated delivery is ignored. */
export const billingEvents = platform.table(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gateway: text('gateway').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('billing_events_gateway_event_uq').on(t.gateway, t.eventId)],
);

/** The buyer's GST details for invoices. */
export const billingProfiles = platform.table('billing_profiles', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id),
  legalName: text('legal_name').notNull(),
  gstin: text('gstin'),
  state: text('state').notNull(),
  address: text('address'),
  email: text('email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Seats added mid-period: charged pro rata on the next invoice. */
export const seatChanges = platform.table(
  'seat_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    seatsFrom: integer('seats_from').notNull(),
    seatsTo: integer('seats_to').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    /** paise, before GST */
    amount: integer('amount').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('seat_changes_company_idx').on(t.companyId)],
);
