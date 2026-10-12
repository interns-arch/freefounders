import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';
import { TASKS_SCREENS } from '../nav';

const IdeasPage = lazy(() => import('./ideas-page').then((m) => ({ default: m.IdeasPage })));

/** /tasks/ideas — only while the `ideas` module is on. */
export const ideasRoutes: RouteObject[] = [
  {
    path: 'ideas',
    element: (
      <RequireTasks allow={(a) => a.tasks.module('ideas') && TASKS_SCREENS.ideas(a)} what="the Idea board">
        <IdeasPage />
      </RequireTasks>
    ),
  },
];
