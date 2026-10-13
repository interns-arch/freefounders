import { useAccess } from '@freefounders/core';
import { useEmployeesReport, useWorkTaskList } from '@freefounders/core/tasks';
import { AlarmClock, ClipboardList, Lightbulb, Repeat } from '@/components/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { fmtDT, fmtEffort, relDue } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { Chip, MiniStat, PriorityPill, SectionHead, Segmented, StatusPill, TaskCode, ToggleChip } from './task-bits';

const RANGES: Array<[string, string]> = [
  ['this_month', 'This Month'],
  ['this_week', 'This Week'],
  ['today', 'Today'],
  ['this_year', 'This Year'],
  ['all', 'All Time'],
];
const STATUS: Record<string, string> = { open: 'open,in_progress', done: 'done', all: '' };

/**
 * One person's whole picture: headline counts over a range, plus their task list with the same filters as the Tasks page.
 * Opened with ?user=<id> on /tasks/tasks (Reports, All Tasks, My team and Team performance link there).
 */
export function PersonProfileSheet({ userId, href, onClose }: { userId: number; href: (id: number) => string; onClose: () => void }) {
  const me = useAccess().tasks.me;
  const [range, setRange] = useState('this_month');
  const [status, setStatus] = useState('open');
  const [overdue, setOverdue] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const stats = useEmployeesReport({ range, user: userId });
  const s = stats.data?.rows?.[0] ?? null;
  const tasks = useWorkTaskList({ assigned_to: userId, status: STATUS[status], overdue, recurring });
  const rows = tasks.data?.rows ?? [];
  const name = s?.name ?? (userId === me?.id ? `${me.first_name} ${me.last_name}`.trim() || me.username : 'Profile');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Avatar name={name} className="size-12 text-sm" />
            <div className="min-w-0">
              <SheetTitle className="text-lg">{name}</SheetTitle>
              <SheetDescription>Their tasks and how they are doing</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <Segmented label="Period" value={range} onChange={setRange} options={RANGES} className="max-w-full overflow-x-auto" />
          {stats.error ? (
            <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
          ) : !s ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Total" value={s.total ?? 0} />
                <MiniStat label="Completed" value={s.completed ?? 0} tone="good" />
                <MiniStat label="Pending" value={(s.pending ?? 0) + (s.in_progress ?? 0)} />
                <MiniStat label="Overdue" value={s.overdue ?? 0} tone={s.overdue ? 'bad' : undefined} />
                <MiniStat label="In time" value={s.in_time ?? 0} />
                <MiniStat label="Delayed" value={s.delayed ?? 0} tone={s.delayed ? 'bad' : undefined} />
                <MiniStat label="Time earned" value={fmtEffort(s.time_earned_minutes) || '0m'} />
                <MiniStat label="Score" value={s.score ?? '—'} hint="Only tasks assigned by someone else are scored" />
              </div>
              {!!s.self_assigned && s.self_assigned > 0 && (
                <p className="text-sm text-muted-foreground">
                  {s.self_assigned} of these {s.self_assigned === 1 ? 'is' : 'are'} self-assigned — they show in the counts but earn no points. The score comes from the {s.scored_completed} task
                  {s.scored_completed === 1 ? '' : 's'} someone else assigned and this person finished.
                </p>
              )}
              {s.review && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> <span>{s.review}</span>
                </p>
              )}
            </>
          )}

          <section className="space-y-3" aria-label="Their tasks">
            <SectionHead title="Tasks" count={rows.length} />
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  ['open', 'Open'],
                  ['done', 'Done'],
                  ['all', 'All'],
                ]}
              />
              <ToggleChip on={overdue} tone="danger" onChange={setOverdue}>
                <AlarmClock /> Overdue only
              </ToggleChip>
              <ToggleChip on={recurring} onChange={setRecurring} title="Only the tasks that repeat — daily, weekly or monthly">
                <Repeat /> Recurring only
              </ToggleChip>
            </div>
            {tasks.isLoading ? (
              <Skeleton className="h-32" />
            ) : tasks.error ? (
              <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No tasks match this filter." description="Try another status or clear a filter." />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {rows.map((t) => {
                  const late = t.status !== 'done' && !!t.is_overdue;
                  return (
                    <li key={t.id} className={cn('border-l-[3px] border-l-transparent py-2.5 pr-3 pl-2.5 transition-colors hover:bg-muted/40', late && 'border-l-destructive')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TaskCode code={t.code} />
                        <Link to={href(t.id)} state={{ fromList: true }} className="font-semibold hover:text-primary hover:underline">
                          {t.title}
                        </Link>
                        {t.priority !== 'normal' && <PriorityPill priority={t.priority} label={t.priority_display} />}
                        <StatusPill status={t.status} label={t.status === 'in_progress' && t.progress_percent != null ? `${t.progress_percent}% · ${t.status_display}` : t.status_display} />
                        {t.category && <Chip>{t.category}</Chip>}
                        {!!t.effort_minutes && <Chip className="font-mono tabular">{fmtEffort(t.effort_minutes)}</Chip>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.created_by_detail && <>by {t.created_by_detail.name}</>}
                        {t.due_at && t.status !== 'done' && <span className={cn(late && 'font-bold text-destructive')}> · {relDue(t.due_at)}</span>}
                        {t.completed_at && <span className="text-success"> · done {fmtDT(t.completed_at)}</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
