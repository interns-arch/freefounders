import type { Access } from '@freefounders/core';
import { Car, ClipboardList, History, LogIn, Package, Settings2, ShieldAlert, UserCheck, Users } from '@/components/icons';
import type { NavItem } from '@/app/nav';

/** Who opens each Visitors screen (PLAN.md §22): gate = guards / reception, view_all = the register, settings. */
export const VISITOR_SCREENS = {
  gate: (a: Access) => a.tasks.can('visitors.gate'),
  mine: (a: Access) => a.tasks.can('visitors.invite'),
  inside: (a: Access) => a.tasks.can('visitors.gate') || a.tasks.can('visitors.view_all'),
  register: (a: Access) => a.tasks.can('visitors.view_all'),
  settings: (a: Access) => a.tasks.can('visitors.settings'),
  watchlist: (a: Access) => a.tasks.can('visitors.settings') || a.tasks.can('visitors.view_all'),
};

/** Visitors group of the one menu. */
export const VISITORS_NAV: NavItem[] = [
  { label: 'Gate', to: '/visitors/today', icon: LogIn, show: VISITOR_SCREENS.gate, badge: (b) => b.visitors.waiting },
  { label: 'Vehicles', to: '/visitors/vehicles', icon: Car, show: (a) => VISITOR_SCREENS.gate(a) || VISITOR_SCREENS.register(a) },
  { label: 'Parcels', to: '/visitors/deliveries', icon: Package, show: (a) => VISITOR_SCREENS.gate(a) || VISITOR_SCREENS.register(a) },
  { label: 'Inside now', to: '/visitors/inside', icon: Users, show: VISITOR_SCREENS.inside },
  { label: 'My visitors', to: '/visitors/my', icon: UserCheck, show: VISITOR_SCREENS.mine, badge: (b) => b.visitors.approvals + b.visitors.parcels },
  { label: 'Register', to: '/visitors/register', icon: ClipboardList, group: 'Manage', show: VISITOR_SCREENS.register },
  { label: 'Guard activity', to: '/visitors/activity', icon: History, group: 'Manage', show: VISITOR_SCREENS.register },
  { label: 'Watchlist', to: '/visitors/watchlist', icon: ShieldAlert, group: 'Manage', show: VISITOR_SCREENS.watchlist },
  { label: 'Settings', to: '/visitors/settings', icon: Settings2, group: 'Manage', show: VISITOR_SCREENS.settings },
];
