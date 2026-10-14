import type { Access } from '@freefounders/core';
import { PEOPLE_SCREEN } from '@freefounders/core/admin';
import { CreditCard, Settings2, ShieldCheck, Users } from '@/components/icons';
import type { NavItem } from '@/app/nav';

/** Who may open each Admin screen (PLAN.md §19.19): owners and admins all; anyone else by their roles' Admin permissions. */
export const ADMIN_SCREENS = {
  people: (a: Access) => a.admin.can(...PEOPLE_SCREEN),
  roles: (a: Access) => a.admin.can('roles.manage'),
  settings: (a: Access) => a.admin.can('company.settings'),
  /** The owner, or a role with "Manage billing" (PLAN.md §21.2). */
  billing: (a: Access) => a.canManageBilling,
};

/** Admin workspace (shown to anyone with at least one Admin permission). */
export const ADMIN_NAV: NavItem[] = [
  { label: 'People & access', to: '/people', icon: Users, show: ADMIN_SCREENS.people },
  { label: 'Roles', to: '/roles', icon: ShieldCheck, show: ADMIN_SCREENS.roles },
  { label: 'Settings', to: '/settings', icon: Settings2, show: ADMIN_SCREENS.settings },
  { label: 'Billing', to: '/billing', icon: CreditCard, show: ADMIN_SCREENS.billing },
];

/** The first Admin screen this person may open (the Admin workspace's start page for them). */
export function adminHome(a: Access): string {
  return ADMIN_NAV.find((n) => !n.show || n.show(a))?.to ?? '/';
}
