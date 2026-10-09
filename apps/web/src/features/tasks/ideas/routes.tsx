import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';

const IdeasPage = lazy(() => import('./ideas-page').then((m) => ({ default: m.IdeasPage })));

/** /tasks/ideas — only while the `ideas` module is on. */
export const ideasRoutes: RouteObject[] = [
  {
    path: 'ideas',
    element: (
      <RequireTasks allow={(a) => a.tasks.module('ideas')} what="the Idea board">
        <IdeasPage />
      </RequireTasks>
    ),
  },
];
