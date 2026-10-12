import { CalendarClock, CheckSquare, type LucideIcon, Package, ShieldCheck } from 'lucide-react';
import type { Workspace } from './nav';

/** How each workspace is told apart (PLAN.md §19.1): its icon and accent colour (theme tokens only). */
export const WORKSPACE_LOOK: Record<Workspace, { icon: LucideIcon; dot: string; text: string; soft: string; solid: string; glow: string }> = {
  attendance: {
    icon: CalendarClock,
    dot: 'bg-app-attendance',
    text: 'text-app-attendance',
    soft: 'bg-app-attendance/10 text-app-attendance',
    solid: 'bg-app-attendance text-white',
    glow: 'from-app-attendance/12',
  },
  tasks: { icon: CheckSquare, dot: 'bg-app-tasks', text: 'text-app-tasks', soft: 'bg-app-tasks/10 text-app-tasks', solid: 'bg-app-tasks text-white', glow: 'from-app-tasks/12' },
  assets: { icon: Package, dot: 'bg-app-assets', text: 'text-app-assets', soft: 'bg-app-assets/10 text-app-assets', solid: 'bg-app-assets text-white', glow: 'from-app-assets/12' },
  admin: { icon: ShieldCheck, dot: 'bg-app-admin', text: 'text-app-admin', soft: 'bg-app-admin/10 text-app-admin', solid: 'bg-app-admin text-white', glow: 'from-app-admin/10' },
};

/** The workspaces this person can open, in portal order. Attendance comes with Tasks (PLAN.md §19.4, option A). */
export function workspacesFor(apps: string[], hasAdmin: boolean): Workspace[] {
  const list: Workspace[] = [];
  if (apps.includes('tasks')) list.push('attendance', 'tasks');
  if (apps.includes('assets')) list.push('assets');
  if (hasAdmin) list.push('admin'); // any Admin permission (PLAN.md §19.19)
  return list;
}
