import { AlertTriangle, ChevronRight, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@freefounders/core';
import { cn } from '@/lib/utils';

/** Page title block (the old app's "Good morning, Demo" header): big bold title, a quiet line under it, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; to: string }[];
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && (
          <nav className="mb-2 flex items-center gap-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase" aria-label="Breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={b.to} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 opacity-50" aria-hidden />}
                <Link to={b.to} className="rounded px-0.5 transition hover:text-primary">
                  {b.label}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-[26px] leading-tight font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/15 bg-gradient-to-br from-accent to-card shadow-card">
        <Icon className="size-6 text-primary" />
        <span aria-hidden className="absolute -right-1 -bottom-1 size-3 rounded-full border-2 border-card bg-brand-2" />
      </div>
      <p className="text-[15px] font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13.5px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/8">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <p className="text-[15px] font-semibold">Couldn’t load this</p>
      <p className="mt-1 max-w-sm text-[13.5px] text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RotateCcw /> Try again
        </Button>
      )}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}

/** Label / value pairs for detail pages. */
export function DetailList({ items, className, columns = 2 }: { items: { label: string; value: ReactNode; full?: boolean }[]; className?: string; columns?: 1 | 2 | 3 }) {
  const grid = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', grid, className)}>
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0', it.full && 'sm:col-span-full')}>
          <dt className="font-mono text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium">
            {it.value === null || it.value === undefined || it.value === '' ? <span className="font-normal text-muted-foreground">—</span> : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
