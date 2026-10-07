import type { Priority } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, LifeBuoy, ListOrdered, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { EnumBadge } from '@/components/common/badges';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { PRIORITY_TONE } from '@/lib/status';
import type { Queue, QueueItem } from '@/lib/types';
import { useUrlFilters } from '@/lib/url-state';
import { cn, formatDate, relativeTime } from '@/lib/utils';

const ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const BAR: Record<Priority, string> = { URGENT: 'bg-red-500', HIGH: 'bg-orange-500', MEDIUM: 'bg-blue-500', LOW: 'bg-zinc-300 dark:bg-zinc-600' };
const TILE: Record<Priority, string> = {
  URGENT: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
  MEDIUM: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  LOW: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300',
};
const STATUS_TEXT: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING: 'Needs approval', APPROVED: 'Ready to fulfil' };
const JOINER_TEXT: Record<string, string> = { SUBMITTED: 'Approve items', APPROVED: 'Assign items' };
const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'TICKET', label: 'Tickets' },
  { value: 'REQUEST', label: 'Requests' },
  { value: 'ONBOARDING', label: 'New joiners' },
];

const useQueue = (params: Record<string, string> = {}) =>
  useQuery({ queryKey: ['queue', params], queryFn: () => api.get<Queue>('/queue', params), refetchInterval: 30_000 });

export default function QueuePage() {
  const { values: f, set } = useUrlFilters({ priority: '', kind: '' });
  const q = useQueue({ priority: f.priority ?? '', kind: f.kind ?? '' });
  const counts = q.data?.counts;

  return (
    <div className="space-y-4">
      <PageHeader title="Priority queue" description="Everything waiting on the IT team — most urgent first, then overdue, then oldest. Refreshes every 30 seconds." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ORDER.map((p) => {
          const active = f.priority === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => set({ priority: active ? '' : p })}
              className={cn('cursor-pointer rounded-xl border p-3 text-left transition', TILE[p], active ? 'ring-2 ring-current/40' : 'hover:shadow-sm', f.priority && !active && 'opacity-60')}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <span className={cn('size-2 rounded-full', BAR[p])} />
                {LABEL[p]}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular">{counts ? counts[p] : '–'}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => set({ kind: k.value })}
              className={cn(
                'cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                (f.kind ?? '') === k.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        {!!q.data?.overdue && (
          <Badge tone="red" className="ml-auto">
            <AlertTriangle /> {q.data.overdue} overdue
          </Badge>
        )}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !q.data?.items.length ? (
            <EmptyState icon={CheckCircle2} title={q.data?.total ? 'Nothing matches this filter' : 'All clear'} description={q.data?.total ? undefined : 'No open tickets or requests are waiting.'} />
          ) : (
            <GroupedList items={q.data.items} />
          )}
        </Card>
      )}
    </div>
  );
}

function GroupedList({ items }: { items: QueueItem[] }) {
  return (
    <div>
      {ORDER.map((p) => {
        const group = items.filter((i) => i.priority === p);
        if (!group.length) return null;
        return (
          <section key={p}>
            <h2 className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-muted/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              <span className={cn('size-2 rounded-full', BAR[p])} />
              {LABEL[p]} · {group.length}
            </h2>
            <ul className="divide-y">
              {group.map((i) => (
                <li key={i.kind + i.id}>
                  <QueueRow item={i} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function QueueRow({ item, compact }: { item: QueueItem; compact?: boolean }) {
  const navigate = useNavigate();
  const Icon = item.kind === 'TICKET' ? LifeBuoy : item.kind === 'ONBOARDING' ? UserPlus : ClipboardList;
  return (
    <button type="button" onClick={() => navigate(item.link)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50">
      <span className={cn('w-1 self-stretch rounded-full', BAR[item.priority])} />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{item.number}</span> · {(item.kind === 'ONBOARDING' ? JOINER_TEXT : STATUS_TEXT)[item.status] ?? item.status}
          {item.detail ? ` · ${item.detail}` : ''}
          {!compact && item.assigneeName ? ` · ${item.assigneeName}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <EnumBadge value={item.priority} tones={PRIORITY_TONE} dot={false} />
        <span className={cn('whitespace-nowrap text-[11px]', item.overdue ? 'font-semibold text-red-600' : 'text-muted-foreground')}>
          {item.overdue ? `Overdue · ${item.kind === 'ONBOARDING' ? 'joined' : 'needed'} ${formatDate(item.dueDate)}` : item.dueDate ? `${item.kind === 'ONBOARDING' ? 'Joins' : 'Needed'} ${formatDate(item.dueDate)}` : relativeTime(item.createdAt)}
        </span>
      </div>
    </button>
  );
}

/** Dashboard preview: the top of the queue. */
export function QueueCard() {
  const q = useQueue();
  const top = q.data?.items.slice(0, 5) ?? [];
  const c = q.data?.counts;
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListOrdered className="size-4 text-primary" /> Priority queue
          </CardTitle>
          <CardDescription>
            {c ? `${c.URGENT} urgent · ${c.HIGH} high · ${q.data!.total} waiting in total` : 'Loading…'}
            {q.data?.overdue ? ` · ${q.data.overdue} overdue` : ''}
          </CardDescription>
        </div>
        <Button size="xs" variant="ghost" asChild>
          <Link to="/queue">
            Open queue <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      {q.isLoading ? (
        <CardContent>
          <Skeleton className="h-24" />
        </CardContent>
      ) : top.length ? (
        <ul className="divide-y border-t">
          {top.map((i) => (
            <li key={i.kind + i.id}>
              <QueueRow item={i} compact />
            </li>
          ))}
        </ul>
      ) : (
        <CardContent>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" /> All clear — nothing waiting.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
