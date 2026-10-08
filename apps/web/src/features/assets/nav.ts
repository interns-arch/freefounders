import type { Access } from '@freefounders/core';
import { Activity, Boxes, Briefcase, CardSim, ClipboardList, GitCompareArrows, LayoutDashboard, LifeBuoy, LineChart, ListOrdered, LogOut, ScanLine, Shapes, ShieldCheck, Truck, UserPlus, Users, UsersRound, Wrench } from 'lucide-react';
import type { NavItem } from '@/app/nav';

// Same rules as the Assets app: IT hands out assets; staff (HR, managers, CEO) see people; plain employees see their own.
export const isIT = (a: Access) => a.assets.can('asset:assign');
export const isEmployeeOnly = (a: Access) => !a.assets.can('employee:view');

export const ASSETS_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/assets', icon: LayoutDashboard, end: true, show: (a) => a.assets.can('dashboard:view') || isEmployeeOnly(a) },
  { label: 'Leadership', to: '/assets/leadership', icon: LineChart, show: (a) => a.assets.can('insights:leadership') },
  { label: 'Priority queue', to: '/assets/queue', icon: ListOrdered, show: isIT },
  { label: 'Assets', to: '/assets/assets', icon: Boxes, show: (a) => isIT(a) || isEmployeeOnly(a) },
  { label: 'Employees', to: '/assets/employees', icon: Users, show: (a) => a.assets.can('employee:view') },
  { label: 'New joiners', to: '/assets/onboarding', icon: UserPlus, show: (a) => a.assets.can('onboarding:manage') && !isIT(a) },
  { label: 'Exits', to: '/assets/exits', icon: LogOut, show: (a) => a.assets.can('exit:manage', 'employee:status') },
  { label: 'Requests', to: '/assets/requests', icon: ClipboardList, show: (a) => a.assets.can('request:approve', 'request:fulfil') || isEmployeeOnly(a) },
  { label: 'Tickets', to: '/assets/tickets', icon: LifeBuoy, show: (a) => a.assets.can('ticket:manage') || isEmployeeOnly(a) },
  { label: 'Maintenance', to: '/assets/maintenance', icon: Wrench, show: (a) => a.assets.can('maintenance:manage') },
  { label: 'Activity log', to: '/assets/activity', icon: Activity, show: (a) => a.assets.can('history:view') },
  { label: 'Scan', to: '/assets/scan', icon: ScanLine, show: isIT },
  { label: 'SIM cards', to: '/classic/assets/sims', icon: CardSim, classic: true, group: 'More', show: (a) => isIT(a) && a.assets.module('sims') },
  { label: 'Reconciliation', to: '/classic/assets/reconciliation', icon: GitCompareArrows, classic: true, group: 'More', show: (a) => isIT(a) && a.assets.module('sims') },
  { label: 'Asset catalogue', to: '/assets/settings/catalog', icon: Shapes, group: 'Settings', show: (a) => a.assets.can('catalog:manage') },
  { label: 'Departments', to: '/assets/settings/departments', icon: Briefcase, group: 'Settings', show: (a) => a.assets.can('org:manage') },
  { label: 'Vendors', to: '/assets/settings/vendors', icon: Truck, group: 'Settings', show: (a) => a.assets.can('org:manage') },
  { label: 'Users', to: '/assets/settings/users', icon: UsersRound, group: 'Settings', show: (a) => a.assets.can('user:manage') },
  { label: 'Roles & permissions', to: '/assets/settings/roles', icon: ShieldCheck, group: 'Settings', show: (a) => a.assets.can('user:manage') },
];
