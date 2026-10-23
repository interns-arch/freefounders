/**
 * The columns of each Assets download (PLAN.md §19.31): `@Exportable(EXPORTS.assets)` on the list route. Rows are what
 * the list itself returns (same filters, search, sort and permission checks); these only pick and name the columns.
 */
import { ASSET_STATUS_LABELS, EMPLOYEE_STATUS_LABELS, HOLDER_TYPE_LABELS, ONBOARDING_STATUS_LABELS } from '@eam/shared';
import { type ExportColumn, type ExportSpec, humanEnum, humanKey } from './export';

type Row = Record<string, unknown>;
const label = (map: Record<string, string>, key: string) => (r: Row) => map[r[key] as string] ?? humanEnum(r[key]);
const en = (key: string) => (r: Row) => humanEnum(r[key]);

/** Asset columns, plus one column per custom field (attribute) found in the rows (e.g. a SIM's connection number). */
function assetColumns(rows: Row[]): ExportColumn[] {
  const base: ExportColumn[] = [
    ['Asset tag', 'assetTag'],
    ['Name', 'name'],
    ['Category', 'categoryName'],
    ['Type', 'typeName'],
    ['Status', label(ASSET_STATUS_LABELS, 'status')],
    ['Condition', en('condition')],
    ['Held by', 'holderName'],
    ['Holder type', label(HOLDER_TYPE_LABELS, 'holderType')],
    ['Assigned on', 'assignedAt'],
    ['Location', 'locationName'],
    ['Serial number', 'serialNumber'],
    ['Manufacturer', 'manufacturer'],
    ['Model', 'model'],
    ['Ownership', en('ownership')],
    ['Tracking', en('trackingMode')],
    ['Quantity', 'quantity'],
    ['Available quantity', 'availableQuantity'],
    ['Purchase date', 'purchaseDate'],
    ['Purchase cost', 'purchaseCost'],
    ['Currency', 'currency'],
    ['Warranty expiry', 'warrantyExpiry'],
    ['Added on', 'createdAt'],
  ];
  const keys = new Set<string>();
  for (const r of rows) {
    const a = r.attributes;
    if (a && typeof a === 'object' && !Array.isArray(a)) for (const k of Object.keys(a)) keys.add(k);
  }
  const attrs: ExportColumn[] = [...keys].sort().map((k) => [humanKey(k), (r: Row) => (r.attributes as Row | null)?.[k] as unknown]);
  return [...base, ...attrs];
}

