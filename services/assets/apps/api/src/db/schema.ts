import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ALLOCATION_STATUSES,
  ASSET_STATUSES,
  CONDITIONS,
  EMPLOYEE_STATUSES,
  EXIT_CASE_STATUSES,
  EXIT_ITEM_STATUSES,
  FIELD_TYPES,
  HOLDER_TYPES,
  LOCATION_TYPES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  ONBOARDING_ITEM_STATUSES,
  ONBOARDING_STATUSES,
  OWNERSHIP_TYPES,
  PRIORITIES,
  RECON_SOURCES,
  REQUEST_STATUSES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TRACKING_MODES,
  type Attributes,
} from '@eam/shared';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

// ─── Organisation ───────────────────────────────────────────────────────────

export const companies = pgTable('companies', {
  id: pk(),
  name: text('name').notNull(),
  code: text('code').unique(),
  legalName: text('legal_name'),
  address: text('address'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const departments = pgTable(
  'departments',
  {
    id: pk(),
    name: text('name').notNull(),
    code: text('code').unique(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('departments_company_idx').on(t.companyId)],
);

export const locations = pgTable(
  'locations',
  {
    id: pk(),
    name: text('name').notNull(),
    code: text('code').unique(),
    type: text('type', { enum: LOCATION_TYPES }).notNull().default('OFFICE'),
    parentId: uuid('parent_id').references((): AnyPgColumn => locations.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    address: text('address'),
    isStore: boolean('is_store').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('locations_parent_idx').on(t.parentId)],
);

export const vendors = pgTable('vendors', {
  id: pk(),
  name: text('name').notNull(),
  code: text('code').unique(),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  address: text('address'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const employees = pgTable(
  'employees',
  {
    id: pk(),
    employeeCode: text('employee_code').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    fullName: text('full_name')
      .notNull()
      .generatedAlwaysAs(sql`trim(first_name || ' ' || coalesce(last_name, ''))`),
    // Official contact details; personal ones are kept separately.
    email: text('email').unique(),
    phone: text('phone'),
    personalEmail: text('personal_email'),
    personalPhone: text('personal_phone'),
    designation: text('designation'),
    assetsVerifiedAt: timestamp('assets_verified_at', { withTimezone: true }),
    assetsVerifiedByName: text('assets_verified_by_name'),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    managerId: uuid('manager_id').references((): AnyPgColumn => employees.id, { onDelete: 'set null' }),
    status: text('status', { enum: EMPLOYEE_STATUSES }).notNull().default('ACTIVE'),
    joinDate: date('join_date', { mode: 'string' }),
    noticeDate: date('notice_date', { mode: 'string' }),
    lastWorkingDate: date('last_working_date', { mode: 'string' }),
    exitDate: date('exit_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('employees_status_idx').on(t.status),
    index('employees_department_idx').on(t.departmentId),
    index('employees_name_idx').on(sql`lower(${t.fullName})`),
    uniqueIndex('employees_code_lower_idx').on(sql`lower(${t.employeeCode})`),
  ],
);

// ─── Access ─────────────────────────────────────────────────────────────────

export const roles = pgTable('roles', {
  id: pk(),
  name: text('name').notNull().unique(),
  description: text('description'),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: pk(),
  // Optional: employees without an email sign in with their employee code.
  email: text('email').unique(),
  /** Optional login ID chosen by IT (e.g. "amit.k"); matched case-insensitively. */
  username: text('username'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  employeeId: uuid('employee_id')
    .unique()
    .references(() => employees.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** Encrypted copy of the current password, so admins can look it up (see CredentialVault). */
  passwordSaved: text('password_saved'),
  passwordSavedAt: timestamp('password_saved_at', { withTimezone: true }),
  passwordSavedByName: text('password_saved_by_name'),
  /** The FreeFounders Platform person this login belongs to (set by /internal/provision). */
  platformPersonId: uuid('platform_person_id').unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`), uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)]);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ─── Catalog (dynamic asset structure) ─────────────────────────────────────

export const assetCategories = pgTable('asset_categories', {
  id: pk(),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  icon: text('icon'),
  color: text('color'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const assetTypes = pgTable(
  'asset_types',
  {
    id: pk(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    icon: text('icon'),
    description: text('description'),
    trackingMode: text('tracking_mode', { enum: TRACKING_MODES }).notNull().default('INDIVIDUAL'),
    /** Given away for good (joining kit, stationery): no custody, no return, not in exit checklists. */
    consumable: boolean('consumable').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('asset_types_category_name_uq').on(t.categoryId, t.name)],
);

export const fieldDefinitions = pgTable(
  'field_definitions',
  {
    id: pk(),
    categoryId: uuid('category_id').references(() => assetCategories.id, { onDelete: 'cascade' }),
    assetTypeId: uuid('asset_type_id').references(() => assetTypes.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: FIELD_TYPES }).notNull(),
    required: boolean('required').notNull().default(false),
    isUnique: boolean('is_unique').notNull().default(false),
    options: jsonb('options').$type<string[] | null>(),
    min: doublePrecision('min'),
    max: doublePrecision('max'),
    placeholder: text('placeholder'),
    helpText: text('help_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    showInTable: boolean('show_in_table').notNull().default(false),
    filterable: boolean('filterable').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('field_definitions_owner_ck', sql`(${t.categoryId} is null) <> (${t.assetTypeId} is null)`),
    uniqueIndex('field_definitions_category_key_uq').on(t.categoryId, t.key),
    uniqueIndex('field_definitions_type_key_uq').on(t.assetTypeId, t.key),
  ],
);

/** Atomic counters for asset tags (LAP-000001) and document numbers (EXIT-00001). */
/** Server-only settings, e.g. the key that encrypts saved passwords. Never sent to the browser. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const sequences = pgTable('sequences', {
  prefix: text('prefix').primaryKey(),
  lastValue: integer('last_value').notNull().default(0),
});

// ─── Assets & custody ───────────────────────────────────────────────────────

export const assets = pgTable(
  'assets',
  {
    id: pk(),
    assetTag: text('asset_tag').notNull().unique(),
    qrCode: text('qr_code').notNull().unique(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id),
    assetTypeId: uuid('asset_type_id')
      .notNull()
      .references(() => assetTypes.id),
    trackingMode: text('tracking_mode', { enum: TRACKING_MODES }).notNull().default('INDIVIDUAL'),
    status: text('status', { enum: ASSET_STATUSES }).notNull(),
    condition: text('condition', { enum: CONDITIONS }).notNull().default('GOOD'),
    quantity: integer('quantity').notNull().default(1),
    availableQuantity: integer('available_quantity').notNull().default(1),
    serialNumber: text('serial_number'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    description: text('description'),
    ownership: text('ownership', { enum: OWNERSHIP_TYPES }).notNull().default('OWNED'),
    ownerCompanyId: uuid('owner_company_id').references(() => companies.id, { onDelete: 'set null' }),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    purchaseDate: date('purchase_date', { mode: 'string' }),
    purchaseCost: money('purchase_cost'),
    currency: text('currency').notNull().default('INR'),
    invoiceNumber: text('invoice_number'),
    warrantyExpiry: date('warranty_expiry', { mode: 'string' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    // Current holder of an individually tracked asset (mirrors its ACTIVE allocation).
    holderType: text('holder_type', { enum: HOLDER_TYPES }),
    holderId: uuid('holder_id'),
    holderName: text('holder_name'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    attributes: jsonb('attributes').$type<Attributes>().notNull().default(sql`'{}'::jsonb`),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(asset_tag, '') || ' ' || coalesce(name, '') || ' ' || coalesce(serial_number, '')), 'A') || setweight(to_tsvector('simple', coalesce(manufacturer, '') || ' ' || coalesce(model, '') || ' ' || coalesce(holder_name, '')), 'B') || setweight(jsonb_to_tsvector('simple', attributes, '["string", "numeric"]'), 'C')`,
    ),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('assets_status_idx').on(t.status),
    index('assets_category_idx').on(t.categoryId),
    index('assets_type_idx').on(t.assetTypeId),
    index('assets_location_idx').on(t.locationId),
    index('assets_holder_idx').on(t.holderType, t.holderId),
    index('assets_created_idx').on(t.createdAt),
    index('assets_serial_idx').on(sql`lower(${t.serialNumber})`),
    index('assets_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
    index('assets_search_gin').using('gin', t.searchVector),
    check('assets_quantity_ck', sql`${t.availableQuantity} >= 0 and ${t.availableQuantity} <= ${t.quantity}`),
  ],
);

/** Custody records: the source of truth for who / what holds an asset, past and present. */
export const allocations = pgTable(
  'allocations',
  {
    id: pk(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    holderType: text('holder_type', { enum: HOLDER_TYPES }).notNull(),
    employeeId: uuid('employee_id').references(() => employees.id),
    departmentId: uuid('department_id').references(() => departments.id),
    locationId: uuid('location_id').references(() => locations.id),
    companyId: uuid('company_id').references(() => companies.id),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    holderName: text('holder_name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** True for individually tracked assets: at most one ACTIVE allocation may exist. */
    exclusive: boolean('exclusive').notNull().default(true),
    status: text('status', { enum: ALLOCATION_STATUSES }).notNull().default('ACTIVE'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by'),
    assignedByName: text('assigned_by_name'),
    expectedReturnDate: date('expected_return_date', { mode: 'string' }),
    notes: text('notes'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by'),
    endedByName: text('ended_by_name'),
    returnCondition: text('return_condition', { enum: CONDITIONS }),
    endNotes: text('end_notes'),
  },
  (t) => [
    uniqueIndex('allocations_one_active_uq').on(t.assetId).where(sql`status = 'ACTIVE' and exclusive`),
    index('allocations_asset_idx').on(t.assetId, t.status),
    index('allocations_employee_idx').on(t.employeeId, t.status),
    index('allocations_holder_idx').on(t.holderType, t.status),
    check(
      'allocations_holder_ck',
      sql`num_nonnulls(${t.employeeId}, ${t.departmentId}, ${t.locationId}, ${t.companyId}, ${t.vendorId}) = 1 and (
        (${t.holderType} = 'EMPLOYEE' and ${t.employeeId} is not null) or
        (${t.holderType} = 'DEPARTMENT' and ${t.departmentId} is not null) or
        (${t.holderType} = 'LOCATION' and ${t.locationId} is not null) or
        (${t.holderType} = 'COMPANY' and ${t.companyId} is not null) or
        (${t.holderType} = 'VENDOR' and ${t.vendorId} is not null) or
        (${t.holderType} = 'INVENTORY' and ${t.locationId} is not null))`,
    ),
  ],
);

export const PHOTO_KINDS = ['ASSET', 'HANDOVER', 'RETURN'] as const;

/** Photos of an asset: when added (ASSET, no assignment), handed over or returned. */
export const allocationPhotos = pgTable(
  'allocation_photos',
  {
    id: pk(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    allocationId: uuid('allocation_id').references(() => allocations.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PHOTO_KINDS }).notNull(),
    // Hosts like Render wipe the disk on every restart, so the image lives in the database.
    // Older rows have no data and are read from UPLOAD_DIR/file_name.
    data: bytea('data'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedBy: uuid('uploaded_by'),
    uploadedByName: text('uploaded_by_name'),
    createdAt: createdAt(),
  },
  (t) => [index('allocation_photos_alloc_idx').on(t.allocationId), index('allocation_photos_asset_idx').on(t.assetId)],
);

export const ownershipRecords = pgTable(
  'ownership_records',
  {
    id: pk(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    ownership: text('ownership', { enum: OWNERSHIP_TYPES }).notNull(),
    ownerCompanyId: uuid('owner_company_id').references(() => companies.id, { onDelete: 'set null' }),
    ownerCompanyName: text('owner_company_name'),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    vendorName: text('vendor_name'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    recordedBy: uuid('recorded_by'),
  },
  (t) => [index('ownership_asset_idx').on(t.assetId)],
);

// ─── Immutable history ──────────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  label?: string;
  from: unknown;
  to: unknown;
}

/** Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE. */
export const historyEvents = pgTable(
  'history_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    entityLabel: text('entity_label'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    changes: jsonb('changes').$type<FieldChange[]>(),
    assetId: uuid('asset_id'),
    employeeId: uuid('employee_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('history_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('history_asset_idx').on(t.assetId, t.occurredAt),
    index('history_employee_idx').on(t.employeeId, t.occurredAt),
    index('history_occurred_idx').on(t.occurredAt),
  ],
);

// ─── Employee exit ──────────────────────────────────────────────────────────

export const exitCases = pgTable(
  'exit_cases',
  {
    id: pk(),
    caseNumber: text('case_number').notNull().unique(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    status: text('status', { enum: EXIT_CASE_STATUSES }).notNull().default('OPEN'),
    noticeDate: date('notice_date', { mode: 'string' }),
    lastWorkingDate: date('last_working_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    initiatedBy: uuid('initiated_by'),
    initiatedByName: text('initiated_by_name'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByName: text('completed_by_name'),
    overridden: boolean('overridden').notNull().default(false),
    overrideReason: text('override_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('exit_cases_one_open_uq').on(t.employeeId).where(sql`status = 'OPEN'`),
    index('exit_cases_status_idx').on(t.status, t.lastWorkingDate),
  ],
);

export const exitItems = pgTable(
  'exit_items',
  {
    id: pk(),
    exitCaseId: uuid('exit_case_id')
      .notNull()
      .references(() => exitCases.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    allocationId: uuid('allocation_id').references(() => allocations.id, { onDelete: 'set null' }),
    assetTag: text('asset_tag'),
    assetName: text('asset_name').notNull(),
    assetTypeName: text('asset_type_name'),
    categoryName: text('category_name'),
    quantity: integer('quantity').notNull().default(1),
    status: text('status', { enum: EXIT_ITEM_STATUSES }).notNull().default('PENDING'),
    source: text('source', { enum: ['AUTO', 'MANUAL', 'ADDED_LATER'] }).notNull().default('AUTO'),
    notes: text('notes'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByName: text('resolved_by_name'),
    createdAt: createdAt(),
  },
  (t) => [
    index('exit_items_case_idx').on(t.exitCaseId),
    uniqueIndex('exit_items_allocation_uq').on(t.exitCaseId, t.allocationId),
    index('exit_items_allocation_idx').on(t.allocationId),
  ],
);

// ─── Requests, tickets, maintenance ─────────────────────────────────────────

export const assetRequests = pgTable(
  'asset_requests',
  {
    id: pk(),
    number: text('number').notNull().unique(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    requestedBy: uuid('requested_by'),
    requestedByName: text('requested_by_name'),
    // A catalog type, or — for anything not in the catalog — a free-text item name.
    assetTypeId: uuid('asset_type_id').references(() => assetTypes.id),
    itemName: text('item_name'),
    quantity: integer('quantity').notNull().default(1),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('MEDIUM'),
    neededBy: date('needed_by', { mode: 'string' }),
    reason: text('reason').notNull(),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('PENDING'),
    decidedByName: text('decided_by_name'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    fulfilledAssetId: uuid('fulfilled_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('requests_status_idx').on(t.status), index('requests_employee_idx').on(t.employeeId)],
);

export const tickets = pgTable(
  'tickets',
  {
    id: pk(),
    number: text('number').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    reportedBy: uuid('reported_by'),
    reportedByName: text('reported_by_name'),
    reporterEmployeeId: uuid('reporter_employee_id').references(() => employees.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type', { enum: TICKET_TYPES }).notNull().default('ISSUE'),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('MEDIUM'),
    status: text('status', { enum: TICKET_STATUSES }).notNull().default('OPEN'),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tickets_status_idx').on(t.status), index('tickets_asset_idx').on(t.assetId)],
);

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: pk(),
    number: text('number').notNull().unique(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    type: text('type', { enum: MAINTENANCE_TYPES }).notNull().default('REPAIR'),
    title: text('title').notNull(),
    description: text('description'),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    status: text('status', { enum: MAINTENANCE_STATUSES }).notNull().default('SCHEDULED'),
    scheduledDate: date('scheduled_date', { mode: 'string' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cost: money('cost'),
    resolution: text('resolution'),
    previousStatus: text('previous_status', { enum: ASSET_STATUSES }),
    createdBy: uuid('created_by'),
    createdByName: text('created_by_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('maintenance_asset_idx').on(t.assetId), index('maintenance_status_idx').on(t.status)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/** One uploaded dump (Airtel / Salary Box) checked against the register; only the matched columns are kept. */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: pk(),
    source: text('source', { enum: RECON_SOURCES }).notNull(),
    fileName: text('file_name').notNull(),
    rowCount: integer('row_count').notNull(),
    repairedRows: integer('repaired_rows').notNull().default(0),
    summary: jsonb('summary').$type<Record<string, number>>().notNull(),
    items: jsonb('items').$type<unknown[]>().notNull(),
    createdBy: uuid('created_by'),
    createdByName: text('created_by_name'),
    createdAt: createdAt(),
  },
  (t) => [index('reconciliation_runs_created_idx').on(t.source, t.createdAt)],
);

// ─── Onboarding (new joiners) ──────────────────────────────────────────────

export const onboardingCases = pgTable(
  'onboarding_cases',
  {
    id: pk(),
    caseNumber: text('case_number').notNull().unique(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    status: text('status', { enum: ONBOARDING_STATUSES }).notNull().default('DRAFT'),
    joinDate: date('join_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdByName: text('created_by_name'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByName: text('submitted_by_name'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByName: text('completed_by_name'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** Set when IT sends the plan back to HR; cleared when HR resends it. */
    returnNote: text('return_note'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByName: text('approved_by_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('onboarding_one_open_uq').on(t.employeeId).where(sql`status in ('DRAFT', 'SUBMITTED', 'APPROVED')`),
    index('onboarding_status_idx').on(t.status, t.joinDate),
  ],
);

export const onboardingItems = pgTable(
  'onboarding_items',
  {
    id: pk(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'cascade' }),
    assetTypeId: uuid('asset_type_id').references(() => assetTypes.id, { onDelete: 'set null' }),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    notes: text('notes'),
    status: text('status', { enum: ONBOARDING_ITEM_STATUSES }).notNull().default('PLANNED'),
    // Only a note of which asset IT means to give — it is not reserved.
    preparedAssetId: uuid('prepared_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    preparedByName: text('prepared_by_name'),
    allocationId: uuid('allocation_id').references(() => allocations.id, { onDelete: 'set null' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedByName: text('issued_by_name'),
    skipReason: text('skip_reason'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('onboarding_items_case_idx').on(t.caseId, t.sortOrder)],
);

/** Saved lists of what a role usually gets (e.g. "Field Sales Executive"). */
export const onboardingKits = pgTable('onboarding_kits', {
  id: pk(),
  name: text('name').notNull().unique(),
  items: jsonb('items').$type<{ assetTypeId: string | null; itemName: string | null; quantity: number; notes: string | null }[]>().notNull(),
  createdByName: text('created_by_name'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
