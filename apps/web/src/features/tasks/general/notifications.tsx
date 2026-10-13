/** /tasks/notifications — every Tasks notification, with its link (old pages/Notifications.jsx). */
import { errorMessage } from '@freefounders/core';
import {
  type TaskNotification,
  useClearTaskNotifications,
  useDeleteTaskNotification,
  useMarkAllTaskNotificationsRead,
  useMarkTaskNotificationRead,
  useTaskNotifications,
} from '@freefounders/core/tasks';
import { Bell, Mail, MessageCircle, X } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, SmartLink, fmtWhen } from './parts';

const CHANNEL_TONE: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = { sent: 'success', delivered: 'success', failed: 'danger', skipped: 'neutral', queued: 'warning' };

export function NotificationsPage() {
  const q = useTaskNotifications();
  const markRead = useMarkTaskNotificationRead();
  const readAll = useMarkAllTaskNotificationsRead();
  const clear = useClearTaskNotifications();
  const del = useDeleteTaskNotification();
  const confirm = useConfirm();
  const rows = q.data ?? [];
  const busy = clear.isPending || readAll.isPending;
  const error = clear.error ?? del.error ?? readAll.error;

  // Deleting for good, so it asks first and says exactly how many go.
  const clearAll = async (onlyRead: boolean) => {
    const n = onlyRead ? rows.filter((r) => r.read_at).length : rows.length;
    const unread = rows.filter((r) => !r.read_at).length;
    const ok = await confirm({
      title: onlyRead ? `Delete ${n} notification${n === 1 ? '' : 's'} you have already read?` : `Delete all ${n} notification${n === 1 ? '' : 's'}?`,
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

  const open = (n: TaskNotification) => {
    if (!n.read_at) markRead.mutate(n.id);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        className="mb-0"
        title="Notifications"
        actions={
          <>
            {rows.some((n) => !n.read_at) && (
              <Button variant="outline" onClick={() => readAll.mutate()} disabled={busy}>
                Mark all read
              </Button>
            )}
            {rows.some((n) => n.read_at) && (
              <Button variant="outline" onClick={() => clearAll(true)} disabled={busy}>
                Clear read
              </Button>
            )}
            {rows.length > 0 && (
              <Button variant="destructive" onClick={() => clearAll(false)} disabled={busy}>
                {clear.isPending ? 'Clearing…' : 'Clear all'}
              </Button>
            )}
          </>
        }
      />
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-48" />}
      {q.data && rows.length === 0 && (
        <Card>
          <EmptyState icon={Bell} title="Nothing yet" description="Task assignments, reminders, approvals and status changes show up here." />
        </Card>
      )}
      <ul className="grid gap-2">
        {rows.map((n) => {
          const body = (
            <>
              <span className={cn('block text-sm font-medium', !n.read_at && 'font-semibold')}>{n.title}</span>
              {n.body && <span className="mt-0.5 block text-sm whitespace-pre-line text-muted-foreground">{n.body}</span>}
            </>
          );
          return (
            <li key={n.id} className={cn('flex items-start gap-3 rounded-xl border bg-card p-3 shadow-card transition hover:border-primary/40', !n.read_at && 'border-primary/30 bg-primary/4')}>
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', n.read_at ? 'bg-muted text-muted-foreground' : 'bg-primary/8 text-primary')}>
                <Bell className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                {n.href ? (
                  <SmartLink to={n.href} onClick={() => open(n)} className="block hover:underline">
                    {body}
                  </SmartLink>
                ) : (
                  <button type="button" className="block w-full cursor-pointer text-left" onClick={() => open(n)}>
                    {body}
                  </button>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {fmtWhen(n.created_at)}
                  {n.channels?.map((c) => (
                    <Chip key={c.channel} tone={CHANNEL_TONE[c.status] ?? 'neutral'} title={c.detail || c.status}>
                      {c.channel === 'gmail' ? <Mail className="size-3" /> : <MessageCircle className="size-3" />} {c.status}
                    </Chip>
                  ))}
                </div>
              </div>
              {!n.read_at && <Chip tone="primary" className="mt-0.5">New</Chip>}
              <Button size="icon-xs" variant="ghost" title="Delete this notification" aria-label={`Delete notification: ${n.title}`} onClick={() => del.mutate(n.id)}>
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
