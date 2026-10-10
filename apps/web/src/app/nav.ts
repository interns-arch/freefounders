import type { Access } from '@freefounders/core';
import type { LucideIcon } from 'lucide-react';

/** One menu entry. Each area exports its own list (features/<area>/nav.ts); the shell shows what `show` allows. */
export interface NavItem {
  label: string;
  /** In-app path, e.g. "/tasks/tasks". */
  to: string;
  icon: LucideIcon;
  show?: (access: Access) => boolean;
  /** Exact match for the active highlight (for index pages). */
  end?: boolean;
  /** Section heading this item sits under in the sidebar (optional). */
  group?: string;
}

/** The four groups of the one menu (PLAN.md §19.14). Home (`/`) belongs to none of them. */
export type Workspace = 'attendance' | 'tasks' | 'assets' | 'admin';

export const WORKSPACES: Workspace[] = ['attendance', 'tasks', 'assets', 'admin'];
export const isWorkspace = (v: unknown): v is Workspace => typeof v === 'string' && (WORKSPACES as string[]).includes(v);

/** Which group a path belongs to (null = Home). */
export function workspaceOf(pathname: string): Workspace | null {
  if (pathname === '/attendance' || pathname.startsWith('/attendance/')) return 'attendance';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return 'tasks';
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return 'assets';
  if (['/people', '/roles', '/settings'].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'admin';
  return null;
}

export const WORKSPACE_NAMES: Record<Workspace, string> = { attendance: 'Attendance', tasks: 'Tasks', assets: 'Assets', admin: 'Admin' };
export const WORKSPACE_HOME: Record<Workspace, string> = { attendance: '/attendance', tasks: '/tasks', assets: '/assets', admin: '/people' };
