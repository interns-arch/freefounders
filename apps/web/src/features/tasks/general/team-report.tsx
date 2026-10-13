/**
 * /tasks/team — Team Performance (old pages/TeamReport.jsx). Every employee over a date range, ranked by the same
 * score the Employees report uses, with attendance % and leave days next to it (PLAN.md §17.5).
 */
import { errorMessage } from '@freefounders/core';
import { type TeamReportRow, useSendOverdueEmail, useTeamReport } from '@freefounders/core/tasks';
import { ChevronDown, ChevronRight, Download, Mail, TriangleAlert } from '@/components/icons';
import { Fragment, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { downloadCSV } from '../shared/csv';
import { fmtEffort } from '../shared/format';
import { type CustomRange, RangePicker } from '../shared/range-picker';
import { ScoreRing } from '../shared/score-ring';
import { axisOptions, barValueLabels, themeColour } from './charts';
import { DelegationCard } from './delegation';
import { Chip, Delta, ErrorNote, Panel, Tile } from './parts';

const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** One employee's full numbers, shown in place when their row is opened. */
function PersonDetail({ r }: { r: TeamReportRow }) {
  const block = (title: string, items: Array<[string, React.ReactNode, string?]>) => (
    <div className="min-w-48 flex-1">
      <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</div>
      {items.map(([k, v, hint]) => (
        <div key={k} className="flex justify-between gap-3 py-0.5 text-sm" title={hint}>
          <span className="text-muted-foreground">{k}</span>
          <strong className="tabular-nums">{v}</strong>
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex flex-wrap gap-5 rounded-lg bg-muted/40 px-4 py-3">
      {block('Tasks', [
        ['Total in range', r.total],
        ['Completed', r.completed],
        ['— on time', r.in_time],
        ['— delayed', r.delayed],
        ['Pending', r.pending],
        ['In progress', r.in_progress],
        ['Overdue', r.overdue],
      ])}
      {block('Time', [
        ['Assigned', fmtEffort(r.time_assigned_minutes) || '—'],
        ['Earned (completed)', fmtEffort(r.time_earned_minutes) || '—'],
        ['Actually spent', fmtEffort(r.time_spent_minutes) || '—'],
        ['Effort ratio', pctText(r.effort_ratio), 'Time earned ÷ time assigned'],
      ])}
      {block('Quality', [
        ['On-time rate', pctText(r.on_time_rate)],
        ['Attendance', pctText(r.attendance_rate), r.working_days ? `Present, late or half day, of ${r.working_days} working days` : 'Pick a date range'],
        ['Leave days', r.leave_days ?? '—'],
        ['Sent back for redo', r.rework_rejected, 'Completions an approver rejected'],
        ['Rework rate', pctText(r.rework_rate)],
        ['Mistakes logged', r.mistakes],
        ['Repeat mistakes', r.repeat_mistakes],
        ['Score penalty', r.mistake_penalty ? `−${r.mistake_penalty}` : '0'],
      ])}
      {block('Pressure & load', [
        ['Deadline extensions asked', r.extension_requests],
        ['Cancellations asked', r.cancel_requests],
        ['Open right now', r.open_tasks],
        ['— already overdue', r.open_overdue],
        ['Pending effort', fmtEffort(r.pending_effort_minutes) || '—'],
        ['Self-assigned (unscored)', r.self_assigned],
      ])}
      <div className="basis-full space-y-1">
        {r.review && <p className="text-sm">💡 {r.review}</p>}
        {r.flags?.map((f) => (
          <p key={f} className="flex items-center gap-1 text-sm text-destructive">
            <TriangleAlert className="size-3.5" /> {f}
          </p>
        ))}
        <Button asChild size="sm" variant="outline" className="mt-1">
          <Link to={`/tasks/tasks?tab=employees&user=${r.user}`}>Open full profile →</Link>
        </Button>
      </div>
    </div>
  );
}

export function TeamReportPage() {
  const [range, setRange] = useState('this_month');
  const [custom, setCustom] = useState<CustomRange>({ start: '', end: '' });
  const [open, setOpen] = useState<number | null>(null);
  const q = useTeamReport(range, custom);
  const mail = useSendOverdueEmail();
  const confirm = useConfirm();
  const data = q.data;
  const rows = data?.rows ?? [];
  const t = data?.team;
  const ranked = rows.filter((r) => r.score !== null);

  const sendOverdueEmail = async () => {
    const ok = await confirm({ title: 'Email the weekly update now?', description: 'Everyone gets their overdue tasks (or "pipeline is clear") and their performance now.', confirmText: 'Send emails' });
    if (!ok.confirmed) return;
    mail.mutate(undefined, {
      onSuccess: (res) => toast.success(`Weekly email sent to ${res.sent} person(s).`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const exportCSV = () =>
    downloadCSV(
      `team-performance-${range}.csv`,
      ['Rank', 'Name', 'Role', 'Department', 'Score', 'Change', 'On-time %', 'Attendance %', 'Leave days', 'Total', 'Completed', 'On time', 'Delayed', 'Pending', 'In progress', 'Overdue', 'Time assigned', 'Time earned', 'Time spent', 'Sent back', 'Extensions asked', 'Mistakes', 'Open now', 'Overdue now'],
      rows.map((r, i) => [
        r.score === null ? '' : i + 1,
        r.name,
        r.role,
        r.department,
        r.score ?? '',
        r.score_delta ?? '',
        r.on_time_rate ?? '',
        r.attendance_rate ?? '',
        r.leave_days ?? '',
        r.total,
        r.completed,
        r.in_time,
        r.delayed,
        r.pending,
        r.in_progress,
        r.overdue,
        r.time_assigned_minutes,
        r.time_earned_minutes,
        r.time_spent_minutes,
        r.rework_rejected,
        r.extension_requests,
        r.mistakes,
        r.open_tasks,
        r.open_overdue,
      ]),
    );

  const colours = { good: themeColour('success'), mid: themeColour('warning'), bad: themeColour('destructive') };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team Performance"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={sendOverdueEmail} loading={mail.isPending} title="Also goes out automatically every Monday at 10 AM">
              <Mail /> {mail.isPending ? 'Sending…' : 'Email weekly update'}
            </Button>
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportCSV}>
                <Download /> Export CSV
              </Button>
            )}
          </>
        }
        className="mb-0"
      />
      <RangePicker range={range} setRange={setRange} custom={custom} setCustom={setCustom} countedBy="due date" applied={data ? { from: data.range.start, to: data.range.end } : null} />

      {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
      {!data && !q.error && <Skeleton className="h-64" />}

      {t && data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Team score" value={t.team_score ?? '—'} sub={<Delta value={t.team_score_delta} />} tone={t.team_score === null ? 'neutral' : t.team_score >= 75 ? 'success' : 'warning'} alert={t.team_score !== null && t.team_score < 45} />
            <Tile label="On time" value={t.on_time_rate === null ? '—' : `${t.on_time_rate}%`} sub={`${t.in_time} of ${t.completed} completed`} />
            <Tile label="Completed" value={t.completed} sub={`${t.total} tasks in range`} />
            <Tile label="Overdue" value={t.overdue} alert={t.overdue > 0} sub={`${t.open_overdue} late right now`} />
            <Tile label="Time earned" value={fmtEffort(t.time_earned_minutes) || '—'} sub={`${fmtEffort(t.time_spent_minutes) || '0m'} spent`} />
            <Tile label="Need a look" value={t.at_risk} alert={t.at_risk > 0} sub={`${t.scored_people} of ${t.people} scored`} />
          </div>

          {ranked.length > 1 && (
            <Panel title="Score by person">
              <div className="h-64" role="img" aria-label={`Score by person: ${ranked.map((r) => `${r.name} ${r.score ?? 'no score'}`).join(', ')}`}>
                <Bar
                  plugins={[barValueLabels]}
                  data={{
                    labels: ranked.map((r) => r.name),
                    datasets: [
                      {
                        label: 'Score',
                        data: ranked.map((r) => r.score),
                        backgroundColor: ranked.map((r) => ((r.score ?? 0) >= 75 ? colours.good : (r.score ?? 0) >= 45 ? colours.mid : colours.bad)),
                        borderRadius: 4,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          afterLabel: (c) => {
                            const r = ranked[c.dataIndex];
                            return `${r.completed} done · ${r.overdue} overdue · ${r.on_time_rate ?? '—'}% on time`;
                          },
                        },
                      },
                    },
                    layout: { padding: { top: 18 } },
                    scales: { ...axisOptions(), y: { ...axisOptions().y, max: 100 } },
                  }}
                />
              </div>
              {/* The bar colour is also said in words: never colour alone. */}
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm bg-success" /> 75 and up: on track
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm bg-warning" /> 45–74: watch
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm bg-destructive" /> Under 45: needs a look
                </span>
              </p>
            </Panel>
          )}

          <Panel
            title={
              <>
                Every employee <span className="text-xs font-normal text-muted-foreground">{rows.length} people · open a row for the full breakdown</span>
              </>
            }
            bodyClassName="px-0 sm:px-0"
          >
            <Table>
              <THead>
                <TR>
                  <TH className="w-8">#</TH>
                  <TH>Employee</TH>
                  <TH>Score</TH>
                  <TH>vs prev</TH>
                  <TH className="text-right">On time</TH>
                  <TH className="text-right">Attendance</TH>
                  <TH className="text-right">Leave days</TH>
                  <TH className="text-right">Done</TH>
                  <TH className="text-right">Pending</TH>
                  <TH className="text-right">Overdue</TH>
                  <TH className="text-right">Time spent</TH>
                  <TH className="text-right">Open now</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <Fragment key={r.user}>
                    <TR className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === r.user ? null : r.user)}>
                      <TD className="text-muted-foreground">{r.score === null ? '—' : i + 1}</TD>
                      <TD>
                        <button type="button" aria-expanded={open === r.user} className="flex min-h-8 cursor-pointer items-center gap-1 rounded text-left font-medium" title="Show this person's full breakdown">
                          {open === r.user ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                          {r.name}
                        </button>
                        <div className="flex items-center gap-1 pl-5 text-xs text-muted-foreground">
                          {r.role}
                          {r.department ? ` · ${r.department}` : ''}
                          {r.flags?.length > 0 && (
                            <Chip tone="danger" title={r.flags.join(' · ')}>
                              <TriangleAlert className="size-3" /> {r.flags.length}
                            </Chip>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <ScoreRing value={r.score} />
                      </TD>
                      <TD>
                        <Delta value={r.score_delta} />
                      </TD>
                      <TD className="text-right tabular">{pctText(r.on_time_rate)}</TD>
                      <TD className="text-right tabular">{pctText(r.attendance_rate)}</TD>
                      <TD className="text-right tabular">{r.leave_days ?? '—'}</TD>
                      <TD className="text-right tabular">{r.completed}</TD>
                      <TD className="text-right tabular">{r.pending + r.in_progress}</TD>
                      <TD className={cn('text-right tabular', r.overdue > 0 && 'font-semibold text-destructive')}>{r.overdue}</TD>
                      <TD className="text-right tabular">{fmtEffort(r.time_spent_minutes) || '—'}</TD>
                      <TD className="text-right tabular">
                        {r.open_tasks}
                        {r.open_overdue ? ` (${r.open_overdue} late)` : ''}
                      </TD>
                    </TR>
                    {open === r.user && (
                      <TR>
                        <TD colSpan={12} className="pt-0">
                          <PersonDetail r={r} />
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </Panel>

          {data.formula && (
            <p className="text-xs text-muted-foreground">
              Formula (open, not a black box): <strong>{data.formula}</strong>.
              {data.previous?.start ? ` Change is measured against ${data.previous.start} – ${data.previous.end}.` : ' No earlier period to compare against in this range.'}
            </p>
          )}
        </>
      )}

      {/* tasks given / received per person — shows only for admins */}
      <DelegationCard />
    </div>
  );
}
