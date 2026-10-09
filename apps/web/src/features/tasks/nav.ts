import { BarChart3, Bell, Bot, Boxes, CheckSquare, FileText, Home, Lightbulb, Link2, Megaphone, Settings2, Target, TriangleAlert, UsersRound } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** Tasks workspace menu. */
export const TASKS_NAV: NavItem[] = [
  { label: 'Home', to: '/tasks', icon: Home, end: true },
  { label: 'Tasks', to: '/tasks/tasks', icon: CheckSquare },
  { label: 'Team performance', to: '/tasks/team', icon: BarChart3, show: (a) => a.tasks.can('tasks.view_all') },
  { label: 'Groups', to: '/tasks/groups', icon: Boxes },
  { label: 'Notices', to: '/tasks/notices', icon: Megaphone },
  { label: 'Notifications', to: '/tasks/notifications', icon: Bell },
  { label: 'My team', to: '/tasks/users', icon: UsersRound },
  { label: 'Leads', to: '/tasks/leads', icon: Target, group: 'More', show: (a) => a.tasks.module('leads') && a.tasks.canAny('leads.view') },
  { label: 'AI inbox', to: '/tasks/intake', icon: Bot, group: 'More', show: (a) => a.tasks.can('intake.view') },
  { label: 'Mistakes', to: '/tasks/mistakes', icon: TriangleAlert, group: 'More', show: (a) => a.tasks.module('mistakes') },
  { label: 'Forms', to: '/tasks/forms', icon: FileText, group: 'More', show: (a) => a.tasks.module('forms') },
  { label: 'Links', to: '/tasks/links', icon: Link2, group: 'More', show: (a) => a.tasks.module('links') },
  { label: 'Idea board', to: '/tasks/ideas', icon: Lightbulb, group: 'More', show: (a) => a.tasks.module('ideas') },
  { label: 'Task settings', to: '/tasks/settings', icon: Settings2, group: 'Settings', show: (a) => a.tasks.can('settings.manage') },
];
