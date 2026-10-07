import type { AssetStatus, TrackingMode } from './enums';
import type { Permission } from './permissions';

export const LIFECYCLE_ACTIONS = [
  'receive',
  'move_to_inventory',
  'make_available',
  'assign',
  'transfer',
  'return',
  'start_maintenance',
  'complete_maintenance',
  'retire',
  'reinstate',
  'mark_lost',
  'mark_found',
  'dispose',
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export interface LifecycleRule {
  label: string;
  description: string;
  /** Statuses the action may start from (individually tracked assets). */
  from: AssetStatus[];
  /** Resulting status; `null` means it depends on context (e.g. transfer into inventory). */
  to: AssetStatus | null;
  permission: Permission;
  /** Whether the action is available for quantity-tracked (pooled) assets. */
  pooled: boolean;
  tone: 'default' | 'primary' | 'warning' | 'danger';
}

/**
 * Single source of truth for the asset lifecycle:
 * Purchased → Received → Inventory → Available → Assigned → (Transferred) → Maintenance
 * → Returned → Available → Retired → Disposed, plus Lost / Found.
 */
export const LIFECYCLE: Record<LifecycleAction, LifecycleRule> = {
  receive: {
    label: 'Receive',
    description: 'Mark the purchased asset as received',
    from: ['PURCHASED'],
    to: 'RECEIVED',
    permission: 'asset:lifecycle',
    pooled: true,
    tone: 'primary',
  },
  move_to_inventory: {
    label: 'Move to inventory',
    description: 'Put the asset into a store / warehouse',
    from: ['RECEIVED', 'AVAILABLE', 'RETURNED'],
    to: 'IN_INVENTORY',
    permission: 'asset:assign',
    pooled: false,
    tone: 'default',
  },
  make_available: {
    label: 'Make available',
    description: 'Ready for use and can be assigned',
    from: ['RECEIVED', 'IN_INVENTORY', 'RETURNED'],
    to: 'AVAILABLE',
    permission: 'asset:lifecycle',
    pooled: true,
    tone: 'primary',
  },
  assign: {
    label: 'Assign',
    description: 'Give the asset to an employee, department, location, company or vendor',
    from: ['AVAILABLE', 'IN_INVENTORY'],
    to: 'ASSIGNED',
    permission: 'asset:assign',
    pooled: true,
    tone: 'primary',
  },
  transfer: {
    label: 'Transfer',
    description: 'Move the asset from its current holder to a new one',
    from: ['ASSIGNED', 'IN_INVENTORY'],
    to: null,
    permission: 'asset:assign',
    pooled: true,
    tone: 'default',
  },
  return: {
    label: 'Return',
    description: 'Take the asset back from its holder',
    from: ['ASSIGNED'],
    to: 'RETURNED',
    permission: 'asset:assign',
    pooled: true,
    tone: 'default',
  },
  start_maintenance: {
    label: 'Send to maintenance',
    description: 'Repair, service or inspection',
    from: ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'IN_INVENTORY'],
    to: 'IN_MAINTENANCE',
    permission: 'maintenance:manage',
    pooled: false,
    tone: 'warning',
  },
  complete_maintenance: {
    label: 'Complete maintenance',
    description: 'Return the asset to service',
    from: ['IN_MAINTENANCE'],
    to: null,
    permission: 'maintenance:manage',
    pooled: false,
    tone: 'primary',
  },
  retire: {
    label: 'Retire',
    description: 'Take the asset out of service',
    from: ['AVAILABLE', 'RETURNED', 'IN_INVENTORY', 'IN_MAINTENANCE'],
    to: 'RETIRED',
    permission: 'asset:lifecycle',
    pooled: true,
    tone: 'warning',
  },
  reinstate: {
    label: 'Reinstate',
    description: 'Bring a retired asset back into service',
    from: ['RETIRED'],
    to: 'AVAILABLE',
    permission: 'asset:lifecycle',
    pooled: true,
    tone: 'default',
  },
  mark_lost: {
    label: 'Mark lost',
    description: 'The asset cannot be found',
    from: ['AVAILABLE', 'ASSIGNED', 'IN_INVENTORY', 'RETURNED'],
    to: 'LOST',
    permission: 'asset:lifecycle',
    pooled: false,
    tone: 'danger',
  },
  mark_found: {
    label: 'Mark found',
    description: 'A lost asset has been recovered',
    from: ['LOST'],
    to: 'AVAILABLE',
    permission: 'asset:lifecycle',
    pooled: false,
    tone: 'primary',
  },
  dispose: {
    label: 'Dispose',
    description: 'Scrap, sell or write off the asset (final)',
    from: ['RETIRED', 'LOST'],
    to: 'DISPOSED',
    permission: 'asset:lifecycle',
    pooled: true,
    tone: 'danger',
  },
};

/** Ordered happy-path stages, used to draw the lifecycle stepper. */
export const LIFECYCLE_STAGES: { key: string; label: string; statuses: AssetStatus[] }[] = [
  { key: 'purchased', label: 'Purchased', statuses: ['PURCHASED'] },
  { key: 'received', label: 'Received', statuses: ['RECEIVED'] },
  { key: 'inventory', label: 'Inventory', statuses: ['IN_INVENTORY'] },
  { key: 'available', label: 'Available', statuses: ['AVAILABLE'] },
  { key: 'assigned', label: 'Assigned', statuses: ['ASSIGNED'] },
  { key: 'maintenance', label: 'Maintenance', statuses: ['IN_MAINTENANCE'] },
  { key: 'returned', label: 'Returned', statuses: ['RETURNED'] },
  { key: 'retired', label: 'Retired', statuses: ['RETIRED', 'LOST'] },
  { key: 'disposed', label: 'Disposed', statuses: ['DISPOSED'] },
];

export interface LifecycleContext {
  status: AssetStatus;
  trackingMode: TrackingMode;
  /** Units still free for a pooled asset. */
  availableQuantity?: number;
  /** Number of active allocations (pooled assets can have many). */
  activeAllocations?: number;
}

/** Whether `action` is valid for an asset in the given state (permissions are checked separately). */
export function canPerform(action: LifecycleAction, ctx: LifecycleContext): boolean {
  const rule = LIFECYCLE[action];
  if (ctx.trackingMode === 'QUANTITY') {
    if (!rule.pooled) return false;
    const free = ctx.availableQuantity ?? 0;
    const active = ctx.activeAllocations ?? 0;
    const inService = ctx.status === 'AVAILABLE' || ctx.status === 'ASSIGNED';
    switch (action) {
      case 'assign':
        return inService && free > 0;
      case 'transfer':
      case 'return':
        return active > 0;
      case 'retire':
        return inService && active === 0;
      default:
        return rule.from.includes(ctx.status);
    }
  }
  return rule.from.includes(ctx.status);
}

export function availableActions(ctx: LifecycleContext): LifecycleAction[] {
  return LIFECYCLE_ACTIONS.filter((a) => canPerform(a, ctx));
}
