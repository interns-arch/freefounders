import { useAccess } from '@freefounders/core';
import { APP_NAMES, type SyncResult } from '@freefounders/core/admin';
import { AlertCircle } from 'lucide-react';
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
const APP_DOT: Record<string, string> = { tasks: 'bg-app-tasks', assets: 'bg-app-assets' };

/** "Tasks" / "Assets" chip in the app's colour. */
export function AppChip({ app, className }: { app: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-[1.5] whitespace-nowrap',
        APP_TONE[app] ?? 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', APP_DOT[app] ?? 'bg-current')} aria-hidden />
      {APP_NAMES[app as keyof typeof APP_NAMES] ?? app}
    </span>
  );
}

/** Small status chip (Locked, Inactive, Leaving …). */
export function Pill({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'warning' | 'admin' | 'info' | 'success'; children: ReactNode; className?: string }) {
  const cls = {
    neutral: 'border-border bg-muted text-muted-foreground',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    admin: 'border-app-admin/25 bg-app-admin/10 text-app-admin',
    info: 'border-info/25 bg-info/10 text-info',
    success: 'border-success/25 bg-success/10 text-success',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-[1.5] whitespace-nowrap', cls, className)}>{children}</span>;
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn('flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive', className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
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
