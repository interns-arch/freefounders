export const ASSET_STATUSES = [
  'PURCHASED',
  'RECEIVED',
  'IN_INVENTORY',
  'AVAILABLE',
  'ASSIGNED',
  'IN_MAINTENANCE',
  'RETURNED',
  'RETIRED',
  'DISPOSED',
  'LOST',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  PURCHASED: 'Purchased',
  RECEIVED: 'Received',
  IN_INVENTORY: 'In Inventory',
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  IN_MAINTENANCE: 'In Maintenance',
  RETURNED: 'Returned',
  RETIRED: 'Retired',
  DISPOSED: 'Disposed',
  LOST: 'Lost',
};

/** Statuses a brand-new asset may start in. */
export const INITIAL_ASSET_STATUSES = ['PURCHASED', 'RECEIVED', 'IN_INVENTORY', 'AVAILABLE'] as const;
export type InitialAssetStatus = (typeof INITIAL_ASSET_STATUSES)[number];

export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const OWNERSHIP_TYPES = ['OWNED', 'LEASED', 'RENTED', 'SUBSCRIPTION', 'LICENSED'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** What assets can be handed to in a single-branch company (no location / company holders). */
export const ASSIGNABLE_HOLDERS = ['EMPLOYEE', 'DEPARTMENT', 'VENDOR', 'INVENTORY'] as const;

export const HOLDER_TYPES = ['EMPLOYEE', 'DEPARTMENT', 'LOCATION', 'COMPANY', 'VENDOR', 'INVENTORY'] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  EMPLOYEE: 'Employee',
  DEPARTMENT: 'Department',
  LOCATION: 'Location',
  COMPANY: 'Company',
  VENDOR: 'Vendor',
  INVENTORY: 'Inventory (store)',
};

export const TRACKING_MODES = ['INDIVIDUAL', 'QUANTITY'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

/** CONSUMED: a one-time item (joining kit, stationery) given for good — nothing to return. */
export const ALLOCATION_STATUSES = ['ACTIVE', 'RETURNED', 'TRANSFERRED', 'RELEASED', 'LOST', 'CONSUMED'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/** JOINING: a new joiner being onboarded; becomes ACTIVE when they join. */
export const EMPLOYEE_STATUSES = ['JOINING', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'EXITED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  JOINING: 'Joining',
  ACTIVE: 'Active',
  ON_LEAVE: 'On Leave',
  NOTICE_PERIOD: 'Notice Period',
  EXITED: 'Exited',
};

export const EXIT_CASE_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;
export type ExitCaseStatus = (typeof EXIT_CASE_STATUSES)[number];

export const EXIT_ITEM_STATUSES = ['PENDING', 'RETURNED', 'DAMAGED', 'MISSING'] as const;
export type ExitItemStatus = (typeof EXIT_ITEM_STATUSES)[number];

/** DRAFT (HR) → SUBMITTED (waiting for IT approval) → APPROVED (IT assigning) → COMPLETED (joined) · CANCELLED. */
export const ONBOARDING_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'CANCELLED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const ONBOARDING_OPEN_STATUSES: readonly OnboardingStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED'];
export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  DRAFT: 'Draft (HR)',
  SUBMITTED: 'Waiting for IT approval',
  APPROVED: 'Approved — assigning',
  COMPLETED: 'Joined',
  CANCELLED: 'Cancelled',
};

export const ONBOARDING_ITEM_STATUSES = ['PLANNED', 'PREPARED', 'ISSUED', 'SKIPPED'] as const;
export type OnboardingItemStatus = (typeof ONBOARDING_ITEM_STATUSES)[number];

/** Exit items in these statuses count as cleared. */
export const EXIT_ITEM_CLEARED: readonly ExitItemStatus[] = ['RETURNED', 'DAMAGED'];

export const LOCATION_TYPES = ['OFFICE', 'BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'SITE', 'OTHER'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_TYPES = ['ISSUE', 'DAMAGE', 'LOSS', 'REPAIR', 'OTHER'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAINTENANCE_TYPES = ['PREVENTIVE', 'REPAIR', 'INSPECTION', 'SERVICE', 'CALIBRATION'] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const HISTORY_ENTITY_TYPES = [
  'ASSET',
  'EMPLOYEE',
  'EXIT_CASE',
  'ONBOARDING_CASE',
  'CATEGORY',
  'ASSET_TYPE',
  'FIELD',
  'COMPANY',
  'DEPARTMENT',
  'LOCATION',
  'VENDOR',
  'REQUEST',
  'TICKET',
  'MAINTENANCE',
  'USER',
  'ROLE',
] as const;
export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

/** Turns `IN_MAINTENANCE` into `In Maintenance`. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
