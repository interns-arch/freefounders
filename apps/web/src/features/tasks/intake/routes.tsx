import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';

// Loaded when first opened.
const IntakePage = lazy(() => import('./intake-page').then((m) => ({ default: m.IntakePage })));

/** /tasks/intake — needs intake.view (its module switch is applied by useAccess). */
export const intakeRoutes: RouteObject[] = [
  {
    path: 'intake',
    element: (
      <RequireTasks allow={(a) => a.tasks.can('intake.view')} what="the AI inbox">
        <IntakePage />
      </RequireTasks>
    ),
  },
];
