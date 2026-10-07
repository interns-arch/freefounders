import { z } from 'zod';
import {
  CONDITIONS,
  EMPLOYEE_STATUSES,
  EXIT_ITEM_STATUSES,
  HOLDER_TYPES,
  INITIAL_ASSET_STATUSES,
  LOCATION_TYPES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  OWNERSHIP_TYPES,
  PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TRACKING_MODES,
} from './enums';
import { DATE_RE, FIELD_KEY_RE, FIELD_TYPES } from './fields';
import { LIFECYCLE_ACTIONS } from './lifecycle';
import { ALL_PERMISSIONS } from './permissions';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Required, trimmed string. */
export const reqText = (max = 200) => z.string({ message: 'Required' }).trim().min(1, 'Required').max(max, 'Too long');
/** Optional string; blank becomes null. */
export const optText = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max, 'Too long').nullable().optional());
export const optId = z.preprocess(blankToNull, z.string().uuid('Invalid id').nullable().optional());
export const reqId = z.string({ message: 'Required' }).uuid('Required');
export const optDate = z.preprocess(blankToNull, z.string().regex(DATE_RE, 'Invalid date').nullable().optional());
export const reqDate = z.string({ message: 'Required' }).regex(DATE_RE, 'Required');
export const optEmail = z.preprocess(blankToNull, z.string().trim().toLowerCase().email('Invalid email').nullable().optional());
/** Registers often write "NA" for a missing phone or email; treat it as empty. */
const naToNull = (v: unknown) => (typeof v === 'string' && /^\s*(n\/?a|-+)\s*$/i.test(v) ? null : blankToNull(v));
const contactEmail = z.preprocess(naToNull, z.string().trim().toLowerCase().email('Invalid email').nullable().optional());
const contactPhone = z.preprocess(naToNull, z.string().trim().max(40, 'Too long').nullable().optional());
export const optNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
  z.number({ message: 'Must be a number' }).finite('Must be a number').nullable().optional(),
);
const code = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Letters, numbers, - and _ only (max 20)')
    .nullable()
    .optional(),
);

// ─── Auth ───────────────────────────────────────────────────────────────────
/** Sign in with an email address or an employee code (e.g. CT000099). */
export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your login ID, employee ID or email').max(200),
  password: z.string().min(1, 'Enter your password'),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'At least 8 characters').max(200),
});

// ─── Organisation ───────────────────────────────────────────────────────────
export const companySchema = z.object({
  name: reqText(150),
  code,
  legalName: optText(200),
  address: optText(500),
});
export const departmentSchema = z.object({
  name: reqText(150),
  code,
  companyId: optId,
  parentId: optId,
});
export const locationSchema = z.object({
  name: reqText(150),
  code,
  type: z.enum(LOCATION_TYPES).default('OFFICE'),
  parentId: optId,
  companyId: optId,
  address: optText(500),
  isStore: z.boolean().default(false),
});
export const vendorSchema = z.object({
  name: reqText(150),
  code,
  contactName: optText(150),
  email: optEmail,
  phone: optText(40),
  website: optText(300),
  address: optText(500),
  notes: optText(2000),
});

export const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'Required').max(40).toUpperCase(),
  firstName: reqText(100),
  lastName: optText(100),
  email: contactEmail,
  phone: contactPhone,
  personalEmail: contactEmail,
  personalPhone: contactPhone,
  designation: optText(120),
  companyId: optId,
  departmentId: optId,
  locationId: optId,
  managerId: optId,
  joinDate: optDate,
  notes: optText(2000),
});
export const employeeStatusSchema = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES).refine((s) => s !== 'JOINING', 'New joiners are added through Onboarding'),
    lastWorkingDate: optDate,
    noticeDate: optDate,
    reason: optText(1000),
  })
  .refine((v) => v.status !== 'NOTICE_PERIOD' || !!v.lastWorkingDate, {
    message: 'Last working date is required for notice period',
    path: ['lastWorkingDate'],
  });

// ─── Catalog ────────────────────────────────────────────────────────────────
export const categorySchema = z.object({
  name: reqText(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '2–10 letters or numbers'),
  icon: optText(50),
  color: optText(20),
  description: optText(500),
});
export const assetTypeSchema = z.object({
  categoryId: reqId,
  name: reqText(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '2–10 letters or numbers (used as the tag prefix)'),
  icon: optText(50),
  description: optText(500),
  trackingMode: z.enum(TRACKING_MODES).default('INDIVIDUAL'),
  /** One-time items (joining kit, stationery): given away, never returned. Quantity tracking only. */
  consumable: z.boolean().default(false),
});
export const fieldDefinitionSchema = z
  .object({
    categoryId: optId,
    assetTypeId: optId,
    label: reqText(80),
    key: z.preprocess(blankToNull, z.string().regex(FIELD_KEY_RE, 'lowercase letters, numbers and _').nullable().optional()),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    isUnique: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(200).nullable().optional(),
    min: optNumber,
    max: optNumber,
    placeholder: optText(120),
    helpText: optText(300),
    showInTable: z.boolean().default(false),
    filterable: z.boolean().default(true),
  })
  .refine((v) => !!v.categoryId !== !!v.assetTypeId, {
    message: 'A field belongs to either a category or an asset type',
    path: ['assetTypeId'],
  })
  .refine((v) => !['select', 'multiselect'].includes(v.type) || (v.options && v.options.length > 0), {
    message: 'Add at least one option',
    path: ['options'],
  });
