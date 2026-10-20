import { countLabel, type TaskPriority, type TaskStatus } from '@freefounders/core/tasks';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { chipActiveClass, chipClass, chipIdleClass } from '@/components/common/controls';
import { cn } from '@/lib/utils';

/* Soft-tinted pills, the way the old Tasks app drew status and priority (rounded, bold, tinted background, no border). */
const PILL = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-bold tracking-[0.01em] [&>svg]:size-3';
const STATUS_PILL: Record<TaskStatus, string> = {
  open: 'bg-info/10 text-info',
  in_progress: 'bg-warning/12 text-warning',
  done: 'bg-primary/8 text-primary',
};
const PRIORITY_PILL: Record<TaskPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-muted text-muted-foreground',
  high: 'bg-warning/12 text-warning',
  urgent: 'bg-destructive/10 text-destructive',
};

/** Open / In progress / Done as a tinted label (the text says the status, so colour is not the only cue). */
export function StatusPill({ status, label, className }: { status: TaskStatus; label: string; className?: string }) {
  return (
    <span className={cn(PILL, STATUS_PILL[status], className)}>
      {label}
    </span>
  );
}

/** High / Urgent / Low as a tinted pill ("normal" is never shown). */
export function PriorityPill({ priority, label, className }: { priority: TaskPriority; label: string; className?: string }) {
  return <span className={cn(PILL, PRIORITY_PILL[priority], className)}>{label}</span>;
}

/** The task code ("T-00042") in a small monospace pill. */
export function TaskCode({ code, className }: { code: string; className?: string }) {
  return <span className={cn('shrink-0 rounded-md border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-muted-foreground', className)}>{code}</span>;
}

/**
 * The red count on the My Tasks / To accept / Requests tabs (original app d0a1bdf): a round counter like the bell's,
 * 1–9, then 9+ and 99+. Nothing when there is nothing waiting.
 */
export function TabCount({ n, className }: { n: number | null | undefined; className?: string }) {
  const label = countLabel(n);
  if (!label) return null;
  return (
    <span
      aria-label={`${n} waiting`}
      className={cn('inline-grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 font-mono text-[10px] leading-[16px] font-bold text-white tabular dark:text-background', className)}
    >
      {label}
    </span>
  );
}

/** A small count beside a heading or a tab ("To accept 3"): the old app's count-pill. */
export function CountPill({ children, tone = 'primary', className }: { children: ReactNode; tone?: 'primary' | 'neutral' | 'danger'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-sm px-1.5 py-px font-mono text-[11px] font-semibold tabular',
        tone === 'primary' && 'bg-card text-primary ring-1 ring-inset ring-primary/25',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'danger' && 'bg-destructive/10 text-destructive',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small neutral tag on a task row (category, group, recurrence…). */
export function Chip({ children, title, tone = 'outline', className }: { children: ReactNode; title?: string; tone?: BadgeTone; className?: string }) {
  return (
    <Badge tone={tone} title={title} className={cn('px-2 font-medium', tone === 'outline' && 'bg-card text-muted-foreground', className)}>
      {children}
    </Badge>
  );
}

export { Segmented } from '@/components/common/controls';

/** A filter that is on or off (Overdue only, Recurring only). `tone="danger"` lights up red, like the old overdue chip. */
export function ToggleChip({ on, onChange, children, title, tone = 'primary' }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string; tone?: 'primary' | 'danger' }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        chipClass,
        'h-9 font-semibold',
        !on && chipIdleClass,
        on && tone === 'primary' && chipActiveClass,
        on && tone === 'danger' && 'border-destructive/50 bg-destructive/10 text-destructive hover:border-destructive/60 hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A number with a small uppercase label above it: the old app's stat tiles (dashboard, reports, profile).
 * `tone="alert"` draws it red with a faint red wash, `tone="good"` green. Click opens the matching list when given.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  onClick,
  title,
  active,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'alert' | 'good';
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] leading-tight font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
        <p className={cn('mt-1 font-mono text-[26px] leading-none font-bold tracking-tight tabular', tone === 'alert' && 'text-destructive', tone === 'good' && 'text-success')}>{value}</p>
        {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary', tone === 'alert' && 'bg-destructive/10 text-destructive', tone === 'good' && 'bg-success/10 text-success')}>
          <Icon className="size-4" />
        </span>
      )}
    </>
  );
  const cls = cn(
    'flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs',
    tone === 'alert' && 'border-destructive/35 bg-destructive/4',
    tone === 'good' && 'bg-success/4',
    active && 'ring-2 ring-primary/40',
    className,
  );
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cn(cls, 'cursor-pointer transition hover:border-primary/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A label above a number (report tiles, profile stats). Same look as StatTile, a little smaller. */
export function MiniStat({ label, value, tone, hint, onClick }: { label: string; value: ReactNode; tone?: 'bad' | 'good'; hint?: ReactNode; onClick?: () => void }) {
  return <StatTile label={label} value={value} hint={hint} tone={tone === 'bad' ? 'alert' : tone === 'good' ? 'good' : undefined} onClick={onClick} className="p-3" />;
}

/** A section heading with an optional count and a hairline that runs to the right (the old app's "dash-band"). */
export function SectionHead({ title, count, extra, className, id }: { title: ReactNode; count?: ReactNode; extra?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <h3 id={id} className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
        {count !== undefined && count !== null && <CountPill tone="neutral">{count}</CountPill>}
      </h3>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      {extra && <span className="text-xs text-muted-foreground">{extra}</span>}
    </div>
  );
}

/** A row of "n something" facts (50 tasks · 24 overdue…) with the numbers in mono. */
export function FactRow({ facts, className }: { facts: Array<{ n: ReactNode; label: string; tone?: 'danger' | 'good' | 'warn' | 'strong' }>; className?: string }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground', className)}>
      {facts.map((f, i) => (
        <span key={`${f.label}-${i}`} className={cn('inline-flex items-center gap-1', f.tone === 'danger' && 'text-destructive', f.tone === 'good' && 'text-success', f.tone === 'warn' && 'text-warning', f.tone === 'strong' && 'text-foreground')}>
          <strong className="font-mono text-sm font-semibold tabular">{f.n}</strong> {f.label}
        </span>
      ))}
    </p>
  );
}