export const EXPORTS = {
  assets: { name: 'assets', columns: assetColumns },
  employees: {
    name: 'employees',
    columns: [
      ['Employee code', 'employeeCode'],
      ['Name', 'fullName'],
      ['Designation', 'designation'],
      ['Department', 'departmentName'],
      ['Location', 'locationName'],
      ['Company', 'companyName'],
      ['Manager', 'managerName'],
      ['Status', label(EMPLOYEE_STATUS_LABELS, 'status')],
      ['Email', 'email'],
      ['Phone', 'phone'],
      ['Personal email', 'personalEmail'],
      ['Personal phone', 'personalPhone'],
      ['Company SIMs', 'companySims'],
      ['Assets held', 'assetCount'],
      ['Join date', 'joinDate'],
      ['Last working date', 'lastWorkingDate'],
    ],
  },
  exits: {
    name: 'exits',
    columns: [
      ['Case', 'caseNumber'],
      ['Employee', 'employeeName'],
      ['Employee code', 'employeeCode'],
      ['Designation', 'designation'],
      ['Department', 'departmentName'],
      ['Status', en('status')],
      ['Notice date', 'noticeDate'],
      ['Last working date', 'lastWorkingDate'],
      ['Reason', 'reason'],
      ['Items', 'total'],
      ['Pending', 'pending'],
      ['Returned', 'returned'],
      ['Damaged', 'damaged'],
      ['Missing', 'missing'],
      ['Started by', 'initiatedByName'],
      ['Completed on', 'completedAt'],
      ['Completed by', 'completedByName'],
      ['Created on', 'createdAt'],
    ],
  },
  onboarding: {
    name: 'new-joiners',
    columns: [
      ['Case', 'caseNumber'],
      ['Employee', 'employeeName'],
      ['Employee code', 'employeeCode'],
      ['Designation', 'designation'],
      ['Department', 'departmentName'],
      ['Status', label(ONBOARDING_STATUS_LABELS, 'status')],
      ['Join date', 'joinDate'],
      ['Items', 'itemsTotal'],
      ['Planned', 'itemsPlanned'],
      ['Prepared', 'itemsPrepared'],
      ['Issued', 'itemsIssued'],
      ['Skipped', 'itemsSkipped'],
      ['Created by', 'createdByName'],
      ['Completed on', 'completedAt'],
    ],
  },
  requests: {
    name: 'requests',
    columns: [
      ['Request', 'number'],
      ['Employee', 'employeeName'],
      ['Employee code', 'employeeCode'],
      ['Department', 'departmentName'],
      ['Item', 'typeName'],
      ['Category', 'categoryName'],
      ['Quantity', 'quantity'],
      ['Priority', en('priority')],
      ['Status', en('status')],
      ['Needed by', 'neededBy'],
      ['Reason', 'reason'],
      ['Requested by', 'requestedByName'],
      ['Decided by', 'decidedByName'],
      ['Decided on', 'decidedAt'],
      ['Decision note', 'decisionNote'],
      ['Fulfilled with', 'fulfilledAssetTag'],
      ['Fulfilled on', 'fulfilledAt'],
      ['Created on', 'createdAt'],
    ],
  },
  tickets: {
    name: 'tickets',
    columns: [
      ['Ticket', 'number'],
      ['Title', 'title'],
      ['Type', en('type')],
      ['Priority', en('priority')],
      ['Status', en('status')],
      ['Asset tag', 'assetTag'],
      ['Asset', 'assetName'],
      ['Reported by', 'reportedByName'],
      ['Assigned to', 'assigneeName'],
      ['Description', 'description'],
      ['Resolution', 'resolution'],
      ['Resolved on', 'resolvedAt'],
      ['Task', (r: Row) => (r.linkedTask as { ref?: string } | null)?.ref ?? null],
      ['Created on', 'createdAt'],
    ],
  },
  maintenance: {
    name: 'maintenance',
    columns: [
      ['Record', 'number'],
      ['Asset tag', 'assetTag'],
      ['Asset', 'assetName'],
      ['Type', en('type')],
      ['Title', 'title'],
      ['Status', en('status')],
      ['Vendor', 'vendorName'],
      ['Scheduled for', 'scheduledDate'],
      ['Started on', 'startedAt'],
      ['Completed on', 'completedAt'],
      ['Cost', 'cost'],
      ['Resolution', 'resolution'],
      ['Logged by', 'createdByName'],
      ['Created on', 'createdAt'],
    ],
  },
  history: {
    name: 'activity',
    columns: [
      ['When', 'occurredAt'],
      ['Who', 'actorName'],
      ['What', en('entityType')],
      ['Item', 'entityLabel'],
      ['Action', en('action')],
      ['Summary', 'summary'],
      ['Changes', (r: Row) =>
        Array.isArray(r.changes)
          ? (r.changes as { field?: string; label?: string; from?: unknown; to?: unknown }[])
              .map((c) => `${c.label ?? c.field ?? ''}: ${c.from ?? '—'} → ${c.to ?? '—'}`)
              .join('; ')
          : null],
    ],
  },
  users: {
    name: 'users',
    columns: [
      ['Name', 'name'],
      ['Username', 'username'],
      ['Email', 'email'],
      ['Role', 'roleName'],
      ['Employee', 'employeeName'],
      ['Employee code', 'employeeCode'],
      ['Active', 'isActive'],
      ['Last sign-in', 'lastLoginAt'],
      ['Created on', 'createdAt'],
    ],
  },
} satisfies Record<string, ExportSpec>;

/** Org master data (companies / departments / locations / vendors): every plain field of that kind. */
export const orgExport = (kind: string): ExportSpec => ({ name: kind });