export const fieldUpdateSchema = z.object({
  label: reqText(80).optional(),
  required: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(200).nullable().optional(),
  min: optNumber,
  max: optNumber,
  placeholder: optText(120),
  helpText: optText(300),
  showInTable: z.boolean().optional(),
  filterable: z.boolean().optional(),
});
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

// ─── Assets ─────────────────────────────────────────────────────────────────
const needsHolder = (v: { holderType: string; holderId?: string | null }) => v.holderType === 'INVENTORY' || !!v.holderId;
const holderMessage = { message: 'Choose who receives it', path: ['holderId'] };

/** One branch: "In store" needs no location — the company store is used. */
export const holderRefSchema = z
  .object({
    holderType: z.enum(HOLDER_TYPES),
    holderId: optId,
  })
  .refine(needsHolder, holderMessage);

const assetCore = {
  name: reqText(200),
  condition: z.enum(CONDITIONS).default('GOOD'),
  serialNumber: optText(120),
  manufacturer: optText(120),
  model: optText(120),
  description: optText(2000),
  ownership: z.enum(OWNERSHIP_TYPES).default('OWNED'),
  ownerCompanyId: optId,
  vendorId: optId,
  purchaseDate: optDate,
  purchaseCost: optNumber,
  currency: z.preprocess(blankToNull, z.string().length(3).toUpperCase().nullable().optional()),
  invoiceNumber: optText(120),
  warrantyExpiry: optDate,
  locationId: optId,
  attributes: z.record(z.string(), z.unknown()).default({}),
};

export const assetCreateSchema = z.object({
  assetTypeId: reqId,
  ...assetCore,
  status: z.enum(INITIAL_ASSET_STATUSES).default('AVAILABLE'),
  quantity: z.coerce.number().int().min(1).max(1_000_000).default(1),
  assignTo: holderRefSchema.nullable().optional(),
});
export const assetUpdateSchema = z.object({
  ...assetCore,
  name: reqText(200).optional(),
  condition: z.enum(CONDITIONS).optional(),
  ownership: z.enum(OWNERSHIP_TYPES).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).optional(),
  version: z.number().int(),
});

const assignFields = z.object({
  holderType: z.enum(HOLDER_TYPES),
  holderId: optId,
  quantity: z.coerce.number().int().min(1).default(1),
  expectedReturnDate: optDate,
  notes: optText(1000),
});
export const assignSchema = assignFields.refine(needsHolder, holderMessage);
export const transferSchema = assignFields.extend({ allocationId: optId }).refine(needsHolder, holderMessage);
export const returnSchema = z.object({
  allocationId: optId,
  condition: z.enum(CONDITIONS).default('GOOD'),
  makeAvailable: z.boolean().default(true),
  notes: optText(1000),
});
export const lifecycleSchema = z.object({
  action: z.enum(LIFECYCLE_ACTIONS),
  notes: optText(1000),
  locationId: optId,
});
export const bulkAssetSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one asset').max(200, 'At most 200 at a time'),
  action: z.enum(['assign', 'lifecycle', 'move_location']),
  holderType: z.enum(HOLDER_TYPES).optional(),
  holderId: optId,
  lifecycleAction: z.enum(LIFECYCLE_ACTIONS).optional(),
  locationId: optId,
  notes: optText(1000),
});

// ─── Exit ───────────────────────────────────────────────────────────────────
export const exitItemUpdateSchema = z.object({
  status: z.enum(EXIT_ITEM_STATUSES),
  notes: optText(1000),
});
export const exitManualItemSchema = z.object({
  assetName: reqText(200),
  notes: optText(1000),
});
export const exitOverrideSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why (at least 10 characters)').max(2000),
});
export const exitCancelSchema = z.object({ reason: optText(1000) });
export const exitScanSchema = z.object({ code: reqText(300) });

// ─── Requests / tickets / maintenance ───────────────────────────────────────
/** Request a catalog type, or describe anything else in your own words. */
export const requestSchema = z
  .object({
    employeeId: optId,
    assetTypeId: optId,
    itemName: optText(150),
    quantity: z.coerce.number().int().min(1).max(1000).default(1),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    neededBy: optDate,
    reason: reqText(2000),
  })
  .refine((v) => !!v.assetTypeId || !!v.itemName, { message: 'Choose what you need or type it', path: ['assetTypeId'] });
export const requestDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: optText(1000),
});
export const requestFulfilSchema = z.object({ assetId: reqId, notes: optText(1000) });

export const ticketSchema = z.object({
  title: reqText(200),
  description: optText(5000),
  assetId: optId,
  type: z.enum(TICKET_TYPES).default('ISSUE'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
});
export const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: optId,
  resolution: optText(5000),
});

