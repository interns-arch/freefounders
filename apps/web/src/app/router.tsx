import { createBrowserRouter, type RouteObject } from 'react-router';
import { adminRoutes } from '@/features/admin/routes';
import { assetsRoutes } from '@/features/assets/routes';
import { attendanceRoutes, hrRoutes } from '@/features/hr/routes';
import { tasksRoutes } from '@/features/tasks/routes';
import { AccountPage } from './pages/account';
import { HomePage } from './pages/home';
import { LoginPage } from './pages/login';
import { NotFound, RouteError } from './pages/errors';
import { RequireSession } from './session-guard';
import { AppShell } from './shell';

/** An area's screens; an unknown path under it shows "Page not found" inside the shell. */
function area(routes: RouteObject[]): RouteObject[] {
  return [...routes, { path: '*', element: <NotFound /> }];
}

/**
 * Same URLs as the two old apps (PLAN.md §18.1): /tasks/… and /assets/… keep their sub-paths, so links already sent in
 * emails and notifications open the right screen. Every module lives here (PLAN.md §19.10): the old web apps are no
 * longer served.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  // Public account pages (PLAN.md §21.1): sign-up, forgot password, invite links.
  { path: '/signup', lazy: async () => ({ Component: (await import('@/features/account/signup')).SignupPage }), errorElement: <RouteError /> },
  { path: '/forgot', lazy: async () => ({ Component: (await import('@/features/account/forgot')).ForgotPage }), errorElement: <RouteError /> },
  { path: '/join/:token', lazy: async () => ({ Component: (await import('@/features/account/join')).JoinPage }), errorElement: <RouteError /> },
  {
    element: <RequireSession />,
    errorElement: <RouteError />,
    children: [
      { path: 'account', element: <AccountPage /> },
      // Signed in, without the app frame: a new company, the fake payment page, a printable invoice.
      { path: 'new-company', lazy: async () => ({ Component: (await import('@/features/account/new-company')).NewCompanyPage }) },
      { path: 'billing/pay/:sessionId', lazy: async () => ({ Component: (await import('@/features/billing/pay')).PayPage }) },
      { path: 'billing/invoices/:id', lazy: async () => ({ Component: (await import('@/features/billing/invoice')).InvoicePage }) },
      {
        element: <AppShell />,
        children: [
          // Home (PLAN.md §19.14): attendance first, then the other areas; /?choose is a plain alias, /?home=1 skips the phone redirect.
          { index: true, element: <HomePage /> },
          ...adminRoutes,
          // Kaampilot console (PLAN.md §21.1, §21.9): Kaampilot staff only (the screens send anyone else Home; the API answers 403).
          { path: 'console', lazy: async () => ({ Component: (await import('@/features/billing/console')).ConsolePage }) },
          { path: 'console/companies/:id', lazy: async () => ({ Component: (await import('@/features/billing/console-company')).ConsoleCompanyPage }) },
          { path: 'console/users/:kind/:id', lazy: async () => ({ Component: (await import('@/features/billing/console-users')).ConsoleUserPage }) },
          { path: 'console/:tab', lazy: async () => ({ Component: (await import('@/features/billing/console')).ConsolePage }) },
          // Every notification of every app, grouped by area (PLAN.md §19.37); the bell's "All notifications".
          { path: 'notifications', lazy: async () => ({ Component: (await import('@/features/tasks/general/notifications')).NotificationsPage }) },
          { path: 'attendance', children: attendanceRoutes },
          { path: 'tasks', children: area([...tasksRoutes, ...hrRoutes]) },
          { path: 'assets', children: area(assetsRoutes) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
