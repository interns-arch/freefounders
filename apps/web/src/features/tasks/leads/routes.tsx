import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';

// Loaded when first opened.
const LeadsPage = lazy(() => import('./leads-page').then((m) => ({ default: m.LeadsPage })));

/** /tasks/leads — needs the Leads module and any leads.view* capability (same rule as the menu). */
export const leadsRoutes: RouteObject[] = [
  {
    path: 'leads',
    element: (
      <RequireTasks allow={(a) => a.tasks.module('leads') && a.tasks.canAny('leads.view')} what="Leads">
        <LeadsPage />
      </RequireTasks>
    ),
  },
];
