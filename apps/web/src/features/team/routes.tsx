import { useAccess } from '@kaampilot/core';
import { Navigate, Outlet, type RouteObject } from 'react-router';
import { canOpenTeam } from './nav';

/** Members are sent Home (the API answers 403 anyway). */
function TeamOnly() {
  const access = useAccess();
  if (access.ready && !canOpenTeam(access)) return <Navigate to="/?home=1" replace />;
  return <Outlet />;
}

/** /team (the tiles) and /team/:id (one person) — PLAN.md §25. */
export const teamRoutes: RouteObject[] = [
  {
    element: <TeamOnly />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./team-page')).TeamPage,
        }),
      },
      {
        path: ':id',
        lazy: async () => ({
          Component: (await import('./person-page')).PersonPage,
        }),
      },
    ],
  },
];
