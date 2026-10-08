import { BarChart3, Bell, Bot, Boxes, CheckSquare, FileText, Home, Lightbulb, Link2, Megaphone, Settings2, Target, TriangleAlert, UsersRound } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** Tasks workspace menu. `classic` items are screens not moved yet (PLAN.md §18.3). */
export const TASKS_NAV: NavItem[] = [
  { label: 'Home', to: '/tasks', icon: Home, end: true },
  { label: 'Tasks', to: '/tasks/tasks', icon: CheckSquare },
  { label: 'Team performance', to: '/tasks/team', icon: BarChart3, show: (a) => a.tasks.can('tasks.view_all') },
  { label: 'Groups', to: '/tasks/groups', icon: Boxes },
  { label: 'Notices', to: '/tasks/notices', icon: Megaphone },
  { label: 'Notifications', to: '/tasks/notifications', icon: Bell },
  { label: 'My team', to: '/tasks/users', icon: UsersRound },
  { label: 'Leads', to: '/classic/tasks/leads', icon: Target, classic: true, group: 'More', show: (a) => a.tasks.module('leads') && a.tasks.canAny('leads.view') },
  { label: 'AI inbox', to: '/classic/tasks/intake', icon: Bot, classic: true, group: 'More', show: (a) => a.tasks.can('intake.view') },
  { label: 'Mistakes', to: '/classic/tasks/mistakes', icon: TriangleAlert, classic: true, group: 'More', show: (a) => a.tasks.module('mistakes') },
  { label: 'Forms', to: '/classic/tasks/forms', icon: FileText, classic: true, group: 'More', show: (a) => a.tasks.module('forms') },
  { label: 'Links', to: '/classic/tasks/links', icon: Link2, classic: true, group: 'More', show: (a) => a.tasks.module('links') },
  { label: 'Idea board', to: '/classic/tasks/ideas', icon: Lightbulb, classic: true, group: 'More', show: (a) => a.tasks.module('ideas') },
  { label: 'Task settings', to: '/tasks/settings', icon: Settings2, group: 'Settings', show: (a) => a.tasks.can('settings.manage') },
];
