import type { RouteObject } from 'react-router';
import { GroupsPage } from './groups';
import { HomePage } from './home';
import { NoticesPage } from './notices';
import { NotificationsPage } from './notifications';
import { RequireTasks } from './parts';
import { TaskSettingsPage } from './settings';
import { TeamReportPage } from './team-report';
import { UsersPage } from './users';

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
