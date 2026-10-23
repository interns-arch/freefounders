import { useAccess } from '@freefounders/core';
import { type ReportRow, useEffortDisputes, useEmployeesReport, useTaskDashboard, useTimeReport } from '@freefounders/core/tasks';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { BarChart3, Lightbulb, Scale, Timer } from '@/components/icons';
import { DownloadMenu } from '@/components/common/download-menu';
import { type ReactNode, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RangePicker, ScoreRing, fmtEffort, pct, rangeParams, rangeReady } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { chipActiveClass, chipClass, chipIdleClass } from '@/components/common/controls';
import { Segmented, StatusPill, TaskCode } from './task-bits';

function Loading() {
  return <Skeleton className="h-48" />;
}

/** Every report renders this table: same columns, same order. */
function ReportTable({
  rows,
  firstColumn,
  firstCell,
  extraHead,
  extraCell,
  empty = 'Nothing in this range.',
}: {
  rows: ReportRow[];
  firstColumn: string;
  firstCell: (r: ReportRow) => ReactNode;
  extraHead?: string;
  extraCell?: (r: ReportRow) => ReactNode;
  empty?: string;
}) {
  if (!rows.length)
    return (
      <Card>
        <EmptyState icon={BarChart3} title={empty} description="Try a wider date range." />
      </Card>
    );
  const n = (v: number | undefined) => v ?? 0;
  return (
    <Card className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>{firstColumn}</TH>
            <TH className="text-right">Total</TH>
            <TH>Score</TH>
            <TH className="text-right">Overdue</TH>
            <TH className="text-right">Pending</TH>
            <TH className="text-right">In progress</TH>
            <TH className="text-right">In time</TH>
            <TH className="text-right">Delayed</TH>
            {extraHead && <TH>{extraHead}</TH>}
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={String(r.user ?? r.month ?? r.group ?? r.category ?? r.date ?? i)}>
              <TD className="min-w-40">{firstCell(r)}</TD>
              <TD className="text-right font-mono font-semibold tabular">{n(r.total)}</TD>
              <TD>
                <ScoreRing value={r.score} />
              </TD>
              <TD className={cn('text-right font-mono tabular', n(r.overdue) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                {n(r.overdue)} <span className="font-sans text-xs font-normal text-muted-foreground">({pct(n(r.overdue), r.total)})</span>
              </TD>
              <TD className="text-right font-mono tabular">
                {n(r.pending)} <span className="font-sans text-xs text-muted-foreground">({pct(n(r.pending), r.total)})</span>
              </TD>
              <TD className="text-right font-mono tabular">
                {n(r.in_progress)} <span className="font-sans text-xs text-muted-foreground">({pct(n(r.in_progress), r.total)})</span>
              </TD>
              <TD className={cn('text-right font-mono tabular', n(r.in_time) > 0 ? 'font-semibold text-success' : 'text-muted-foreground')}>
                {n(r.in_time)} <span className="font-sans text-xs font-normal text-muted-foreground">({pct(n(r.in_time), r.completed)})</span>
              </TD>
              <TD className={cn('text-right font-mono tabular', n(r.delayed) > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                {n(r.delayed)} <span className="font-sans text-xs font-normal text-muted-foreground">({pct(n(r.delayed), r.completed)})</span>
              </TD>
              {extraCell?.(r)}
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

const REPORT_TABS: Array<[string, string]> = [
  ['person', 'Employees'],
  ['category', 'Categories'],
  ['mine', 'My Report'],
  ['delegated', 'Delegated'],
  ['daily', 'Daily'],
  ['monthly', 'Monthly'],
  ['overdue', 'OverDue'],
  ['group', 'Groups'],
];

/** Every report in one place (Employees, Categories, My Report, Delegated, Daily, Monthly, OverDue, Groups). */
export function ReportsTab({ onProfile }: { onProfile: (id: number, name: string) => void }) {
  const me = useAccess().tasks.me;
  const [tab, setTab] = useState('person');
  const [range, setRange] = useState('this_month');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const ready = rangeReady(range, custom);
  const base = rangeParams(range, custom);
  const fromDashboard = tab === 'category' || tab === 'delegated';
  const report = useEmployeesReport(
    { ...base, ...(['daily', 'monthly', 'overdue', 'group'].includes(tab) ? { grain: tab } : {}), ...(tab === 'mine' && me ? { user: me.id } : {}) },
    ready && !fromDashboard && (tab !== 'mine' || !!me),
  );
  const dash = useTaskDashboard({ ...base, ...(tab === 'delegated' ? { scope: 'delegated' } : {}) }, ready && fromDashboard);
  const q = fromDashboard ? dash : report;
  const rows: ReportRow[] = fromDashboard ? ((dash.data?.categories ?? []) as ReportRow[]) : (report.data?.rows ?? []);
  const loaded = fromDashboard ? !!dash.data : !!report.data;

  // The report already holds every row, so the file is made here (Excel + CSV, PLAN.md §19.31).
  const tabLabel = REPORT_TABS.find(([v]) => v === tab)?.[1] ?? tab;
  const sheet = () => ({
    title: `Report ${tabLabel}`,
    header: ['Name', 'Total', 'Score', 'Overdue', 'Pending', 'In progress', 'Completed', 'In time', 'Delayed'],
    rows: rows.map((r) => [r.name || r.label || r.group || r.category || r.date, r.total, r.score ?? null, r.overdue, r.pending, r.in_progress, r.completed, r.in_time, r.delayed]),
  });

  const firstCell = (r: ReportRow): ReactNode => {
    if (tab === 'monthly') return <strong>{r.label}</strong>;
    if (tab === 'group') return <strong>{r.group}</strong>;
    if (tab === 'category' || tab === 'delegated') return <strong>{r.category}</strong>;
    return (
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="cursor-pointer font-semibold hover:text-primary hover:underline" title="Open this person's full profile" onClick={() => r.user && onProfile(r.user, r.name ?? '')}>
            {r.name}
          </button>
          {!!r.self_assigned && r.self_assigned > 0 && (
            <Badge tone="neutral" title="Created for themselves — not scored">
              {r.self_assigned} self-assigned
            </Badge>
          )}
        </div>
        {r.review && (
          <p className="flex items-start gap-1 text-xs text-muted-foreground">
            <Lightbulb className="mt-0.5 size-3 shrink-0" aria-hidden /> {r.review}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <nav aria-label="Reports" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {REPORT_TABS.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-current={tab === v ? 'page' : undefined}
            onClick={() => setTab(v)}
            className={cn(
              chipClass,
              'font-semibold',
              tab === v ? chipActiveClass : chipIdleClass,
            )}
          >
            {l}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
        <span className="flex-1" />
        <DownloadMenu
          rows={sheet}
          filename={fileSlug('tasks', 'report', tabLabel, range === 'custom' ? `${custom.start}-to-${custom.end}` : range, todayStamp())}
          empty={loaded && rows.length === 0}
          loading={ready && !loaded}
        />
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !ready ? (
        <Card>
          <EmptyState title="Pick both dates" />
        </Card>
      ) : !loaded ? (
        <Loading />
      ) : tab === 'daily' ? (
        <ReportTable
          rows={rows.map((r) => ({ ...r, total: r.completed }))}
          firstColumn="Date"
          empty="Nothing completed in this range."
          firstCell={(r) => <strong>{r.date ? new Date(`${r.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</strong>}
        />
      ) : tab === 'overdue' ? (
        <ReportTable
          rows={rows}
          firstColumn="Employee"
          empty="Nobody is overdue right now."
          firstCell={firstCell}
          extraHead="Overdue since"
          extraCell={(r) => (
            <TD className="text-destructive">
              {r.days_overdue === 0 ? 'today' : (r.days_overdue ?? 0) < 30 ? `${r.days_overdue} days ago` : `${Math.round((r.days_overdue ?? 0) / 30)} month(s) ago`}
            </TD>
          )}
        />
      ) : (
        <ReportTable
          rows={rows}
          firstCell={firstCell}
          firstColumn={({ monthly: 'Month', group: 'Group', category: 'Category', delegated: 'Category' } as Record<string, string>)[tab] ?? 'Employee'}
          empty={tab === 'mine' ? 'You have no tasks in this range.' : undefined}
        />
      )}
      {report.data?.formula && ['person', 'mine'].includes(tab) && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Formula (open, not a black box): <strong className="font-semibold text-foreground">{report.data.formula}</strong>.
          </span>
        </p>
      )}
    </div>
  );
}

const TIME_RANGES: Array<[string, string]> = [
  ['today', 'Today'],
  ['this_week', 'This Week'],
  ['this_month', 'This Month'],
  ['this_year', 'This Year'],
  ['all', 'All Time'],
];

/** Time earned (the assigner's task time, credited on completion) vs time spent (what the person reported). */
export function TimeTab() {
  const [range, setRange] = useState('this_month');
  const q = useTimeReport(range);
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Period" value={range} onChange={setRange} options={TIME_RANGES} className="max-w-full overflow-x-auto" />
        <span className="flex-1" />
        <DownloadMenu
          rows={() => ({
            title: 'Time report',
            header: ['Person', 'Done', 'Time earned (min)', 'Time spent (min)', 'Difference (min)', 'Tasks without effort'],
            rows: (q.data?.rows ?? []).map((r) => [r.name, r.done, r.time_earned_minutes, r.time_spent_minutes, r.time_spent_minutes - r.time_earned_minutes, r.no_effort_tasks]),
          })}
          filename={fileSlug('tasks', 'time-report', range, todayStamp())}
          empty={!!q.data && q.data.rows.length === 0}
          loading={!q.data}
        />
      </div>
      <p className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
        <Timer className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          <strong className="text-foreground">Time Earned</strong> = the assigner&rsquo;s task time, credited when the task completes. <strong className="text-foreground">Time Spent</strong> = the actual effort
          the person reported. A big gap either way is a conversation, not a verdict.
        </span>
      </p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : q.data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={Timer} title="No completed tasks in this period." description="Time is earned when a task is completed." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Done</TH>
                <TH className="text-right">Time earned</TH>
                <TH className="text-right">Time spent</TH>
                <TH className="text-right">Difference</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.rows.map((r) => {
                const diff = r.time_spent_minutes - r.time_earned_minutes;
                return (
                  <TR key={r.user}>
                    <TD>
                      <strong>{r.name}</strong>
                      {r.no_effort_tasks > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {r.no_effort_tasks} task{r.no_effort_tasks === 1 ? '' : 's'} had no effort value — earned 0
                        </p>
                      )}
                    </TD>
                    <TD className="text-right font-mono tabular">{r.done}</TD>
                    <TD className="text-right font-mono font-semibold text-success tabular">{fmtEffort(r.time_earned_minutes) || '0m'}</TD>
                    <TD className="text-right font-mono tabular">{fmtEffort(r.time_spent_minutes) || '0m'}</TD>
                    <TD className={cn('text-right font-mono tabular', diff > 0 ? 'font-semibold text-destructive' : diff < 0 ? 'text-success' : 'text-muted-foreground')}>
                      {diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${fmtEffort(Math.abs(diff))} ${diff > 0 ? 'over' : 'under'}`}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Where the assigner and the assignee disagreed on how long a task takes; the Actual column settles it. */
export function DisputesTab() {
  const [range, setRange] = useState('this_month');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const ready = rangeReady(range, custom);
  const q = useEffortDisputes(rangeParams(range, custom), ready);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
        <span className="flex-1" />
        <DownloadMenu
          rows={() => ({
            title: 'Effort disputes',
            header: ['Code', 'Task', 'Assignee', 'Assigned by', 'Assigner said (min)', 'Assignee said (min)', 'Actually took (min)', 'Status'],
            rows: (q.data?.rows ?? []).map((r) => [r.code, r.title, r.assignee, r.assigner, r.effort_minutes, r.estimate_minutes, r.actual_minutes, r.status]),
          })}
          filename={fileSlug('tasks', 'disputes', range === 'custom' ? `${custom.start}-to-${custom.end}` : range, todayStamp())}
          empty={!!q.data && q.data.rows.length === 0}
          loading={ready && !q.data}
        />
      </div>
      <p className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
        <Scale className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>Where the assigner and the assignee disagreed on how long a task takes — &ldquo;Amit said 1 hour, Bhavna said 4&rdquo;. Sorted by the size of the disagreement; the Actual column settles the argument.</span>
      </p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : q.data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={Scale} title="No disputes in this range — everyone agrees." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Task</TH>
                <TH>Assignee</TH>
                <TH className="text-right">Assigner said</TH>
                <TH className="text-right">Assignee said</TH>
                <TH className="text-right">Actually took</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TaskCode code={r.code} /> <strong>{r.title}</strong>
                    </div>
                    <p className="text-xs text-muted-foreground">assigned by {r.assigner}</p>
                  </TD>
                  <TD>{r.assignee}</TD>
                  <TD className="text-right font-mono tabular">{fmtEffort(r.effort_minutes)}</TD>
                  <TD className={cn('text-right font-mono font-semibold tabular', r.estimate_minutes > r.effort_minutes ? 'text-destructive' : 'text-success')}>{fmtEffort(r.estimate_minutes)}</TD>
                  <TD className="text-right font-mono font-bold tabular">{r.actual_minutes ? fmtEffort(r.actual_minutes) : '—'}</TD>
                  <TD>
                    <StatusPill status={r.status as 'open' | 'in_progress' | 'done'} label={r.status.replace('_', ' ')} className="capitalize" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
