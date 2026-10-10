/** Small presentational pieces shared by the general Tasks screens and HR (no data, theme colours only). */
import { useAccess } from '@freefounders/core';
import type { TaskPriority, TaskStatus } from '@freefounders/core/tasks';
import { ShieldAlert } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router';
import { EmptyState, PageLoader } from '@/components/common/page';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const CHIP: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  primary: 'border-primary/20 bg-primary/10 text-primary',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/12 text-warning',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
  info: 'border-info/25 bg-info/10 text-info',
};

/** Solid tints for small count pills (the old app's badge). */
const PILL: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/14 text-success',
  warning: 'bg-warning/16 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  info: 'bg-info/14 text-info',
};

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/12 text-info',
};

/** A small round count (e.g. "3" next to a tab or a title). */
export function CountPill({ tone = 'neutral', className, children, ...rest }: { tone?: Tone; className?: string; children: ReactNode } & React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-semibold tabular-nums', PILL[tone], className)} {...rest}>
      {children}
    </span>
  );
}

/** A small coloured label (status, priority, counts). */
export function Chip({ tone = 'neutral', className, children, ...rest }: { tone?: Tone; className?: string; children: ReactNode } & React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold leading-[1.15rem]', CHIP[tone], className)} {...rest}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<TaskStatus, Tone> = { open: 'info', in_progress: 'warning', done: 'success' };
const PRIORITY_TONE: Record<TaskPriority, Tone> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };

export function TaskStatusChip({ status, label }: { status: TaskStatus; label: string }) {
  return <Chip tone={STATUS_TONE[status] ?? 'neutral'}>{label}</Chip>;
}
export function PriorityChip({ priority, label }: { priority: TaskPriority; label: string }) {
  return <Chip tone={PRIORITY_TONE[priority] ?? 'neutral'}>{label}</Chip>;
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn('rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm font-medium text-destructive', className)}>
      {children}
    </p>
  );
}

export function OkNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="status" className={cn('rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm font-semibold text-success', className)}>
      {children}
    </p>
  );
}

/** A card with a heading row (title on the left, actions on the right); `icon` adds a tinted bubble before the title. */
export function Panel({
  title,
  actions,
  description,
  icon: Icon,
  tone = 'primary',
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHead = !!(title || actions);
  return (
    <Card className={cn('min-w-0', className)}>
      {hasHead && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 sm:px-5">
          {title && (
            <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-bold tracking-tight">
              {Icon && (
                <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', ICON_TONE[tone])}>
                  <Icon className="size-4" />
                </span>
              )}
              {title}
            </h2>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {description && <p className={cn('px-4 pb-2.5 text-[13px] text-muted-foreground sm:px-5', !hasHead && 'pt-4')}>{description}</p>}
      <div className={cn('px-4 pb-4 sm:px-5', !hasHead && !description && 'pt-4', bodyClassName)}>{children}</div>
    </Card>
  );
}

/** A section heading between groups of cards ("MY WORK", "TEAM"). */
export function SectionHead({ children, className, actions }: { children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 pt-1', className)}>
      <h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
        <span aria-hidden className="h-3 w-1 rounded-full bg-gradient-to-b from-brand-2 to-primary" />
        {children}
      </h2>
      {actions}
    </div>
  );
}

/** A quiet "nothing here" note inside a card (icon bubble + a line of text). */
export function Empty({ icon: Icon, children, className, action }: { icon?: ComponentType<{ className?: string }>; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-7 text-center text-sm text-muted-foreground', className)}>
      {Icon && (
        <span className="flex size-10 items-center justify-center rounded-xl border border-dashed bg-muted/40">
          <Icon className="size-4.5" />
        </span>
      )}
      <span>{children}</span>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A number tile; with `to` it opens that list. */
export function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'primary',
  alert,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  alert?: boolean;
  to?: string;
}) {
  const body = (
    <Card
      className={cn(
        'flex h-full items-center gap-3.5 p-4 transition-[box-shadow,border-color,transform] duration-150',
        alert && 'border-destructive/35 bg-gradient-to-b from-card to-destructive/6',
        to && 'hover:-translate-y-px hover:border-primary/40 hover:shadow-[0_6px_18px_-8px_rgb(0_0_0/0.18)]',
      )}
    >
      {Icon && (
        <span className={cn('hidden size-10 shrink-0 items-center justify-center rounded-xl min-[420px]:flex sm:size-11', ICON_TONE[alert ? 'danger' : tone])}>
          <Icon className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10.5px] leading-[1.2] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
        <p className={cn('mt-0.5 font-mono text-[22px] leading-tight font-bold tracking-tight whitespace-nowrap tabular-nums sm:text-[25px]', alert && 'text-destructive')}>{value}</p>
        {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
    </Card>
  );
  if (!to) return body;
  const cls = 'block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40';
  return (
    <Link to={to} className={cls}>
      {body}
    </Link>
  );
}

/** A link that works for in-app paths and for outside URLs (new tab). */
export function SmartLink({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode } & Omit<React.ComponentProps<'a'>, 'href'>) {
  if (/^https?:\/\//.test(to)) {
    return (
      <a href={to} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} {...rest}>
      {children}
    </Link>
  );
}

/** A row of toggle buttons (one is on). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, ReactNode]>;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full flex-wrap gap-0.5 rounded-full border bg-muted/60 p-0.5', className)}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
            value === v && 'bg-card font-semibold text-primary shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-border',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** ▲ 6.4 / ▼ 12 / no change / — (no earlier period). */
export function Delta({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(value) < 0.05) return <span className="text-muted-foreground">no change</span>;
  const up = value > 0;
  return (
    <span className={cn('font-semibold', up ? 'text-success' : 'text-destructive')} title={`${up ? 'Up' : 'Down'} ${Math.abs(value)}${suffix} since the previous period`}>
      {up ? '▲' : '▼'} {Math.abs(value)}
      {suffix}
    </span>
  );
}

/** Shown in place of a screen the person may not open. */
function NotAllowed({ what = 'this page' }: { what?: string }) {
  return <EmptyState icon={ShieldAlert} title={`You cannot open ${what}`} description="Ask an admin if you need access." />;
}

/** Renders children only when the Tasks capability check passes (waits for /me). */
export function RequireTasks({ allow, what, children }: { allow: (a: ReturnType<typeof useAccess>) => boolean; what?: string; children: ReactNode }) {
  const access = useAccess();
  if (!access.ready || !access.tasks.me) return <PageLoader />;
  return allow(access) ? <>{children}</> : <NotAllowed what={what} />;
}

// ─── formatting ──────────────────────────────────────────────────────────

/** "8 Oct" from YYYY-MM-DD. */
export const fmtDay = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
/** "05:30 pm" from an ISO instant, or "—". */
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
/** "8 Oct, 05:30 pm", or "—". */
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
/** Today as YYYY-MM-DD (local). */
export function todayLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
