import type {
  AssetStatus,
  Condition,
  EmployeeStatus,
  OnboardingItemStatus,
  OnboardingStatus,
  ExitCaseStatus,
  ExitItemStatus,
  MaintenanceStatus,
  Priority,
  RequestStatus,
  TicketStatus,
} from '@eam/shared';
import type { BadgeTone } from '@/components/ui/primitives';

export const ASSET_STATUS_TONE: Record<AssetStatus, BadgeTone> = {
  PURCHASED: 'gray',
  RECEIVED: 'cyan',
  IN_INVENTORY: 'violet',
  AVAILABLE: 'green',
  ASSIGNED: 'blue',
  IN_MAINTENANCE: 'amber',
  RETURNED: 'orange',
  RETIRED: 'neutral',
  DISPOSED: 'neutral',
  LOST: 'red',
};

export const CONDITION_TONE: Record<Condition, BadgeTone> = {
  NEW: 'green',
  GOOD: 'green',
  FAIR: 'amber',
  POOR: 'orange',
  DAMAGED: 'red',
};

export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, BadgeTone> = {
  JOINING: 'violet',
  ACTIVE: 'green',
  ON_LEAVE: 'cyan',
  NOTICE_PERIOD: 'amber',
  EXITED: 'neutral',
};

export const ONBOARDING_TONE: Record<OnboardingStatus, BadgeTone> = { DRAFT: 'gray', SUBMITTED: 'amber', APPROVED: 'blue', COMPLETED: 'green', CANCELLED: 'neutral' };
export const ONBOARDING_ITEM_TONE: Record<OnboardingItemStatus, BadgeTone> = { PLANNED: 'gray', PREPARED: 'blue', ISSUED: 'green', SKIPPED: 'neutral' };

export const EXIT_CASE_TONE: Record<ExitCaseStatus, BadgeTone> = { OPEN: 'amber', COMPLETED: 'green', CANCELLED: 'neutral' };

export const EXIT_ITEM_TONE: Record<ExitItemStatus, BadgeTone> = {
  PENDING: 'amber',
  RETURNED: 'green',
  DAMAGED: 'orange',
  MISSING: 'red',
};

export const REQUEST_TONE: Record<RequestStatus, BadgeTone> = {
  PENDING: 'amber',
  APPROVED: 'blue',
  REJECTED: 'red',
  FULFILLED: 'green',
  CANCELLED: 'neutral',
};

export const TICKET_TONE: Record<TicketStatus, BadgeTone> = { OPEN: 'amber', IN_PROGRESS: 'blue', RESOLVED: 'green', CLOSED: 'neutral' };

export const MAINTENANCE_TONE: Record<MaintenanceStatus, BadgeTone> = {
  SCHEDULED: 'violet',
  IN_PROGRESS: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'neutral',
};

export const PRIORITY_TONE: Record<Priority, BadgeTone> = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'orange', URGENT: 'red' };

/** Solid colours for charts / status bars. */
export const ASSET_STATUS_BAR: Record<AssetStatus, string> = {
  PURCHASED: 'bg-zinc-400',
  RECEIVED: 'bg-cyan-500',
  IN_INVENTORY: 'bg-violet-500',
  AVAILABLE: 'bg-emerald-500',
  ASSIGNED: 'bg-blue-500',
  IN_MAINTENANCE: 'bg-amber-500',
  RETURNED: 'bg-orange-500',
  RETIRED: 'bg-zinc-300 dark:bg-zinc-600',
  DISPOSED: 'bg-zinc-200 dark:bg-zinc-700',
  LOST: 'bg-red-500',
};
