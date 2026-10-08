import type { TaskPriority, TaskStatus } from '@freefounders/core/tasks';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = { low: 'gray', normal: 'neutral', high: 'orange', urgent: 'red' };
export const STATUS_TONE: Record<TaskStatus, BadgeTone> = { open: 'gray', in_progress: 'blue', done: 'green' };

/** The task code ("T-00042") in a small monospace pill. */
export function TaskCode({ code, className }: { code: string; className?: string }) {
  return <span className={cn('shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground', className)}>{code}</span>;
}

/** A small neutral tag on a task row (category, group, recurrence…). */
export function Chip({ children, title, tone = 'outline' }: { children: ReactNode; title?: string; tone?: BadgeTone }) {
  return (
    <Badge tone={tone} title={title} className="font-normal">
      {children}
    </Badge>
  );
}

/** Two-to-four buttons that behave like tabs (Open / Done / All…). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: Array<[T, string]>; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5', className)}>
      {options.map(([v, l]) => (
        <button
          key={`${v}-${l}`}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition hover:text-foreground',
            value === v && 'bg-card text-foreground shadow-xs',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** A filter that is on or off (Overdue only, Recurring only). */
export function ToggleChip({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium text-muted-foreground transition hover:text-foreground [&_svg]:size-3.5',
        on && 'border-primary/40 bg-primary/10 text-primary hover:text-primary',
      )}
    >
      {children}
    </button>
  );
}

/** A label above a number (report tiles, profile stats). */
export function MiniStat({ label, value, tone, hint, onClick }: { label: string; value: ReactNode; tone?: 'bad' | 'good'; hint?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn('text-2xl font-semibold tracking-tight tabular', tone === 'bad' && 'text-destructive', tone === 'good' && 'text-success')}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = 'flex flex-col gap-0.5 rounded-xl border bg-card p-3 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'cursor-pointer transition hover:border-primary/40 hover:shadow-sm')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
