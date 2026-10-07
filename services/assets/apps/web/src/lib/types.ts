import type {
  AllocationStatus,
  AssetStatus,
  Attributes,
  Condition,
  EmployeeStatus,
  ExitCaseStatus,
  ExitItemStatus,
  FieldType,
  HolderType,
  LocationType,
  MaintenanceStatus,
  MaintenanceType,
  OwnershipType,
  Permission,
  OnboardingItemStatus,
  OnboardingStatus,
  Priority,
  RequestStatus,
  TicketStatus,
  TicketType,
  TrackingMode,
} from '@eam/shared';

export interface Me {
  user: { id: string; name: string; email: string | null };
  role: { id: string; name: string };
  permissions: Permission[];
  employee: { id: string; fullName: string; employeeCode: string; status: EmployeeStatus; designation: string | null } | null;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  sortOrder: number;
  typeCount: number;
  assetCount: number;
  fields: FieldDefinition[];
}

export interface AssetType {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  icon: string | null;
  description: string | null;
  trackingMode: TrackingMode;
  consumable: boolean;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  assetCount: number;
  availableCount: number;
  fieldCount: number;
}

export interface FieldDefinition {
  id: string;
  categoryId: string | null;
  assetTypeId: string | null;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  isUnique: boolean;
  options: string[] | null;
  min: number | null;
  max: number | null;
  placeholder: string | null;
  helpText: string | null;
  sortOrder: number;
  showInTable: boolean;
  filterable: boolean;
  archivedAt: string | null;
  inherited?: boolean;
}

export interface AssetTypeDetail extends Omit<AssetType, 'categoryName' | 'categoryIcon' | 'categoryColor' | 'availableCount' | 'fieldCount'> {
  category: Omit<Category, 'typeCount' | 'assetCount' | 'fields'>;
  fields: FieldDefinition[];
}

export interface AssetListItem {
  id: string;
  assetTag: string;
  qrCode: string;
  name: string;
  status: AssetStatus;
  /** One-time item (joining kit, stationery): given away, no return. */
  consumable?: boolean;
  condition: Condition;
  trackingMode: TrackingMode;
  quantity: number;
  availableQuantity: number;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  ownership: OwnershipType;
  purchaseDate: string | null;
  purchaseCost: number | null;
  currency: string;
  warrantyExpiry: string | null;
  holderType: HolderType | null;
  holderId: string | null;
  holderName: string | null;
  assignedAt: string | null;
  attributes: Attributes;
  version: number;
  createdAt: string;
  updatedAt: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  assetTypeId: string;
  typeName: string;
  typeIcon: string | null;
  locationId: string | null;
  locationName: string | null;
}

