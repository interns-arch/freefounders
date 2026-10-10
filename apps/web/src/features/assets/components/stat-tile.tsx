import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'primary' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'indigo';

const TONES: Record<StatTone, { bubble: string; glow: string; value: string }> = {
  default: { bubble: 'bg-muted text-muted-foreground', glow: 'from-muted-foreground/10', value: '' },
  primary: { bubble: 'bg-primary/12 text-primary dark:bg-primary/18', glow: 'from-primary/14', value: '' },
  blue: { bubble: 'bg-info/12 text-info dark:bg-info/18', glow: 'from-info/14', value: '' },
  green: { bubble: 'bg-success/12 text-success dark:bg-success/18', glow: 'from-success/14', value: '' },
  amber: { bubble: 'bg-warning/12 text-warning dark:bg-warning/18', glow: 'from-warning/16', value: 'text-warning' },
  red: { bubble: 'bg-destructive/12 text-destructive dark:bg-destructive/18', glow: 'from-destructive/14', value: 'text-destructive' },
  violet: { bubble: 'bg-app-attendance/12 text-app-attendance dark:bg-app-attendance/18', glow: 'from-app-attendance/14', value: '' },
  indigo: { bubble: 'bg-app-assets/12 text-app-assets dark:bg-app-assets/18', glow: 'from-app-assets/14', value: '' },
};

/**
 * Stat tile for the Assets dashboards: a soft-tinted icon bubble, a faint glow of the same tone in the corner (as on
 * the Workspace Portal cards), a mono uppercase label and a big tabular number. Links lift on hover.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  to,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  const body = (
    <div
      className={cn(
        'relative flex h-full items-start justify-between gap-3 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition',
        to && 'group-hover:-translate-y-px group-hover:border-primary/35 group-hover:shadow-md group-hover:shadow-primary/5',
        className,
      )}
    >
      <span className={cn('pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-gradient-to-br to-transparent blur-2xl', t.glow)} aria-hidden />
      <div className="relative min-w-0">
        <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
        {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className={cn('mt-1.5 font-mono text-[28px] leading-none font-semibold tracking-tight tabular', t.value)}>{value}</p>}
        {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-xl', t.bubble)}>
          <Icon className="size-5" />
        </span>
      )}
    </div>
  );
  return to ? (
    <Link to={to} className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
      {body}
    </Link>
  ) : (
    body
  );
}
