import { CalendarClock, CheckSquare, type IconComponent, Package, ShieldCheck } from '@/components/icons';
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
  admin: { icon: ShieldCheck, text: 'text-app-admin', soft: 'bg-app-admin/10 text-app-admin', solid: 'bg-app-admin text-white dark:text-background' },
};

/** The workspaces this person can open, in portal order. Attendance comes with Tasks (PLAN.md §19.4, option A). */
export function workspacesFor(apps: string[], hasAdmin: boolean): Workspace[] {
  const list: Workspace[] = [];
  if (apps.includes('tasks')) list.push('attendance', 'tasks');
  if (apps.includes('assets')) list.push('assets');
  if (hasAdmin) list.push('admin'); // any Admin permission (PLAN.md §19.19)
  return list;
}