export const maintenanceSchema = z.object({
  assetId: reqId,
  type: z.enum(MAINTENANCE_TYPES).default('REPAIR'),
  title: reqText(200),
  description: optText(5000),
  vendorId: optId,
  scheduledDate: optDate,
  cost: optNumber,
  startNow: z.boolean().default(true),
});
export const maintenanceUpdateSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  resolution: optText(5000),
  cost: optNumber,
  vendorId: optId,
  scheduledDate: optDate,
});

// ─── Users & roles ──────────────────────────────────────────────────────────
/** A login ID chosen by IT, used instead of (or as well as) the email / employee ID. */
const loginId = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore (no spaces or @)')
    .nullable()
    .optional(),
);
const newPassword = z.preprocess(blankToNull, z.string().min(8, 'At least 8 characters').max(200).nullable().optional());

export const userCreateSchema = z
  .object({
    name: reqText(150),
    username: loginId,
    email: optEmail,
    password: z.string().min(8, 'At least 8 characters').max(200),
    roleId: reqId,
    employeeId: optId,
    /** Without a linked employee, one is added with this ID (numbered STAFF-001… when blank). */
    employeeCode: z.preprocess(blankToNull, z.string().trim().max(40, 'Too long').toUpperCase().nullable().optional()),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !!v.email || !!v.employeeId || !!v.username, {
    message: 'Enter a login ID or email, or link an employee (they can sign in with their employee ID)',
    path: ['username'],
  });
/** Give an employee a portal login. Without a password one is generated and shown once. */
export const employeeAccessSchema = z.object({
  roleId: optId,
  username: loginId,
  email: optEmail,
  password: newPassword,
});
/** Adding an employee can also give them a login in the same step. */
export const employeeCreateSchema = employeeSchema.extend({ access: employeeAccessSchema.nullable().optional() });
export const userUpdateSchema = z.object({
  name: reqText(150).optional(),
  roleId: reqId.optional(),
  employeeId: optId,
  isActive: z.boolean().optional(),
  username: loginId,
  email: optEmail,
  password: newPassword,
});
export const roleSchema = z.object({
  name: reqText(80),
  description: optText(300),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type VendorInput = z.infer<typeof vendorSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type EmployeeStatusInput = z.infer<typeof employeeStatusSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type AssetTypeInput = z.infer<typeof assetTypeSchema>;
export type FieldDefinitionInput = z.infer<typeof fieldDefinitionSchema>;
export type FieldUpdateInput = z.infer<typeof fieldUpdateSchema>;
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;
export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;
export type AssignInput = z.infer<typeof assignSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type LifecycleInput = z.infer<typeof lifecycleSchema>;
export type BulkAssetInput = z.infer<typeof bulkAssetSchema>;
export type ExitItemUpdateInput = z.infer<typeof exitItemUpdateSchema>;
export type RequestInput = z.infer<typeof requestSchema>;
export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type EmployeeAccessInput = z.infer<typeof employeeAccessSchema>;
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

// ─── Onboarding ─────────────────────────────────────────────────────────────
/** A suggested item: a catalog type or anything typed in. */
export const onboardingItemSchema = z
  .object({
    assetTypeId: optId,
    itemName: optText(200),
    quantity: z.coerce.number().int().min(1).max(1000).default(1),
    notes: optText(500),
  })
  .refine((v) => !!v.assetTypeId || !!v.itemName, { message: 'Pick an asset type or type what they need', path: ['assetTypeId'] });

export const onboardingCreateSchema = employeeSchema
  .omit({ joinDate: true })
  .extend({
    joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the joining date'),
    items: z.array(onboardingItemSchema).max(50).default([]),
    kitId: optId,
  });

export const onboardingItemUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(1000).optional(),
  notes: optText(500),
  status: z.enum(['PLANNED', 'PREPARED', 'SKIPPED']).optional(),
  preparedAssetId: optId,
  skipReason: optText(500),
});

export const onboardingUpdateSchema = z.object({ joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: optText(2000) });
export const onboardingIssueSchema = z.object({ assetId: optId, notes: optText(500) });
export const onboardingCancelSchema = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(500) });
export const onboardingReturnSchema = z.object({ note: z.string().trim().min(3, 'Tell HR what to change').max(1000) });
/** IT assigns every remaining item in one go: which asset goes for which item. */
export const onboardingAssignAllSchema = z.object({
  assignments: z.array(z.object({ itemId: reqId, assetId: reqId })).min(1, 'Pick at least one asset').max(50),
});
export type OnboardingAssignAllInput = z.infer<typeof onboardingAssignAllSchema>;
export const onboardingKitSchema = z.object({
  name: reqText(120),
  items: z.array(onboardingItemSchema).min(1, 'Add at least one item').max(50),
});

export type OnboardingItemInput = z.infer<typeof onboardingItemSchema>;
export type OnboardingCreateInput = z.infer<typeof onboardingCreateSchema>;
export type OnboardingItemUpdateInput = z.infer<typeof onboardingItemUpdateSchema>;
export type OnboardingUpdateInput = z.infer<typeof onboardingUpdateSchema>;
export type OnboardingIssueInput = z.infer<typeof onboardingIssueSchema>;
export type OnboardingKitInput = z.infer<typeof onboardingKitSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
