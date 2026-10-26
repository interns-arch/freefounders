/**
 * /notifications (and /tasks/notifications): every notification of every app, grouped by area (PLAN.md §19.37):
 * All · Attendance · Tasks · Assets · Approvals · Company with their unread counts (?tab= in the address). Opening one
 * marks it read and goes to its page; "Mark all read" marks the open tab. Tasks rows also show what the email /
 * WhatsApp copies did and can be deleted for good (Clear read / Clear all: Tasks notifications, on the All tab).
 */
import {
  NOTIFICATION_TABS,
  type NotificationTab,
  type UnifiedNotification,
  errorMessage,
  useAccess,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useNotificationCounts,
  useNotifications,
} from '@freefounders/core';
import { tasksExports, useClearTaskNotifications, useDeleteTaskNotification } from '@freefounders/core/tasks';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { useSearchParams } from 'react-router';
import { DownloadMenu } from '@/components/common/download-menu';
import { NotificationTabs, NotificationText } from '@/components/common/notifications';
import { Bell, Mail, MessageCircle, X } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, SmartLink, fmtWhen } from './parts';

const CHANNEL_TONE: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = { sent: 'success', delivered: 'success', failed: 'danger', skipped: 'neutral', queued: 'warning' };
const TAB_KEYS = NOTIFICATION_TABS.map((t) => t.key) as string[];
const EMPTY: Record<NotificationTab, string> = {
  all: 'Task assignments, reminders, approvals, leave decisions, asset requests and notices show up here.',
  attendance: 'Leave decisions and attendance news show up here.',
  tasks: 'Tasks given to you, reminders, comments, leads and mistakes show up here.',
  assets: 'Assets given to you, tickets, requests and exits show up here.',
  approvals: 'Leave, corrections, task changes, finished work and asset requests waiting for you show up here.',
  company: 'Notices from your company show up here.',
  visitors: 'Visitors at the gate for you and overstay alerts show up here.',
};

export function NotificationsPage() {
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') ?? 'all';
  const tab = (TAB_KEYS.includes(asked) ? asked : 'all') as NotificationTab;
  const setTab = (t: NotificationTab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'all') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );
  const q = useNotifications(tab, 100);
  const counts = useNotificationCounts();
  const markOne = useMarkNotificationRead();
  const readAll = useMarkNotificationsRead();
  const clear = useClearTaskNotifications();
  const del = useDeleteTaskNotification();
  const confirm = useConfirm();
  const rows = q.data ?? [];
  const tasksRows = rows.filter((r) => r.app === 'tasks');
  const busy = clear.isPending || readAll.isPending;
  const error = clear.error ?? del.error ?? readAll.error;
  const tasksOn = !!access.claims?.apps?.tasks;

  // Deleting for good, so it asks first and says exactly how many go.
  const clearAll = async (onlyRead: boolean) => {
    const n = onlyRead ? tasksRows.filter((r) => r.read).length : tasksRows.length;
    const unread = tasksRows.filter((r) => !r.read).length;
    const ok = await confirm({
      title: onlyRead ? `Delete ${n} Tasks notification${n === 1 ? '' : 's'} you have already read?` : `Delete all ${n} Tasks notification${n === 1 ? '' : 's'}?`,
      description: (
        <>
          {!onlyRead && unread > 0 && (
            <p>
              {unread} of them {unread === 1 ? 'is' : 'are'} still unread.
            </p>
          )}
          <p>This cannot be undone.</p>
        </>
      ),
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok.confirmed) clear.mutate(onlyRead);
  };

  const open = (n: UnifiedNotification) => {
    if (!n.read) markOne.mutate(n);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        className="mb-0"
        title="Notifications"
        actions={
          <>
            {tasksOn && (
              <DownloadMenu target={tasksExports.notifications()} filename={fileSlug('tasks', 'notifications', todayStamp())} empty={!!q.data && tasksRows.length === 0} loading={!q.data && !q.error} size="default" />
            )}
            {(counts.data?.[tab] ?? 0) > 0 && (
              <Button variant="outline" onClick={() => readAll.mutate(tab)} disabled={busy}>
                Mark all read
              </Button>
            )}
            {tab === 'all' && tasksRows.some((n) => n.read) && (
              <Button variant="outline" onClick={() => clearAll(true)} disabled={busy}>
                Clear read
              </Button>
            )}
            {tab === 'all' && tasksRows.length > 0 && (
              <Button variant="destructive" onClick={() => clearAll(false)} disabled={busy}>
                {clear.isPending ? 'Clearing…' : 'Clear all'}
              </Button>
            )}
          </>
        }
      />
      <NotificationTabs tab={tab} onTab={setTab} counts={counts.data} controls="notification-list" />
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-48" />}
      {q.data && rows.length === 0 && (
        <Card>
          <EmptyState icon={Bell} title="Nothing here" description={EMPTY[tab]} />
        </Card>
      )}
      <ul id="notification-list" role="tabpanel" className="grid gap-2">
        {rows.map((n) => {
          const extra = n.channels?.map((c) => (
            <Chip key={c.channel} tone={CHANNEL_TONE[c.status] ?? 'neutral'} title={c.detail || c.status} className="font-sans">
              {c.channel === 'gmail' ? <Mail className="size-3" /> : <MessageCircle className="size-3" />} {c.status}
            </Chip>
          ));
          const text = <NotificationText n={n} when={fmtWhen(n.createdAt)} extra={extra} />;
          return (
            <li key={n.id} className={cn('flex items-start gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors hover:border-primary/40', !n.read && 'border-l-4 border-primary/30 border-l-primary bg-primary/5')}>
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', n.read ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
                <Bell className="size-4" />
              </span>
              {n.href ? (
                <SmartLink to={n.href} onClick={() => open(n)} className="flex min-w-0 flex-1 rounded-sm outline-none hover:[&_span:first-child]:underline focus-visible:ring-[3px] focus-visible:ring-ring/40">
                  {text}
                </SmartLink>
              ) : (
                <button type="button" className="flex min-w-0 flex-1 cursor-pointer text-left" onClick={() => open(n)}>
                  {text}
                </button>
              )}
              {!n.read && (
                <Button size="xs" variant="ghost" className="shrink-0" onClick={() => open(n)} aria-label={`Mark read: ${n.title}`}>
                  Mark read
                </Button>
              )}
              {n.app === 'tasks' && (
                <Button size="icon-xs" variant="ghost" title="Delete this notification" aria-label={`Delete notification: ${n.title}`} onClick={() => del.mutate(Number(n.rawId))}>
                  <X />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
