/** Small pieces shared by the Kaampilot console screens (PLAN.md §21.9). */
import { useAccess } from '@freefounders/core';
import type { LogLevel } from '@freefounders/core/billing';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Kaampilot staff only: `{ready, staff}`; screens send everyone else Home (the API answers 403 anyway). */
export function useStaff() {
  const access = useAccess();
  return { ready: access.ready, staff: !!access.platform?.account?.isStaff };
}

/** One number on a card: label above, value below (a skeleton while loading). */
export function StatTile({ label, value, hint, loading, tone }: { label: string; value: ReactNode; hint?: ReactNode; loading?: boolean; tone?: 'danger' | 'warning' }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 shadow-card">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 font-mono text-xl font-bold tabular-nums', tone === 'danger' && 'text-destructive', tone === 'warning' && 'text-warning')}>
        {loading ? <Skeleton className="h-7 w-16" /> : (value ?? '—')}
      </dd>
      {hint && !loading && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A titled block (a `region` named by its heading). */
export function Section({ id, title, actions, children, className }: { id: string; title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const LEVEL_TONE: Record<LogLevel, BadgeTone> = { error: 'red', warn: 'amber', info: 'blue' };
const LEVEL_LABEL: Record<LogLevel, string> = { error: 'Error', warn: 'Warning', info: 'Info' };
export function LevelBadge({ level }: { level: LogLevel }) {
  return <Badge tone={LEVEL_TONE[level] ?? 'neutral'}>{LEVEL_LABEL[level] ?? level}</Badge>;
}

export const SERVICE_LABELS: Record<string, string> = { platform: 'Platform', tasks: 'Tasks', 'tasks-worker': 'Tasks worker', assets: 'Assets' };

/** "3 min ago" for recent times, else the date and time. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
