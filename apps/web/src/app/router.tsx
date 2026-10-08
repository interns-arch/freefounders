import { createBrowserRouter, type RouteObject } from 'react-router';
import { adminRoutes } from '@/features/admin/routes';
import { assetsRoutes } from '@/features/assets/routes';
import { hrRoutes } from '@/features/hr/routes';
import { tasksRoutes } from '@/features/tasks/routes';
import { ClassicRedirect } from './classic';
import { AccountPage } from './pages/account';
import { ChooserPage } from './pages/chooser';
import { LoginPage } from './pages/login';
import { NotFound, RouteError } from './pages/errors';
import { RequireSession } from './session-guard';
import { AppShell } from './shell';

/** An area's screens, plus: its home and any path not built yet open the classic app. */
function area(app: 'tasks' | 'assets', routes: RouteObject[]): RouteObject[] {
  const fallback = <ClassicRedirect app={app} />;
  return [...routes, ...(routes.some((r) => r.index) ? [] : [{ index: true, element: fallback }]), { path: '*', element: fallback }];
}

/**
 * Same URLs as the two old apps (PLAN.md §18.1): /tasks/… and /assets/… keep their sub-paths, so links already sent in
 * emails and notifications open the right screen. Anything under /tasks or /assets not built here yet goes to the
 * classic app (ClassicRedirect), so nothing is ever a dead end.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <RequireSession />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ChooserPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        element: <AppShell />,
        children: [
          ...adminRoutes,
          { path: 'tasks', children: area('tasks', [...tasksRoutes, ...hrRoutes]) },
          { path: 'assets', children: area('assets', assetsRoutes) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
