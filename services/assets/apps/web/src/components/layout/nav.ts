import type { Permission } from '@eam/shared';
import {
  Activity,
  Boxes,
  Briefcase,
  CardSim,
  ClipboardList,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  LifeBuoy,
  ListOrdered,
  LogOut,
  ScanLine,
  Shapes,
  ShieldCheck,
  Truck,
  UserPlus,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react';
import type { QuickAddKind } from '@/features/quick-add/quick-add';

type Can = (...permissions: Permission[]) => boolean;

export interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown when the user has ANY of these. */
  perms?: Permission[];
  /** Or a rule of its own, so each role (IT, HR, Manager, CEO, Employee) gets only what it uses. */
  show?: (can: Can) => boolean;
  shortcut?: string;
}

export const navVisible = (item: Pick<NavItem, 'perms' | 'show'>, can: Can) => (item.show ? item.show(can) : !item.perms || can(...item.perms));

// Who is who: IT/Admin hand out assets; staff (HR, Manager, CEO) can see people; plain employees can't.
const isIT = (can: Can) => can('asset:assign');
const isEmployeeOnly = (can: Can) => !can('employee:view');

export const MAIN_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, shortcut: 'G D', show: (can) => can('dashboard:view') || isEmployeeOnly(can) },
  { label: 'Leadership', to: '/leadership', icon: LineChart, perms: ['insights:leadership'] },
  { label: 'Priority queue', to: '/queue', icon: ListOrdered, shortcut: 'G Q', show: isIT },
  { label: 'Assets', to: '/assets', icon: Boxes, shortcut: 'G A', show: (can) => isIT(can) || isEmployeeOnly(can) },
  { label: 'SIM cards', to: '/sims', icon: CardSim, show: isIT },
  { label: 'Employees', to: '/employees', icon: Users, perms: ['employee:view'], shortcut: 'G E' },
  { label: 'New joiners', to: '/onboarding', icon: UserPlus, show: (can) => can('onboarding:manage') && !isIT(can) },
  { label: 'Exits', to: '/exits', icon: LogOut, shortcut: 'G X', show: (can) => can('exit:manage', 'employee:status') },
  { label: 'Requests', to: '/requests', icon: ClipboardList, shortcut: 'G R', show: (can) => can('request:approve', 'request:fulfil') || isEmployeeOnly(can) },
  { label: 'Tickets', to: '/tickets', icon: LifeBuoy, shortcut: 'G T', show: (can) => can('ticket:manage') || isEmployeeOnly(can) },
  { label: 'Maintenance', to: '/maintenance', icon: Wrench, perms: ['maintenance:manage'], shortcut: 'G M' },
  { label: 'Reconciliation', to: '/reconciliation', icon: GitCompareArrows, show: isIT },
  { label: 'Activity log', to: '/activity', icon: Activity, perms: ['history:view'] },
  { label: 'Scan', to: '/scan', icon: ScanLine, shortcut: 'G S', show: isIT },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: 'Asset catalog', to: '/settings/catalog', icon: Shapes, perms: ['catalog:manage'] },
  { label: 'Departments', to: '/settings/departments', icon: Briefcase, perms: ['org:manage'] },
  { label: 'Vendors', to: '/settings/vendors', icon: Truck, perms: ['org:manage'] },
  { label: 'Users', to: '/settings/users', icon: UsersRound, perms: ['user:manage'] },
  { label: 'Roles & permissions', to: '/settings/roles', icon: ShieldCheck, perms: ['user:manage'] },
];

export interface QuickAddItem {
  kind: QuickAddKind;
  label: string;
  perms: Permission[];
  show?: (can: Can) => boolean;
}

/** The universal "+ Add" menu, in the order from the brief. */
export const QUICK_ADD: QuickAddItem[] = [
  { kind: 'employee', label: 'Employee', perms: ['employee:manage'] },
  { kind: 'onboarding', label: 'New joiner', perms: ['onboarding:manage'] },
  { kind: 'asset', label: 'Asset', perms: ['asset:create'] },
  { kind: 'assetType', label: 'Asset type', perms: ['catalog:manage'] },
  { kind: 'category', label: 'Category', perms: ['catalog:manage'] },
  { kind: 'department', label: 'Department', perms: ['org:manage'] },
  { kind: 'vendor', label: 'Vendor', perms: ['org:manage'] },
  { kind: 'request', label: 'Request', perms: ['request:create'], show: (can) => isIT(can) || isEmployeeOnly(can) || can('request:approve') },
  { kind: 'ticket', label: 'Ticket', perms: ['ticket:create'], show: (can) => isIT(can) || isEmployeeOnly(can) },
  { kind: 'maintenance', label: 'Maintenance', perms: ['maintenance:manage'] },
];
