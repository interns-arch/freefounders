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
  /** Screens not moved yet (PLAN.md §18.3): a full page load into the classic app, e.g. "/classic/tasks/leads". */
  classic?: boolean;
  /** Section heading this item sits under in the sidebar (optional). */
  group?: string;
}

export type Workspace = 'attendance' | 'tasks' | 'assets' | 'admin';

/** Which workspace a path belongs to. */
export function workspaceOf(pathname: string): Workspace | null {
  if (pathname === '/attendance' || pathname.startsWith('/attendance/')) return 'attendance';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return 'tasks';
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return 'assets';
  if (['/people', '/roles', '/settings', '/account'].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'admin';
  return null;
}

export const WORKSPACE_NAMES: Record<Workspace, string> = { attendance: 'Attendance', tasks: 'Tasks', assets: 'Assets', admin: 'Admin' };
export const WORKSPACE_HOME: Record<Workspace, string> = { attendance: '/attendance', tasks: '/tasks', assets: '/assets', admin: '/people' };
