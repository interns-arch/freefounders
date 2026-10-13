import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'primary' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'indigo';

const TONES: Record<StatTone, { bubble: string; value: string }> = {
  default: { bubble: 'bg-muted text-muted-foreground', value: '' },
  primary: { bubble: 'bg-primary/8 text-primary dark:bg-primary/12', value: '' },
  blue: { bubble: 'bg-info/10 text-info', value: '' },
  green: { bubble: 'bg-success/10 text-success', value: '' },
  amber: { bubble: 'bg-warning/10 text-warning', value: 'text-warning' },
  red: { bubble: 'bg-destructive/10 text-destructive', value: 'text-destructive' },
  violet: { bubble: 'bg-app-attendance/10 text-app-attendance', value: '' },
  indigo: { bubble: 'bg-app-assets/10 text-app-assets', value: '' },
};

/**
 * Stat tile for the Assets dashboards (flat, PLAN.md §19.22): a tinted icon chip, a mono uppercase label and a big
 * tabular number. Links get a blue border and a slightly raised shadow on hover.
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
        'relative flex h-full items-start justify-between gap-3 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-card transition',
        to && 'group-hover:border-primary/35 group-hover:shadow-card-lg',
        className,
      )}
    >
      <div className="relative min-w-0">
        <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
        {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className={cn('mt-1.5 font-mono text-[28px] leading-none font-semibold tracking-tight tabular', t.value)}>{value}</p>}
        {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-lg', t.bubble)}>
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
