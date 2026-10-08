import type { RouteObject } from 'react-router';
import { AdminOnly } from './parts';

/** /people, /roles, /settings: owners and admins only (anyone else goes back to the start page). */
export const adminRoutes: RouteObject[] = [
  {
    element: <AdminOnly />,
    children: [
      { path: 'people', lazy: async () => ({ Component: (await import('./people')).PeoplePage }) },
      { path: 'roles', lazy: async () => ({ Component: (await import('./roles')).RolesPage }) },
      { path: 'settings', lazy: async () => ({ Component: (await import('./settings')).SettingsPage }) },
    ],
  },
];
