import type { Access } from '@freefounders/core';
import { BarChart3, Bell, Bot, Boxes, CheckSquare, FileText, Home, Lightbulb, Link2, Megaphone, Settings2, Target, TriangleAlert, UsersRound } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** Who opens each Tasks screen (PLAN.md §19.19): each feature is its own permission; a module switched off hides it too. */
export const TASKS_SCREENS = {
  team: (a: Access) => a.tasks.can('tasks.team_performance'),
  notices: (a: Access) => a.tasks.can('notices.view') || a.tasks.can('notices.publish'),
  notifications: (a: Access) => a.tasks.can('notifications.view'),
  mistakes: (a: Access) => ['mistakes.view', 'mistakes.log', 'sops.manage'].some((p) => a.tasks.can(p)) || a.tasks.canAny('mistakes.review'),
  forms: (a: Access) => ['forms.view', 'forms.build', 'forms.all'].some((p) => a.tasks.can(p)),
  links: (a: Access) => a.tasks.can('links.view') || a.tasks.can('links.manage'),
  ideas: (a: Access) => a.tasks.can('ideas.view') || a.tasks.can('ideas.review'),
  /** Task settings shows the sections the person may change: rules, departments, categories, lead rules. */
  settings: (a: Access) => ['tasks.settings', 'settings.manage', 'tasks.assign', 'leads.rules'].some((p) => a.tasks.can(p)),
};

/** Tasks workspace menu. */
export const TASKS_NAV: NavItem[] = [
  { label: 'Home', to: '/tasks', icon: Home, end: true },
  { label: 'Tasks', to: '/tasks/tasks', icon: CheckSquare },
  { label: 'Team performance', to: '/tasks/team', icon: BarChart3, show: TASKS_SCREENS.team },
  { label: 'Groups', to: '/tasks/groups', icon: Boxes },
  { label: 'Notices', to: '/tasks/notices', icon: Megaphone, show: TASKS_SCREENS.notices },
  { label: 'Notifications', to: '/tasks/notifications', icon: Bell, show: TASKS_SCREENS.notifications },
  { label: 'My team', to: '/tasks/users', icon: UsersRound },
  { label: 'Leads', to: '/tasks/leads', icon: Target, group: 'More', show: (a) => a.tasks.module('leads') && a.tasks.canAny('leads.view') },
  { label: 'AI inbox', to: '/tasks/intake', icon: Bot, group: 'More', show: (a) => a.tasks.can('intake.view') },
  { label: 'Mistakes', to: '/tasks/mistakes', icon: TriangleAlert, group: 'More', show: (a) => a.tasks.module('mistakes') && TASKS_SCREENS.mistakes(a) },
  { label: 'Forms', to: '/tasks/forms', icon: FileText, group: 'More', show: (a) => a.tasks.module('forms') && TASKS_SCREENS.forms(a) },
  { label: 'Links', to: '/tasks/links', icon: Link2, group: 'More', show: (a) => a.tasks.module('links') && TASKS_SCREENS.links(a) },
  { label: 'Idea board', to: '/tasks/ideas', icon: Lightbulb, group: 'More', show: (a) => a.tasks.module('ideas') && TASKS_SCREENS.ideas(a) },
  { label: 'Task settings', to: '/tasks/settings', icon: Settings2, group: 'Settings', show: TASKS_SCREENS.settings },
];
