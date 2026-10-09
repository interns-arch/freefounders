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
  primary: 'border-primary/25 bg-primary/10 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/35 bg-warning/12 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info/10 text-info',
};

/** A small coloured label (status, priority, counts). */
export function Chip({ tone = 'neutral', className, children, ...rest }: { tone?: Tone; className?: string; children: ReactNode } & React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium', CHIP[tone], className)} {...rest}>
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
    <p role="alert" className={cn('rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive', className)}>
      {children}
    </p>
  );
}

export function OkNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="status" className={cn('rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success', className)}>
      {children}
    </p>
  );
}

/** A card with a heading row (title on the left, actions on the right). */
export function Panel({
  title,
  actions,
  description,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2 sm:px-5">
          {title && <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {description && <p className="px-4 pb-2 text-[13px] text-muted-foreground sm:px-5">{description}</p>}
      <div className={cn('px-4 pb-4 sm:px-5', !title && !actions && 'pt-4', bodyClassName)}>{children}</div>
    </Card>
  );
}

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/12 text-info',
};

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
    <Card className={cn('flex h-full items-start justify-between gap-3 p-4', alert && 'border-destructive/40 bg-destructive/5', to && 'transition hover:border-primary/40 hover:shadow-sm')}>
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
        <p className={cn('mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums', alert && 'text-destructive')}>{value}</p>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
      {Icon && (
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', ICON_TONE[alert ? 'danger' : tone])}>
          <Icon className="size-4.5" />
        </span>
      )}
    </Card>
  );
  if (!to) return body;
  const cls = 'block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40';
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
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border bg-muted/50 p-0.5', className)}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
            value === v && 'bg-card text-foreground shadow-xs',
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
export function NotAllowed({ what = 'this page' }: { what?: string }) {
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
