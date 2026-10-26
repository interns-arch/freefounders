import type { Access } from '@kaampilot/core';
import { CalendarClock, CheckSquare, type IconComponent, Package, ShieldCheck, UserCheck } from '@/components/icons';
import type { Workspace } from './nav';

/**
 * How each workspace is told apart (PLAN.md §19.1, §19.22): its icon and accent colour (theme tokens only). `soft` is
 * the flat tinted chip used in the menu, the header pill and the Home cards; `solid` a filled chip (white icon in light
 * mode, navy icon in dark mode, where the accents are light).
 */
export const WORKSPACE_LOOK: Record<Workspace, { icon: IconComponent; text: string; soft: string; solid: string }> = {
  attendance: {
    icon: CalendarClock,
    text: 'text-app-attendance',
    soft: 'bg-app-attendance/10 text-app-attendance',
    solid: 'bg-app-attendance text-white dark:text-background',
  },
  tasks: { icon: CheckSquare, text: 'text-app-tasks', soft: 'bg-app-tasks/10 text-app-tasks', solid: 'bg-app-tasks text-white dark:text-background' },
  assets: { icon: Package, text: 'text-app-assets', soft: 'bg-app-assets/10 text-app-assets', solid: 'bg-app-assets text-white dark:text-background' },
  visitors: { icon: UserCheck, text: 'text-app-visitors', soft: 'bg-app-visitors/10 text-app-visitors', solid: 'bg-app-visitors text-white dark:text-background' },
  admin: { icon: ShieldCheck, text: 'text-app-admin', soft: 'bg-app-admin/10 text-app-admin', solid: 'bg-app-admin text-white dark:text-background' },
};

/** Tasks capabilities that are not Tasks work: someone with only these (a guard) gets no Tasks menu (PLAN.md §22). */
const NOT_TASKS = ['attendance.', 'leave.', 'holidays.', 'payroll.', 'hr.', 'visitors.', 'notifications.'];

/** Has any Tasks work at all (still loading counts as yes, so the menu does not flicker). */
export function hasTasksWork(access: Access): boolean {
  const caps = access.tasks.me?.capabilities;
  return !caps || caps.some((c) => !NOT_TASKS.some((p) => c.startsWith(p)));
}

/** Visitors (PLAN.md §22): the module is on and the person has any Visitors permission. */
export function hasVisitors(access: Access): boolean {
  return access.tasks.on && access.tasks.module('visitors') && access.tasks.canAny('visitors.');
}

/**
 * The workspaces this person can open, in portal order. Attendance comes with Tasks (PLAN.md §19.4, option A); the
 * Tasks menu only when they have Tasks work (a guard: Attendance + Visitors only).
 */
export function workspacesFor(access: Access): Workspace[] {
  const list: Workspace[] = [];
  if (access.apps.includes('tasks')) list.push('attendance');
  if (access.apps.includes('tasks') && hasTasksWork(access)) list.push('tasks');
  if (access.apps.includes('assets')) list.push('assets');
  if (hasVisitors(access)) list.push('visitors');
  if (access.admin.any) list.push('admin'); // any Admin permission (PLAN.md §19.19)
  return list;
}
