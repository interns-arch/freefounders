import type { Access, Badges } from '@kaampilot/core';
import type { IconComponent } from '@/components/icons';

/** One menu entry. Each area exports its own list (features/<area>/nav.ts); the shell shows what `show` allows. */
export interface NavItem {
  label: string;
  /** In-app path, e.g. "/tasks/tasks". */
  to: string;
  icon: IconComponent;
  show?: (access: Access) => boolean;
  /** Exact match for the active highlight (for index pages). */
  end?: boolean;
  /** Section heading this item sits under in the sidebar (optional). */
  group?: string;
  /** The red count beside it: what waits for me there (PLAN.md §19.42). */
  badge?: (b: Badges) => number;
}

/** The groups of the one menu (PLAN.md §19.14; Visitors §22). Home (`/`) belongs to none of them. */
export type Workspace = 'attendance' | 'tasks' | 'assets' | 'visitors' | 'admin';

export const WORKSPACES: Workspace[] = ['attendance', 'tasks', 'assets', 'visitors', 'admin'];
export const isWorkspace = (v: unknown): v is Workspace => typeof v === 'string' && (WORKSPACES as string[]).includes(v);

/** Which group a path belongs to (null = Home). */
export function workspaceOf(pathname: string): Workspace | null {
  if (pathname === '/attendance' || pathname.startsWith('/attendance/')) return 'attendance';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return 'tasks';
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return 'assets';
  if (pathname === '/visitors' || pathname.startsWith('/visitors/')) return 'visitors';
  if (['/people', '/roles', '/settings', '/billing'].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'admin';
  return null;
}

export const WORKSPACE_NAMES: Record<Workspace, string> = { attendance: 'Attendance', tasks: 'Tasks', assets: 'Assets', visitors: 'Visitors', admin: 'Admin' };
/** The count on an area's sidebar header and phone tab: everything waiting for me in it (PLAN.md §19.42). */
export const WORKSPACE_BADGE: Record<Workspace, (b: Badges) => number> = {
  attendance: (b) => b.attendance.total,
  tasks: (b) => b.tasks.total,
  assets: (b) => b.assets.total,
  visitors: (b) => b.visitors.total,
  admin: () => 0,
};
export const WORKSPACE_HOME: Record<Workspace, string> = { attendance: '/attendance', tasks: '/tasks', assets: '/assets', visitors: '/visitors', admin: '/people' };
