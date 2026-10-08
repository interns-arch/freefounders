import { useAccess } from '@freefounders/core';
import { APP_NAMES, type SyncResult } from '@freefounders/core/admin';
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

/** Admin screens are for owners and admins only; anyone else goes back to the start page. */
export function AdminOnly() {
  const access = useAccess();
  if (access.ready && !access.isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

const APP_TONE: Record<string, string> = {
  tasks: 'bg-app-tasks/12 text-app-tasks border-app-tasks/25',
  assets: 'bg-app-assets/12 text-app-assets border-app-assets/25',
};

/** "Tasks" / "Assets" chip in the app's colour. */
export function AppChip({ app, className }: { app: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium', APP_TONE[app] ?? 'bg-muted text-muted-foreground', className)}>
      {APP_NAMES[app as keyof typeof APP_NAMES] ?? app}
    </span>
  );
}

/** Small status chip (Locked, Inactive, Leaving …). */
export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'warning' | 'admin'; children: ReactNode }) {
  const cls = {
    neutral: 'border-border bg-muted text-muted-foreground',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    admin: 'border-app-admin/25 bg-app-admin/10 text-app-admin',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{children}</span>;
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn('rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive', className)}>
      {children}
    </p>
  );
}

/** The change was saved, but an app could not be told yet (sent again automatically on the next change). */
export function SyncNote({ sync }: { sync?: SyncResult }) {
  const failed = Object.entries(sync ?? {}).filter(([, r]) => r !== 'ok');
  if (!failed.length) return null;
  return (
    <ErrorNote>
      Saved, but {failed.map(([a]) => APP_NAMES[a as keyof typeof APP_NAMES] ?? a).join(' and ')} could not be updated yet. It is sent again automatically
      on the next change.
    </ErrorNote>
  );
}
