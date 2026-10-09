import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';

// Loaded when first opened (smaller first download; the shell shows a loader meanwhile).
const MistakesPage = lazy(() => import('./page').then((m) => ({ default: m.MistakesPage })));

/** /tasks/mistakes (?tab=register|sops, ?open=<mistake id>) — the mistake register and the written processes (SOPs). */
export const mistakesRoutes: RouteObject[] = [
  {
    path: 'mistakes',
    element: (
      <RequireTasks allow={(a) => a.tasks.module('mistakes')} what="the mistake register (switched off for this company)">
        <MistakesPage />
      </RequireTasks>
    ),
  },
];
