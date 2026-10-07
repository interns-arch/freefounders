import { AlertTriangle, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

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
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && (
          <nav className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((b, i) => (
              <span key={b.to} className="flex items-center gap-1">
                {i > 0 && <span className="opacity-50">/</span>}
                <Link to={b.to} className="hover:text-foreground">
                  {b.label}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
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
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted/50">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/40">
        <AlertTriangle className="size-5 text-red-600 dark:text-red-400" />
      </div>
      <p className="text-sm font-medium">Couldn’t load this</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCcw /> Try again
        </Button>
      )}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
  to?: string;
  loading?: boolean;
}) {
  const toneClass = {
    default: 'bg-muted text-muted-foreground',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  }[tone];
  const body = (
    <Card className={cn('flex items-start justify-between gap-3 p-4', to && 'transition hover:border-primary/40 hover:shadow-sm')}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>}
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneClass)}>
          <Icon className="size-4.5" />
        </span>
      )}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Label / value pairs for detail pages. */
export function DetailList({ items, className, columns = 2 }: { items: { label: string; value: ReactNode; full?: boolean }[]; className?: string; columns?: 1 | 2 | 3 }) {
  const grid = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3.5', grid, className)}>
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0', it.full && 'sm:col-span-full')}>
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{it.value === null || it.value === undefined || it.value === '' ? <span className="text-muted-foreground">—</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
