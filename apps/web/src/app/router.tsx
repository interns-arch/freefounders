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
  {
    element: <RequireSession />,
    errorElement: <RouteError />,
    children: [
      { path: 'account', element: <AccountPage /> },
      {
        element: <AppShell />,
        children: [
          // Home (PLAN.md §19.14): attendance first, then the other areas; /?choose is a plain alias, /?home=1 skips the phone redirect.
          { index: true, element: <HomePage /> },
          ...adminRoutes,
          { path: 'attendance', children: attendanceRoutes },
          { path: 'tasks', children: area([...tasksRoutes, ...hrRoutes]) },
          { path: 'assets', children: area(assetsRoutes) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
