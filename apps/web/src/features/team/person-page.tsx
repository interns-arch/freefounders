/**
 * /team/:id — one person's whole picture (PLAN.md §25): header, then Overview (period KPIs + weekly trend), Attendance
 * (month calendar, punches, regularizations, leave), Tasks (open / overdue / completed, chains, Excel report), Assets
 * and Visitors. Tabs for areas the plan lacks, or modules switched off, are hidden; the Tasks API checks every one.
 */
import { useAccess } from '@kaampilot/core';
import { useEmployee, useEmployees, useTickets } from '@kaampilot/core/assets';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import type { AttendanceDay } from '@kaampilot/core/hr';
import { tasksExports } from '@kaampilot/core/tasks';
import {
  TEAM360_RANGES,
  type Team360PeriodInput,
  type Team360Range,
  type Team360Summary,
  type Team360Task,
  useTeam360Attendance,
  useTeam360Person,
  useTeam360Tasks,
  useTeam360Visitors,
} from '@kaampilot/core/team';
import {
  AlarmClock,
  ArrowLeft,
  BarChart3,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ListChecks,
  Mail,
  MapPin,
  Network,
  Package,
  Palmtree,
  Phone,
  Target,
  Timer,
  Trophy,
  UserCheck,
  UsersRound,
} from '@/components/icons';
import { type ReactNode, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Link, useParams, useSearchParams } from 'react-router';
import { Segmented, TabBar, type TabItem } from '@/components/common/controls';
import { DownloadButton } from '@/components/common/download-menu';
import { BACK_LINK, ErrorState } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Calendar } from '../hr/attendance';
import { AttendanceChip, PunchPhoto, hrs } from '../hr/parts';
import { RegularizedTag } from '../hr/regularize';
import { axisOptions, barValueLabels, themeColour } from '../tasks/general/charts';
import { Chip, Empty, Panel, Tile } from '../tasks/general/parts';
import { RATE_TEXT, day, dayTime, pct, rateTone, time } from './parts';

type Tab = 'overview' | 'attendance' | 'tasks' | 'assets' | 'visitors';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function PersonPage() {
  const { id: raw } = useParams();
  const id = Number(raw);
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<Team360PeriodInput>({
    range: 'this_month',
  });
  const [draft, setDraft] = useState({ start: '', end: '' });
  const q = useTeam360Person(Number.isFinite(id) ? id : null, period);
  const data = q.data;
  const areas = data?.areas;
  const showAssets = access.assets.on && access.assets.can('employee:view');

  const tabs: TabItem<Tab>[] = [
    { value: 'overview', label: 'Overview' },
    ...(areas?.attendance ? [{ value: 'attendance' as Tab, label: 'Attendance' }] : []),
    ...(areas?.tasks ? [{ value: 'tasks' as Tab, label: 'Tasks' }] : []),
    ...(showAssets ? [{ value: 'assets' as Tab, label: 'Assets' }] : []),
    ...(areas?.visitors ? [{ value: 'visitors' as Tab, label: 'Visitors' }] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : 'overview';
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };
  const pickRange = (r: Team360Range) => {
    if (r === 'custom') {
      const start = draft.start || data?.period.start || '';
      const end = draft.end || data?.period.end || '';
      setDraft({ start, end });
      setPeriod({ range: 'custom', start, end });
    } else setPeriod({ range: r });
  };

  if (q.error && !data) {
    return (
      <div className="space-y-4">
        <Link to="/team" className={BACK_LINK}>
          <ArrowLeft className="size-4" /> Team
        </Link>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to="/team" className={BACK_LINK}>
        <ArrowLeft className="size-4" /> Team
      </Link>
      {!data ? <Skeleton className="h-36 rounded-xl" /> : <Header data={data} />}

      <TabBar items={tabs} value={tab} onChange={setTab} label="Sections" />

      {tab !== 'attendance' && tab !== 'assets' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented label="Period" value={period.range} onChange={pickRange} options={TEAM360_RANGES} />
          {period.range === 'custom' && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="p-start" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input id="p-start" type="date" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} className="w-40" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="p-end" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input id="p-end" type="date" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} className="w-40" />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!draft.start || !draft.end || draft.start > draft.end}
                onClick={() => setPeriod({ range: 'custom', ...draft })}
              >
                Show
              </Button>
            </div>
          )}
          {data && (
            <span className="text-sm text-muted-foreground sm:ml-auto">
              {day(data.period.start)} – {day(data.period.end)}
            </span>
          )}
        </div>
      )}

      {!data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : tab === 'overview' ? (
        <Overview data={data} />
      ) : tab === 'attendance' ? (
        <AttendanceTab id={id} name={data.person.name} />
      ) : tab === 'tasks' ? (
        <TasksTab id={id} name={data.person.name} period={period} summary={data} />
      ) : tab === 'assets' ? (
        <AssetsTab code={data.person.employee_code} name={data.person.name} />
      ) : (
        <VisitorsTab id={id} period={period} />
      )}
    </div>
  );
}