export interface AssetListResponse {
  items: AssetListItem[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Partial<Record<AssetStatus, number>>;
}

export interface Allocation {
  id: string;
  assetId: string;
  holderType: HolderType;
  employeeId: string | null;
  departmentId: string | null;
  locationId: string | null;
  companyId: string | null;
  vendorId: string | null;
  holderName: string;
  quantity: number;
  status: AllocationStatus;
  assignedAt: string;
  assignedByName: string | null;
  expectedReturnDate: string | null;
  notes: string | null;
  endedAt: string | null;
  endedByName: string | null;
  returnCondition: Condition | null;
  endNotes: string | null;
  photos?: AllocationPhoto[];
}

export interface AllocationPhoto {
  id: string;
  assetId: string;
  allocationId: string | null;
  kind: 'ASSET' | 'HANDOVER' | 'RETURN';
  uploadedByName: string | null;
  createdAt: string;
}

export interface QueueItem {
  kind: 'TICKET' | 'REQUEST' | 'ONBOARDING';
  id: string;
  number: string;
  title: string;
  detail: string;
  priority: Priority;
  status: string;
  createdAt: string;
  dueDate: string | null;
  overdue: boolean;
  assigneeName: string | null;
  link: string;
}

export interface Queue {
  items: QueueItem[];
  counts: Record<Priority, number>;
  total: number;
  overdue: number;
}

export interface MaintenanceRecord {
  id: string;
  number: string;
  assetId: string;
  type: MaintenanceType;
  title: string;
  description: string | null;
  vendorId: string | null;
  status: MaintenanceStatus;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cost: number | null;
  resolution: string | null;
  createdByName: string | null;
  createdAt: string;
  assetTag?: string;
  assetName?: string;
  assetStatus?: AssetStatus;
  vendorName?: string | null;
}

export interface AssetDetail extends Omit<AssetListItem, 'categoryName' | 'categoryIcon' | 'categoryColor' | 'typeName' | 'typeIcon'> {
  description: string | null;
  invoiceNumber: string | null;
  ownerCompanyId: string | null;
  vendorId: string | null;
  category: { id: string; name: string; icon: string | null; color: string | null; code: string };
  type: { id: string; name: string; icon: string | null; code: string; trackingMode: TrackingMode; consumable: boolean };
  ownerCompanyName: string | null;
  vendorName: string | null;
  fields: FieldDefinition[];
  archivedFields: FieldDefinition[];
  activeAllocations: Allocation[];
  /** Photos taken when the asset was added. */
  photos: AllocationPhoto[];
  openMaintenance: MaintenanceRecord[];
  openExits: { id: string; caseNumber: string; employeeId: string; lastWorkingDate: string; employeeName: string }[];
}

export interface HistoryEvent {
  id: number;
  occurredAt: string;
  actorId: string | null;
  actorName: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  action: string;
  summary: string;
  changes: { field: string; label?: string; from: unknown; to: unknown }[] | null;
  assetId: string | null;
  employeeId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  personalPhone: string | null;
  personalEmail?: string | null;
  companySims?: string[];
  designation: string | null;
  status: EmployeeStatus;
  joinDate: string | null;
  lastWorkingDate: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationId: string | null;
  locationName: string | null;
  companyName: string | null;
  managerName: string | null;
  assetCount: number;
  openExitCaseId: string | null;
}

export interface HeldAsset {
  allocationId: string;
  quantity: number;
  assignedAt: string;
  expectedReturnDate: string | null;
  assetId: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: Condition;
  serialNumber: string | null;
  trackingMode: TrackingMode;
  typeName: string;
  typeIcon: string | null;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
}

export interface EmployeeDetail extends Omit<Employee, 'assetCount' | 'openExitCaseId'> {
  companyId: string | null;
  managerId: string | null;
  noticeDate: string | null;
  exitDate: string | null;
  notes: string | null;
  personalEmail: string | null;
  assetsVerifiedAt: string | null;
  assetsVerifiedByName: string | null;
  createdAt: string;
  assets: HeldAsset[];
  given: HeldAsset[];
  login: { id: string; email: string | null; username: string | null; isActive: boolean; roleId: string; roleName: string; lastLoginAt: string | null } | null;
  openExitCase: { id: string; caseNumber: string; lastWorkingDate: string } | null;
  onboarding: { id: string; caseNumber: string; status: OnboardingStatus; joinDate: string } | null;
  exitCases: { id: string; caseNumber: string; status: ExitCaseStatus; lastWorkingDate: string }[];
  directReports: { id: string; fullName: string; designation: string | null }[];
}

export interface ExitCaseListItem {
  id: string;
  caseNumber: string;
  employeeId: string;
  status: ExitCaseStatus;
  noticeDate: string | null;
  lastWorkingDate: string;
  reason: string | null;
  overridden: boolean;
  completedAt: string | null;
  createdAt: string;
  employeeName: string;
  employeeCode: string;
  employeeStatus: EmployeeStatus;
  designation: string | null;
  departmentName: string | null;
  total: number;
  pending: number;
  returned: number;
  damaged: number;
  missing: number;
}

export interface ExitItem {
  id: string;
  exitCaseId: string;
  assetId: string | null;
  allocationId: string | null;
  assetTag: string | null;
  assetName: string;
  assetTypeName: string | null;
  categoryName: string | null;
  quantity: number;
  status: ExitItemStatus;
  source: 'AUTO' | 'MANUAL' | 'ADDED_LATER';
  notes: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  assetStatus: AssetStatus | null;
  assetCondition: Condition | null;
  qrCode: string | null;
  serialNumber: string | null;
  allocationStatus: AllocationStatus | null;
}

export interface ExitCaseDetail {
  id: string;
  caseNumber: string;
  employeeId: string;
  status: ExitCaseStatus;
  noticeDate: string | null;
  lastWorkingDate: string;
  reason: string | null;
  initiatedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  overridden: boolean;
  overrideReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    email: string | null;
    phone: string | null;
    designation: string | null;
    status: EmployeeStatus;
    departmentName: string | null;
    locationName: string | null;
  };
  counts: { total: number; pending: number; returned: number; damaged: number; missing: number; cleared: number };
  canComplete: boolean;
  items: ExitItem[];
}

