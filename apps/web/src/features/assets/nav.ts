import type { Access } from '@freefounders/core';
import { Activity, Boxes, Briefcase, CardSim, ClipboardList, GitCompareArrows, LayoutDashboard, LifeBuoy, LineChart, ListOrdered, LogOut, QrCode, ScanLine, Shapes, ShieldCheck, Truck, UserPlus, Users, UsersRound, Wrench } from 'lucide-react';
import type { NavItem } from '@/app/nav';

// Same rules as the Assets app: IT hands out assets; staff (HR, managers, CEO) see people; plain employees see their own.
const isIT = (a: Access) => a.assets.can('asset:assign');
const isEmployeeOnly = (a: Access) => !a.assets.can('employee:view');
const staff = (a: Access) => !isEmployeeOnly(a);

// Plain employees see the same screens under "my" names (Home, My assets, My requests, My tickets, My QR & profile).
export const ASSETS_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/assets', icon: LayoutDashboard, end: true, show: (a) => staff(a) && a.assets.can('dashboard:view') },
  { label: 'Home', to: '/assets', icon: LayoutDashboard, end: true, show: isEmployeeOnly },
  { label: 'Leadership', to: '/assets/leadership', icon: LineChart, show: (a) => a.assets.can('insights:leadership') },
  { label: 'Priority queue', to: '/assets/queue', icon: ListOrdered, show: isIT },
  { label: 'Assets', to: '/assets/assets', icon: Boxes, show: (a) => staff(a) && isIT(a) },
  { label: 'My assets', to: '/assets/assets', icon: Boxes, show: isEmployeeOnly },
  { label: 'Employees', to: '/assets/employees', icon: Users, show: (a) => a.assets.can('employee:view') },
  { label: 'New joiners', to: '/assets/onboarding', icon: UserPlus, show: (a) => a.assets.can('onboarding:manage') && !isIT(a) },
  { label: 'Exits', to: '/assets/exits', icon: LogOut, show: (a) => a.assets.can('exit:manage', 'employee:status') },
  { label: 'Requests', to: '/assets/requests', icon: ClipboardList, show: (a) => staff(a) && a.assets.can('request:approve', 'request:fulfil') },
  { label: 'My requests', to: '/assets/requests', icon: ClipboardList, show: isEmployeeOnly },
  { label: 'Tickets', to: '/assets/tickets', icon: LifeBuoy, show: (a) => staff(a) && a.assets.can('ticket:manage') },
  { label: 'My tickets', to: '/assets/tickets', icon: LifeBuoy, show: isEmployeeOnly },
  { label: 'Maintenance', to: '/assets/maintenance', icon: Wrench, show: (a) => a.assets.can('maintenance:manage') },
  { label: 'Activity log', to: '/assets/activity', icon: Activity, show: (a) => a.assets.can('history:view') },
  { label: 'Scan', to: '/assets/scan', icon: ScanLine, show: isIT },
  { label: 'My QR & profile', to: '/assets/me', icon: QrCode, show: (a) => isEmployeeOnly(a) && !!a.assets.me?.employee },
  { label: 'SIM cards', to: '/assets/sims', icon: CardSim, group: 'More', show: (a) => isIT(a) && a.assets.module('sims') },
  { label: 'Reconciliation', to: '/assets/reconciliation', icon: GitCompareArrows, group: 'More', show: (a) => isIT(a) && a.assets.module('sims') },
  { label: 'Asset catalogue', to: '/assets/settings/catalog', icon: Shapes, group: 'Settings', show: (a) => a.assets.can('catalog:manage') },
  { label: 'Departments', to: '/assets/settings/departments', icon: Briefcase, group: 'Settings', show: (a) => a.assets.can('org:manage') },
  { label: 'Vendors', to: '/assets/settings/vendors', icon: Truck, group: 'Settings', show: (a) => a.assets.can('org:manage') },
  { label: 'Users', to: '/assets/settings/users', icon: UsersRound, group: 'Settings', show: (a) => a.assets.can('user:manage') },
  { label: 'Roles & permissions', to: '/assets/settings/roles', icon: ShieldCheck, group: 'Settings', show: (a) => a.assets.can('user:manage') },
];

/** Keyboard shortcuts (G then …) for the Assets screens. */
export const ASSETS_GOTO: Record<string, string> = {
  d: '/assets',
  a: '/assets/assets',
  e: '/assets/employees',
  x: '/assets/exits',
  r: '/assets/requests',
  t: '/assets/tickets',
  q: '/assets/queue',
  m: '/assets/maintenance',
  s: '/assets/scan',
};
