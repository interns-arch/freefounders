import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';
import { TASKS_SCREENS } from '../nav';

const LinksPage = lazy(() => import('./links-page').then((m) => ({ default: m.LinksPage })));

/** /tasks/links — only while the `links` module is on. */
export const linksRoutes: RouteObject[] = [
  {
    path: 'links',
    element: (
      <RequireTasks allow={(a) => a.tasks.module('links') && TASKS_SCREENS.links(a)} what="Links">
        <LinksPage />
      </RequireTasks>
    ),
  },
];