export interface OrgEntity {
  id: string;
  name: string;
  code: string | null;
  [key: string]: unknown;
}

export interface LocationOption {
  id: string;
  name: string;
  code: string | null;
  isStore: boolean;
  type: LocationType;
  parentId: string | null;
}

export interface AssetRequest {
  id: string;
  number: string;
  employeeId: string;
  requestedByName: string | null;
  assetTypeId: string | null;
  itemName: string | null;
  custom: boolean;
  quantity: number;
  priority: Priority;
  neededBy: string | null;
  reason: string;
  status: RequestStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  fulfilledAssetId: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string | null;
  typeName: string;
  typeIcon: string | null;
  categoryName: string;
  fulfilledAssetTag: string | null;
  availableCount: number;
}

export interface Ticket {
  id: string;
  number: string;
  title: string;
  description: string | null;
  assetId: string | null;
  reportedBy: string | null;
  reportedByName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  type: TicketType;
  priority: Priority;
  status: TicketStatus;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assetTag: string | null;
  assetName: string | null;
  history?: HistoryEvent[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface UserRow {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  roleId: string;
  roleName: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  hasSavedPassword: boolean;
  passwordSavedAt: string | null;
  createdAt: string;
}

export interface SavedPassword {
  loginId: string | null;
  email: string | null;
  password: string | null;
  savedAt: string | null;
  savedByName: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  userCount: number;
}

export interface SearchResults {
  exact: { id: string; assetTag: string; name: string; status: AssetStatus } | null;
  assets: AssetListItem[];
  employees: Employee[];
  departments: { id: string; name: string; code: string | null }[];
  locations: { id: string; name: string; code: string | null; isStore: boolean }[];
  vendors: { id: string; name: string }[];
  assetTypes: { id: string; name: string; icon: string | null; categoryName: string }[];
}

export interface OnboardingListItem {
  id: string;
  caseNumber: string;
  status: OnboardingStatus;
  joinDate: string;
  createdByName: string | null;
  completedAt: string | null;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string | null;
  departmentName: string | null;
  itemsTotal: number;
  itemsPlanned: number;
  itemsPrepared: number;
  itemsIssued: number;
  itemsSkipped: number;
}

export interface OnboardingItem {
  id: string;
  assetTypeId: string | null;
  itemName: string;
  quantity: number;
  notes: string | null;
  status: OnboardingItemStatus;
  preparedAssetId: string | null;
  preparedByName: string | null;
  allocationId: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  skipReason: string | null;
  typeIcon: string | null;
  consumable: boolean;
  preparedAsset: { id: string; assetTag: string | null; name: string | null; status: AssetStatus | null; holderName: string | null; trackingMode: TrackingMode | null } | null;
  preparedUnavailable: boolean;
}

export interface OnboardingDetail {
  id: string;
  caseNumber: string;
  status: OnboardingStatus;
  joinDate: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  submittedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  returnNote: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; email: string | null; phone: string | null; status: EmployeeStatus; departmentName: string | null; locationName: string | null };
  login: { id: string; isActive: boolean } | null;
  items: OnboardingItem[];
  counts: { total: number; planned: number; prepared: number; issued: number; skipped: number };
  ready: boolean;
}

export interface OnboardingKit {
  id: string;
  name: string;
  items: { assetTypeId: string | null; itemName: string | null; quantity: number; notes: string | null }[];
  createdByName: string | null;
  updatedAt: string;
}
