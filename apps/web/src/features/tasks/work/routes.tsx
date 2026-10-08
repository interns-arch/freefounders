import type { RouteObject } from 'react-router';

/**
 * /tasks/tasks and /tasks/tasks/:taskId (the task workspace; the detail opens over the list). One route with an optional
 * segment, so opening and closing a task keeps the list (and its filters) mounted underneath.
 */
export const workRoutes: RouteObject[] = [{ path: 'tasks/:taskId?', lazy: () => import('./workspace-page').then((m) => ({ Component: m.TaskWorkspacePage })) }];
