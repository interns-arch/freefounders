import type { Priority } from '@eam/shared';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, LifeBuoy, ListOrdered, UserPlus } from '@/components/icons';
import { Link, useNavigate } from 'react-router';
import { EnumBadge } from '@/components/common/badges';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { useQueue } from '@freefounders/core/assets';
import { PRIORITY_TONE } from '@/lib/status';
import type { QueueItem } from '@freefounders/core/assets';
import { useUrlFilters } from '@/lib/url-state';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { Segmented } from '@/components/common/controls';

const ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const BAR: Record<Priority, string> = { URGENT: 'bg-destructive', HIGH: 'bg-warning', MEDIUM: 'bg-info', LOW: 'bg-border' };
const TILE: Record<Priority, string> = {
  URGENT: 'border-destructive/25 bg-destructive/8 text-destructive dark:bg-destructive/12',
  HIGH: 'border-warning/25 bg-warning/8 text-warning dark:bg-warning/12',
  MEDIUM: 'border-info/25 bg-info/8 text-info dark:bg-info/12',
  LOW: 'border-border bg-card text-foreground',
};
const KIND_BUBBLE: Record<string, string> = {
  TICKET: 'bg-destructive/10 text-destructive dark:bg-destructive/16',
  REQUEST: 'bg-info/10 text-info dark:bg-info/16',
  ONBOARDING: 'bg-app-attendance/10 text-app-attendance dark:bg-app-attendance/16',
};
const STATUS_TEXT: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING: 'Needs approval', APPROVED: 'Ready to fulfil' };
const JOINER_TEXT: Record<string, string> = { SUBMITTED: 'Approve items', APPROVED: 'Assign items' };
const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'TICKET', label: 'Tickets' },
  { value: 'REQUEST', label: 'Requests' },
  { value: 'ONBOARDING', label: 'New joiners' },
];


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
              className={cn('relative cursor-pointer overflow-hidden rounded-xl border p-3 pl-4 text-left transition', TILE[p], active ? 'ring-2 ring-current/40' : 'hover:shadow-sm', f.priority && !active && 'opacity-60')}
              aria-pressed={active}
            >
              <span className={cn('absolute inset-y-0 left-0 w-1', BAR[p])} aria-hidden />
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider uppercase">
                {LABEL[p]}
              </div>
              <div className="mt-1 font-mono text-[26px] leading-none font-semibold tabular">{counts ? counts[p] : '–'}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Show" value={f.kind ?? ''} onChange={(v) => set({ kind: v })} options={KINDS.map((k) => [k.value, k.label] as [string, string])} />
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
            <GroupedList items={q.data.items} reset={[f.priority ?? '', f.kind ?? '']} />
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * The queue comes most urgent first, so the first 50 drawn are the most urgent ones (weak phones); "Load more" adds the
 * next. Each group's count is all of its items.
 */
function GroupedList({ items, reset }: { items: QueueItem[]; reset: unknown }) {
  const more = useShowMore(items, { reset });
  return (
    <div>
      {ORDER.map((p) => {
        const group = more.visible.filter((i) => i.priority === p);
        if (!group.length) return null;
        const all = items.filter((i) => i.priority === p).length;
        return (
          <section key={p}>
            <h2 className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-muted px-4 py-1.5 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {LABEL[p]} <span className="rounded bg-card px-1.5 py-px tabular">{all}</span>
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
      <ShowMore {...more.footer} noun="items" className="border-t" />
    </div>
  );
}

function QueueRow({ item, compact }: { item: QueueItem; compact?: boolean }) {
  const navigate = useNavigate();
  const Icon = item.kind === 'TICKET' ? LifeBuoy : item.kind === 'ONBOARDING' ? UserPlus : ClipboardList;
  return (
    <button type="button" onClick={() => navigate(item.link)} className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50">
      <span className={cn('w-1 self-stretch rounded-full', BAR[item.priority])} />
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg transition group-hover:scale-105', KIND_BUBBLE[item.kind] ?? 'bg-muted text-muted-foreground')}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium group-hover:text-primary">{item.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{item.number}</span> · {(item.kind === 'ONBOARDING' ? JOINER_TEXT : STATUS_TEXT)[item.status] ?? item.status}
          {item.detail ? ` · ${item.detail}` : ''}
          {!compact && item.assigneeName ? ` · ${item.assigneeName}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <EnumBadge value={item.priority} tones={PRIORITY_TONE} />
        <span className={cn('whitespace-nowrap text-xs', item.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
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
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/8 text-primary">
              <ListOrdered className="size-3.5" />
            </span>
            Priority queue
          </CardTitle>
          <CardDescription>
            {c ? `${c.URGENT} urgent · ${c.HIGH} high · ${q.data!.total} waiting in total` : 'Loading…'}
            {q.data?.overdue ? ` · ${q.data.overdue} overdue` : ''}
          </CardDescription>
        </div>
        <Button size="xs" variant="ghost" asChild>
          <Link to="/assets/queue">
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
          <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/8 px-4 py-3 text-sm">
            <span className="flex size-8 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-4" />
            </span>
            <span className="text-success">All clear — nothing waiting.</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