// ─── header ──────────────────────────────────────────────────────────────

function Header({ data }: { data: Team360Summary }) {
  const p = data.person;
  const facts: Array<[string, ReactNode]> = [
    ['Employee ID', p.employee_code || '—'],
    ['Department', p.department || '—'],
    [
      'Reports to',
      p.manager ? (
        <Link to={`/team/${p.manager.id}`} className="font-medium text-primary hover:underline">
          {p.manager.name}
        </Link>
      ) : (
        '—'
      ),
    ],
    ['Joined', p.join_date ? day(p.join_date) : '—'],
  ];
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <Avatar name={p.name} className="size-14 shrink-0 text-base" />
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words sm:text-[26px]">
              {p.name}
              {p.is_self && <span className="text-base font-normal text-muted-foreground"> (you)</span>}
            </h1>
            <p className="text-sm text-muted-foreground">{[p.designation, p.department].filter(Boolean).join(' · ') || '—'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.roles.map((r) => (
                <Chip key={r} tone="primary">
                  {r}
                </Chip>
              ))}
              {p.reports > 0 && (
                <Chip>
                  <UsersRound className="size-3.5" aria-hidden /> {p.reports} report{p.reports === 1 ? '' : 's'}
                </Chip>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 text-sm md:items-end">
          {p.email && (
            <a href={`mailto:${p.email}`} className="inline-flex min-h-8 items-center gap-1.5 break-all text-primary hover:underline">
              <Mail className="size-4 shrink-0" aria-hidden /> {p.email}
            </a>
          )}
          {p.phone && (
            <a href={`tel:+${p.phone.replace(/\D/g, '')}`} className="inline-flex min-h-8 items-center gap-1.5 font-mono text-primary hover:underline">
              <Phone className="size-4 shrink-0" aria-hidden /> {p.phone}
            </a>
          )}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ─── overview ────────────────────────────────────────────────────────────

function Overview({ data }: { data: Team360Summary }) {
  const a = data.attendance;
  const t = data.tasks;
  return (
    <div className="space-y-4">
      {a && (
        <section aria-label="Attendance" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Attendance</h2>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile
              icon={CalendarCheck}
              label="Attendance"
              value={<span className={RATE_TEXT[rateTone(a.attendance_rate)]}>{pct(a.attendance_rate)}</span>}
              sub={`${a.present_days} of ${a.working_days} working days`}
              tone="success"
            />
            <Tile
              icon={Clock3}
              label="Late days"
              value={a.late_days}
              tone="warning"
              alert={a.late_days > 3}
              sub={`${a.half_days} half · ${a.absent_days} absent`}
            />
            <Tile icon={Timer} label="Avg hours" value={a.avg_minutes ? hrs(a.avg_minutes) : '—'} sub={`${a.total_hours} h in all`} tone="info" />
            <Tile
              icon={Palmtree}
              label="Leave taken"
              value={a.leave_days}
              sub={`${a.leave_requests.pending} pending · balances under Attendance`}
              tone="info"
            />
          </div>
          {a.regularizations.approved + a.regularizations.pending + a.regularizations.rejected > 0 && (
            <p className="text-sm text-muted-foreground">
              Regularizations: {a.regularizations.approved} approved · {a.regularizations.pending} pending · {a.regularizations.rejected} rejected
            </p>
          )}
        </section>
      )}
      {t && (
        <section aria-label="Tasks" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tasks</h2>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile icon={ClipboardList} label="Assigned" value={t.assigned} sub={`${t.pending} still open`} />
            <Tile icon={ListChecks} label="Completed" value={t.completed} sub={`${t.in_time} on time · ${t.delayed} late`} tone="success" />
            <Tile icon={Target} label="On time" value={pct(t.on_time_rate)} sub={t.score != null ? `Score ${t.score}` : 'No score yet'} />
            <Tile icon={AlarmClock} label="Overdue" value={t.overdue} alert={t.overdue > 0} tone="danger" />
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            <Tile
              icon={Trophy}
              label="Date change requests"
              value={t.change_requests.requests}
              tone="warning"
              sub={
                t.change_requests.rank
                  ? `Rank ${t.change_requests.rank} of ${t.change_requests.of} who asked (1 = asks most)`
                  : 'Did not ask to move a due date'
              }
            />
            {t.review && (
              <Card className="flex items-center p-4 text-sm">
                <span>{t.review}</span>
              </Card>
            )}
          </div>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {a && a.trend.length > 1 && <AttendanceTrend trend={a.trend} />}
        {t && t.trend.length > 1 && <TaskTrend trend={t.trend} />}
      </div>
      {!a && !t && <Empty icon={BarChart3}>Neither Attendance nor Tasks is in this company's plan.</Empty>}
    </div>
  );
}

function AttendanceTrend({ trend }: { trend: NonNullable<Team360Summary['attendance']>['trend'] }) {
  const shown = trend.filter((b) => b.working_days > 0);
  const colour = themeColour('success');
  const best = shown.reduce<(typeof shown)[number] | null>((m, b) => (m == null || (b.attendance_rate ?? 0) > (m.attendance_rate ?? 0) ? b : m), null);
  const worst = shown.reduce<(typeof shown)[number] | null>((m, b) => (m == null || (b.attendance_rate ?? 101) < (m.attendance_rate ?? 101) ? b : m), null);
  return (
    <Panel icon={CalendarDays} tone="success" title="Attendance by week">
      {shown.length === 0 ? (
        <Empty>No working days yet in this period.</Empty>
      ) : (
        <>
          <div className="h-56" role="img" aria-label={`Attendance by week: ${shown.map((b) => `${b.label} ${pct(b.attendance_rate)}`).join(', ')}`}>
            <Bar
              plugins={[barValueLabels]}
              data={{
                labels: shown.map((b) => b.label),
                datasets: [
                  {
                    label: 'Attendance %',
                    data: shown.map((b) => b.attendance_rate ?? 0),
                    backgroundColor: colour,
                    borderRadius: 4,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                layout: { padding: { top: 18 } },
                scales: {
                  ...axisOptions(),
                  y: { ...axisOptions().y, max: 100 },
                },
              }}
            />
          </div>
          {best && worst && (
            <p className="mt-2 text-xs text-muted-foreground">
              Best: {best.label} ({pct(best.attendance_rate)}). Lowest: {worst.label} ({pct(worst.attendance_rate)}).
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function TaskTrend({ trend }: { trend: NonNullable<Team360Summary['tasks']>['trend'] }) {
  const done = trend.reduce((s, b) => s + b.completed, 0);
  const late = trend.reduce((s, b) => s + b.late, 0);
  return (
    <Panel icon={BarChart3} title="Tasks completed by week">
      <div
        className="h-56"
        role="img"
        aria-label={`Tasks completed by week: ${trend.map((b) => `${b.label} ${b.on_time} on time, ${b.late} late`).join('; ')}`}
      >
        <Bar
          data={{
            labels: trend.map((b) => b.label),
            datasets: [
              {
                label: 'On time',
                data: trend.map((b) => b.on_time),
                backgroundColor: themeColour('success'),
                borderRadius: 4,
                stack: 's',
              },
              {
                label: 'Late',
                data: trend.map((b) => b.late),
                backgroundColor: themeColour('warning'),
                borderRadius: 4,
                stack: 's',
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: themeColour('muted-foreground'),
                  boxWidth: 12,
                },
              },
            },
            scales: {
              x: { ...axisOptions().x, stacked: true },
              y: { ...axisOptions().y, stacked: true },
            },
          }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {done} completed in this period, {late} after the due date.
      </p>
    </Panel>
  );
}

// ─── attendance ──────────────────────────────────────────────────────────

const REG_TONE = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
} as const;

function AttendanceTab({ id, name }: { id: number; name: string }) {
  const now = new Date();
  const [ym, setYm] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [selected, setSelected] = useState<AttendanceDay | null>(null);
  const q = useTeam360Attendance(id, ym.year, ym.month);
  const data = q.data;
  const shown = selected ? (data?.days.find((d) => d.date === selected.date) ?? null) : null;
  const shift = (d: number) => {
    setSelected(null);
    setYm(({ year, month }) => {
      const m = month + d;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    });
  };
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = data?.totals ?? {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center font-semibold" aria-live="polite">
          {MONTHS[ym.month - 1]} {ym.year}
        </span>
        <Button size="icon-sm" variant="outline" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight />
        </Button>
        {data && (
          <div className="flex flex-wrap gap-1.5 sm:ml-auto">
            <Chip tone="success">Present {(t.present ?? 0) + (t.late ?? 0)}</Chip>
            <Chip tone="warning">Late {t.late ?? 0}</Chip>
            <Chip tone="warning">Half {t.half_day ?? 0}</Chip>
            <Chip tone="info">Leave {t.leave ?? 0}</Chip>
            <Chip tone="danger">Absent {t.absent ?? 0}</Chip>
            <Chip>{data.total_hours} h</Chip>
          </div>
        )}
      </div>
      {!data ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <Calendar days={data.days} year={ym.year} month={ym.month} selected={shown} onSelect={(d) => setSelected(selected?.date === d.date ? null : d)} />
      )}
      {shown && shown.status && data && (
        <Panel
          icon={CalendarCheck}
          title={
            <>
              {new Date(`${shown.date}T00:00:00`).toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              <AttendanceChip status={shown.status} extra={shown.holiday ? `: ${shown.holiday}` : ''} />
              {shown.regularized && <RegularizedTag reason={shown.regularization_reason} mode={shown.work_mode} />}
            </>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Check in">
              {time(shown.check_in) || '—'}
              {data.can_see_photos && shown.has_check_in_photo && (
                <PunchPhoto key={`${shown.attendance_id}-in`} id={shown.attendance_id} which="in" label={`${name} check-in photo`} />
              )}
            </Fact>
            <Fact label="Check out">
              {time(shown.check_out) || '—'}
              {data.can_see_photos && shown.has_check_out_photo && (
                <PunchPhoto key={`${shown.attendance_id}-out`} id={shown.attendance_id} which="out" label={`${name} check-out photo`} />
              )}
            </Fact>
            <Fact label="Worked">{hrs(shown.working_minutes)}</Fact>
          </dl>
          {(() => {
            const place = data.days.find((d) => d.date === shown.date)?.place;
            if (!place || (!place.office && place.lat == null)) return null;
            return (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
                <MapPin className="size-4 text-muted-foreground" aria-hidden />
                {place.office ?? 'Outside the offices'}
                {place.lat != null && place.lng != null && (
                  <a href={`https://www.google.com/maps?q=${place.lat},${place.lng}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Open on the map
                  </a>
                )}
              </p>
            );
          })()}
          {shown.request && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
              Request: {shown.request.reason_label} <Chip tone={REG_TONE[shown.request.status]}>{shown.request.status}</Chip>
            </p>
          )}
        </Panel>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel icon={ClipboardCheck} title="Regularizations this month">
            {data.regularizations.length === 0 ? (
              <Empty>None this month.</Empty>
            ) : (
              <ul className="divide-y">
                {data.regularizations.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{day(r.date)}</span>
                      <span>{r.reason}</span>
                      <Chip tone={REG_TONE[r.status]}>{r.status_display}</Chip>
                      {r.source === 'hr' && <Chip>Added by {r.added_by ?? 'HR'}</Chip>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.from_status && r.to_status ? `${r.from_status.replace('_', ' ')} → ${r.to_status.replace('_', ' ')} · ` : ''}
                      {r.reviewed_by ? `decided by ${r.reviewed_by}${r.reviewed_at ? ` on ${dayTime(r.reviewed_at)}` : ''}` : 'waiting for a decision'}
                      {r.remarks ? ` · “${r.remarks}”` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel icon={Palmtree} tone="info" title="Leave">
            {data.leave_balances.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {data.leave_balances.map((b) => (
                  <Chip key={b.leave_type} tone="info">
                    {b.name}: {b.limited ? `${b.available ?? b.balance} left` : `${b.used ?? 0} used`}
                  </Chip>
                ))}
              </div>
            )}
            {data.leaves.length === 0 ? (
              <Empty>No leave this month.</Empty>
            ) : (
              <ul className="divide-y">
                {data.leaves.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-1.5 py-2 text-sm">
                    <span className="font-semibold">{l.type}</span>
                    <span>
                      {day(l.start_date)}
                      {l.end_date !== l.start_date ? ` – ${day(l.end_date)}` : ''} ({l.days} day{l.days === 1 ? '' : 's'})
                    </span>
                    <Chip tone={l.status === 'approved' ? 'success' : l.status === 'pending' ? 'warning' : 'danger'}>{l.status_display}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2">
      <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 flex items-center font-mono text-lg font-bold tabular-nums">{children}</dd>
    </div>
  );
}

// ─── tasks ───────────────────────────────────────────────────────────────

function TasksTab({ id, name, period, summary }: { id: number; name: string; period: Team360PeriodInput; summary: Team360Summary }) {
  const access = useAccess();
  const q = useTeam360Tasks(id, period);
  const data = q.data;
  // The person Excel report (PLAN.md §19.41): admins and the Owner; quarters and custom periods go as dates.
  const canExport = access.tasks.can('tasks.view_all');
  const exportRange = period.range === 'this_quarter' || period.range === 'custom' ? 'custom' : period.range;
  const custom = { start: summary.period.start, end: summary.period.end };
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data && <Chip tone="primary">On time {pct(data.on_time_rate)} of what they completed</Chip>}
        {canExport && (
          <DownloadButton
            format="xlsx"
            size="sm"
            className="max-sm:w-full sm:ml-auto"
            target={tasksExports.personReport(id, exportRange, custom)}
            filename={fileSlug('tasks', 'performance', name, exportRange, todayStamp())}
            aria-label={`Excel report for ${name}`}
          >
            Excel report
          </DownloadButton>
        )}
      </div>
      {!data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <TaskList icon={ClipboardList} title="Open" rows={data.open} more={data.open_more} empty="Nothing open." />
          <TaskList
            icon={ListChecks}
            title="Completed in this period"
            rows={data.completed}
            more={data.completed_more}
            empty="Nothing completed in this period."
          />
          <TaskList icon={Network} title="Task chains" rows={data.chains} empty="Not part of any task chain." chain className="lg:col-span-2" />
        </div>
      )}
    </div>
  );
}

function TaskList({
  icon,
  title,
  rows,
  more: capped,
  empty,
  chain,
  className,
}: {
  icon: typeof ClipboardList;
  title: string;
  rows: Team360Task[];
  more?: boolean;
  empty: string;
  chain?: boolean;
  className?: string;
}) {
  const more = useShowMore(rows, { step: 10 });
  const overdue = rows.filter((r) => r.overdue).length;
  return (
    <Panel
      icon={icon}
      title={
        <>
          {title}{' '}
          <Chip>
            {rows.length}
            {capped ? '+' : ''}
          </Chip>
          {overdue > 0 && !chain && <Chip tone="danger">{overdue} overdue</Chip>}
        </>
      }
      className={className}
    >
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y">
          {more.visible.map((t) => (
            <li key={t.id} className={cn('border-l-[3px] border-l-transparent py-2 pl-2', t.overdue && 'border-l-destructive')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-sm bg-muted px-1.5 font-mono text-xs">{t.code}</span>
                <Link to={`/tasks/tasks/${t.id}`} className="min-w-0 font-semibold break-words hover:text-primary hover:underline">
                  {t.title}
                </Link>
                {t.on_time === true && <Chip tone="success">On time</Chip>}
                {t.on_time === false && <Chip tone="warning">Late</Chip>}
                {t.overdue && <Chip tone="danger">Overdue</Chip>}
                {chain && <Chip>{t.level ? `Level ${t.level}` : 'Main task'}</Chip>}
                {chain && !!t.parts && (
                  <Chip tone="primary">
                    {t.parts} part{t.parts === 1 ? '' : 's'} given
                  </Chip>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.status_display}
                {t.given_by ? ` · from ${t.given_by}` : ''}
                {t.due_at ? ` · due ${dayTime(t.due_at)}` : ''}
                {t.completed_at ? ` · done ${dayTime(t.completed_at)}` : ''}
                {chain && t.root ? ` · part of ${t.root.code} ${t.root.title}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && <ShowMore {...more.footer} noun="tasks" />}
    </Panel>
  );
}

// ─── assets (Assets API, its own permissions) ────────────────────────────

function AssetsTab({ code, name }: { code: string; name: string }) {
  const access = useAccess();
  const found = useEmployees({ search: code || name, pageSize: 10 });
  const match = useMemo(() => {
    const items = found.data?.items ?? [];
    return (
      (code && items.find((e) => e.employeeCode.toLowerCase() === code.toLowerCase())) ||
      items.find((e) => e.fullName.toLowerCase() === name.toLowerCase()) ||
      null
    );
  }, [found.data, code, name]);
  const emp = useEmployee(match?.id);
  const canTickets = access.assets.can('ticket:manage');
  if (found.error) return <ErrorState error={found.error} onRetry={() => found.refetch()} />;
  if (!found.data) return <Skeleton className="h-48 rounded-xl" />;
  if (!match) return <Empty icon={Package}>{name} has no employee record in Assets yet.</Empty>;
  const e = emp.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        icon={Package}
        title={<>Assets they hold {e && <Chip>{e.assets.length}</Chip>}</>}
        actions={
          <Link to={`/assets/employees/${match.id}`} className="text-sm font-medium text-primary hover:underline">
            Open in Assets
          </Link>
        }
      >
        {!e ? (
          <Skeleton className="h-24" />
        ) : e.assets.length === 0 ? (
          <Empty>Nothing assigned.</Empty>
        ) : (
          <ul className="divide-y">
            {e.assets.map((a) => (
              <li key={a.allocationId} className="py-2 text-sm">
                <Link to={`/assets/assets/${a.assetId}`} className="font-semibold hover:text-primary hover:underline">
                  {a.name}
                </Link>{' '}
                <span className="font-mono text-xs text-muted-foreground">{a.assetTag}</span>
                <p className="text-xs text-muted-foreground">
                  {a.categoryName} · since {day(a.assignedAt)}
                  {a.quantity > 1 ? ` · ${a.quantity} pcs` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {canTickets && <TicketsPanel name={name} />}
    </div>
  );
}

/** Tickets they raised (Assets "Manage tickets" only; matched by the reporter's name). */
function TicketsPanel({ name }: { name: string }) {
  const tickets = useTickets({ search: name, pageSize: 50 });
  const mine = (tickets.data?.items ?? []).filter((t) => t.reportedByName?.toLowerCase() === name.toLowerCase());
  return (
    <Panel
      icon={Briefcase}
      title={
        <>
          Tickets they raised <Chip>{mine.length}</Chip>
        </>
      }
    >
      {!tickets.data ? (
        <Skeleton className="h-24" />
      ) : mine.length === 0 ? (
        <Empty>No tickets.</Empty>
      ) : (
        <ul className="divide-y">
          {mine.map((t) => (
            <li key={t.id} className="py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{t.number}</span> <span className="font-semibold">{t.title}</span>
              <p className="text-xs text-muted-foreground">
                {t.status.toLowerCase().replace(/_/g, ' ')} · {day(t.createdAt)}
                {t.assetTag ? ` · ${t.assetTag}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── visitors ────────────────────────────────────────────────────────────

function VisitorsTab({ id, period }: { id: number; period: Team360PeriodInput }) {
  const q = useTeam360Visitors(id, period);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48 rounded-xl" />;
  const rows = q.data.rows;
  return (
    <Panel
      icon={UserCheck}
      title={
        <>
          Visitors they hosted <Chip>{rows.length}</Chip>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>No visitors in this period.</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((v) => (
            <li key={v.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{v.name}</span>
                {v.company && <span className="text-muted-foreground">{v.company}</span>}
                {v.people > 1 && <Chip>+{v.people - 1}</Chip>}
                <Chip tone={v.status === 'inside' ? 'success' : v.status === 'denied' || v.status === 'rejected' ? 'danger' : 'neutral'}>
                  {v.status_display}
                </Chip>
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  v.purpose,
                  v.location,
                  v.check_in_at ? `in ${dayTime(v.check_in_at)}` : `added ${dayTime(v.created_at)}`,
                  v.check_out_at ? `out ${time(v.check_out_at)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
