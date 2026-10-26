/**
 * Notifications grouped by area (PLAN.md §19.37), shared by the bell and the Notifications screen: the area tabs with
 * their unread counts, and one row per notification. Unread = bold title on a light tint with a bar in the theme colour
 * on the left (no dots, no capsules, CLAUDE.md). Data comes from the screens (core hooks); this file only draws.
 */
import { NOTIFICATION_TABS, type NotificationArea, type NotificationTab, type UnifiedNotification } from '@kaampilot/core';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const AREA_LABEL: Record<NotificationArea, string> = {
  attendance: 'Attendance',
  tasks: 'Tasks',
  assets: 'Assets',
  approvals: 'Approvals',
  company: 'Company',
  visitors: 'Visitors',
};

/** The area tabs; arrow keys move between them (ARIA tabs). */
export function NotificationTabs({
  tab,
  onTab,
  counts,
  compact,
  controls,
}: {
  tab: NotificationTab;
  onTab: (t: NotificationTab) => void;
  counts?: Partial<Record<NotificationTab, number>>;
  compact?: boolean;
  /** The id of the list the tabs control. */
  controls: string;
}) {
  const keys = NOTIFICATION_TABS.map((t) => t.key);
  return (
    <div
      role="tablist"
      aria-label="Notification areas"
      className={cn('flex gap-1', compact ? 'flex-wrap px-3 py-2' : 'overflow-x-auto pb-1 scrollbar-thin')}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = keys[(keys.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
        onTab(next);
        (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {NOTIFICATION_TABS.map((t) => {
        const n = counts?.[t.key] ?? 0;
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab={t.key}
            aria-selected={active}
            aria-controls={controls}
            tabIndex={active ? 0 : -1}
            aria-label={n ? `${t.label}, ${n} unread` : t.label}
            onClick={() => onTab(t.key)}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              compact ? 'h-8 text-xs' : 'h-9 text-sm',
              active ? 'border-primary/40 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t.label}
            {n > 0 && (
              <span aria-hidden className={cn('min-w-5 rounded-sm px-1 text-center font-mono text-[11px] leading-[18px] font-semibold', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                {n > 99 ? '99+' : n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The look of one row: unread is bold with a bar on the left. The caller decides what clicking does. */
export function notificationRowClass(n: Pick<UnifiedNotification, 'read'>) {
  return cn('transition-colors hover:bg-accent/60', !n.read && 'bg-primary/5 shadow-[inset_3px_0_0_0_var(--primary)]');
}

/** Title, message and "Area · when" of one notification. */
export function NotificationText({ n, when, clamp, extra }: { n: UnifiedNotification; when: string; clamp?: boolean; extra?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn('block text-sm', clamp && 'truncate', n.read ? 'font-medium text-foreground/90' : 'font-bold text-foreground')}>
        {!n.read && <span className="sr-only">Unread: </span>}
        {n.title}
      </span>
      {n.body && <span className={cn('block text-xs text-muted-foreground', clamp ? 'line-clamp-2' : 'mt-0.5 text-sm whitespace-pre-line')}>{n.body}</span>}
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
        {AREA_LABEL[n.category]} · {when}
        {extra}
      </span>
    </span>
  );
}
