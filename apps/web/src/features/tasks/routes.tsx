import type { RouteObject } from 'react-router';
import { generalRoutes } from './general/routes';
import { intakeRoutes } from './intake/routes';
import { leadsRoutes } from './leads/routes';
import { linksRoutes } from './links/routes';
import { mistakesRoutes } from './mistakes/routes';
import { workRoutes } from './work/routes';

/**
 * Children of /tasks (same sub-paths as the old Tasks web app).
 *   work/     the task workspace: /tasks/tasks, /tasks/tasks/:taskId (lists, detail, reviews, requests, templates…)
 *   general/  everything else: /tasks (home), /tasks/team, /groups, /notices, /notifications, /users, /settings
 */
export const tasksRoutes: RouteObject[] = [...generalRoutes, ...workRoutes, ...linksRoutes, ...leadsRoutes, ...intakeRoutes, ...mistakesRoutes];
