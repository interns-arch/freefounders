import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from './parts';

// Loaded when first opened (smaller first download; the shell shows a loader meanwhile).
const HomePage = lazy(() => import('./home').then((m) => ({ default: m.HomePage })));
const TeamReportPage = lazy(() => import('./team-report').then((m) => ({ default: m.TeamReportPage })));
const GroupsPage = lazy(() => import('./groups').then((m) => ({ default: m.GroupsPage })));
const NoticesPage = lazy(() => import('./notices').then((m) => ({ default: m.NoticesPage })));
const NotificationsPage = lazy(() => import('./notifications').then((m) => ({ default: m.NotificationsPage })));
const UsersPage = lazy(() => import('./users').then((m) => ({ default: m.UsersPage })));
const TaskSettingsPage = lazy(() => import('./settings').then((m) => ({ default: m.TaskSettingsPage })));

/** /tasks (home), /tasks/team, /tasks/groups, /tasks/notices, /tasks/notifications, /tasks/users, /tasks/settings. */
export const generalRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  {
    path: 'team',
    element: (
      <RequireTasks allow={(a) => a.tasks.can('tasks.view_all')} what="Team Performance">
        <TeamReportPage />
      </RequireTasks>
    ),
  },
  { path: 'groups', element: <GroupsPage /> },
  { path: 'notices', element: <NoticesPage /> },
  { path: 'notifications', element: <NotificationsPage /> },
  { path: 'users', element: <UsersPage /> },
  {
    path: 'settings',
    element: (
      <RequireTasks allow={(a) => a.tasks.can('settings.manage')} what="Task settings">
        <TaskSettingsPage />
      </RequireTasks>
    ),
  },
];
