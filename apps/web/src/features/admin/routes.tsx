import type { RouteObject } from 'react-router';
import { ADMIN_SCREENS } from './nav';
import { AdminOnly } from './parts';

/** /people, /roles, /settings: each needs its own Admin permission (PLAN.md §19.19); anyone else is sent on. */
export const adminRoutes: RouteObject[] = [
  { element: <AdminOnly allow={ADMIN_SCREENS.people} />, children: [{ path: 'people', lazy: async () => ({ Component: (await import('./people')).PeoplePage }) }] },
  { element: <AdminOnly allow={ADMIN_SCREENS.roles} forms />, children: [{ path: 'roles', lazy: async () => ({ Component: (await import('./roles')).RolesPage }) }] },
  { element: <AdminOnly allow={ADMIN_SCREENS.settings} forms />, children: [{ path: 'settings', lazy: async () => ({ Component: (await import('./settings')).SettingsPage }) }] },
  { element: <AdminOnly allow={ADMIN_SCREENS.billing} />, children: [{ path: 'billing', lazy: async () => ({ Component: (await import('../billing/billing')).BillingPage }) }] },
];
