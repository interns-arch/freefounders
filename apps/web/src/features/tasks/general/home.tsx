/** /tasks — the Tasks home dashboard (old pages/Home.jsx). */
import { errorMessage, useAccess } from '@freefounders/core';
import { type HomeFilters, type Task, useDelegatedOpen, useHomeSummary, useLeadsDashboard, useMyTaskTiles } from '@freefounders/core/tasks';
import {
  CheckCircle2,
  Clock,
  Flame,
  Hourglass,
  IndianRupee,
  ListTodo,
  MessageSquare,
  Percent,
  Phone,
  Play,
  Send,
  Sparkles,
  Target,
  Trophy,
  X,
  BarChart3,
  Inbox,
  CalendarDays,
  Building2,
  Users,
  Megaphone,
  ClipboardList,
  Activity,
} from '@/components/icons';
import { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/common/page';
import { Avatar, Progress, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn, formatMoney } from '@/lib/utils';
import { relDue } from '../shared/format';
import { axisOptions, barValueLabels, themeColour } from './charts';
import { DelegationCard, MyDelegationCard } from './delegation';
import { Deadlines, HomeFilterBar, MistakesCard, NoticesCard, ScoreCard, TeamInsights, WaitingOnMe } from './home-insights';
import { Chip, Empty, ErrorNote, Panel, PriorityChip, SectionHead, TaskStatusChip, Tile, fmtWhen } from './parts';

const LEADS = '/tasks/leads';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomePage() {
  const access = useAccess();
  const me = access.tasks.me;
  const [filters, setFilters] = useState<HomeFilters>({ range: 'this_month', start: '', end: '', department: '' });
  const home = useHomeSummary(filters);
  // The pipeline half of this page only means something to people who actually work leads.
  const worksLeads = access.tasks.can('leads.view_all') || access.tasks.can('leads.view_department') || access.tasks.can('leads.view_own');
  const showLeads = access.tasks.module('leads') && worksLeads && access.tasks.can('dashboard.view');
  const leads = useLeadsDashboard(showLeads);

  if (!me) return <PageLoader />;
  // An Admin-level role (any name) is an administrator in Tasks: it sees everyone's delegated work.
  const isAdmin = (me.level ?? 0) >= 3 || ['admin', 'super_admin'].includes(me.role);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const head = (
    <>
      <section
        aria-label="Welcome"
        className="relative overflow-hidden rounded-2xl border bg-card px-4 py-4 shadow-card sm:px-5 sm:py-5"
      >
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight sm:text-[28px]">
              {greeting()}, <span className="text-primary">{me.first_name || me.username}</span>
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="size-3.5" /> {today}
            </p>
          </div>
          <Chip tone="primary" className="px-2.5 py-1">
            <Building2 className="size-3.5" /> {isAdmin ? 'All departments' : `${me.department_display} department`}
          </Chip>
        </div>
        <div className="relative mt-4 border-t pt-3">
          <HomeFilterBar filters={filters} setFilters={setFilters} home={home.data} />
        </div>
      </section>
      {home.error && <ErrorNote>{errorMessage(home.error)}</ErrorNote>}
      <WaitingOnMe home={home.data} />
    </>
  );

  const mine = (
    <>
      <div className="grid gap-4 lg:grid-cols-12">
        {access.tasks.can('notices.view') && <NoticesCard className="lg:col-span-12" />}
        <Deadlines className="lg:col-span-7" />
        <ScoreCard home={home.data} className="lg:col-span-5" />
        {!isAdmin && <MyDelegationCard className="lg:col-span-12" />}
        <MistakesCard home={home.data} className="lg:col-span-12" />
      </div>
      <TeamInsights home={home.data} />
      {/* everyone's given / received: admins and super admins only */}
      {isAdmin && <DelegationCard department={filters.department} />}
    </>
  );
  // admins already see every task under Tasks → All tasks
  const delegated = !isAdmin && <DelegatedCard />;

  if (!showLeads) {
    return (
      <div className="space-y-4">
        {head}
        <MyTiles />
        {mine}
        {delegated}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {head}
      {leads.error ? (
        <>
          <ErrorNote>{errorMessage(leads.error)}</ErrorNote>
          <MyTiles />
          {mine}
          {delegated}
        </>
      ) : !leads.data ? (
        <Skeleton className="h-64" />
      ) : (
        <LeadsDashboard data={leads.data} isAdmin={isAdmin} teamWide={isAdmin || access.tasks.can('tasks.view_department')} mine={mine} delegated={delegated} />
      )}
    </div>
  );
}

/** Everyone has tasks, whatever their role: the part of the dashboard that is never empty. */
function MyTiles() {
  const q = useMyTaskTiles();
  const t = q.data;
  const v = (n: number | undefined) => (t ? n : '—');
  return (
    <>
      <SectionHead>My work</SectionHead>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile icon={ListTodo} label="My open tasks" to="/tasks/tasks?tab=my&status=open" value={t ? t.pending + t.in_progress : '—'} />
        <Tile icon={Flame} tone="danger" label="Overdue" to="/tasks/tasks?tab=my&status=open&overdue=1" value={v(t?.overdue)} alert={(t?.overdue ?? 0) > 0} />
        <Tile icon={Play} tone="warning" label="In progress" to="/tasks/tasks?tab=my&status=in_progress" value={v(t?.in_progress)} />
        <Tile icon={CheckCircle2} tone="success" label="Completed" to="/tasks/tasks?tab=my&status=done" value={v(t?.completed)} />
        <Tile icon={Trophy} tone="info" label="Finished on time" to="/tasks/tasks?tab=my&status=done&done=on_time" value={v(t?.in_time)} />
        <Tile icon={Hourglass} tone="warning" label="Delayed" to="/tasks/tasks?tab=my&status=done&done=late" value={v(t?.delayed)} alert={(t?.delayed ?? 0) > 0} />
      </div>
      {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
    </>
  );
}

/** Work this person handed to someone else, still open. */
function DelegatedCard() {
  const q = useDelegatedOpen();
  const rows = q.data?.rows;
  const total = q.data?.total ?? 0;
  return (
    <Panel
      icon={Send}
      title={
        <>
          Tasks I've delegated {rows && total > 0 && <Chip tone="primary">{total} open</Chip>}
        </>
      }
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/tasks/tasks?tab=delegated">All delegated →</Link>
        </Button>
      }
    >
      {!rows && <Skeleton className="h-24" />}
      {rows?.length === 0 && <Empty icon={Send}>You haven't handed out any open tasks.</Empty>}
      {rows && rows.length > 0 && (
        <>
          <div className="grid gap-2 md:hidden">
            {rows.map((t) => (
              <Link key={t.id} to={`/tasks/tasks/${t.id}`} className="block rounded-xl border bg-card p-3 transition hover:border-primary/40 hover:shadow-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  <TaskStatusChip status={t.status} label={t.status_display} />
                  {t.priority !== 'normal' && <PriorityChip priority={t.priority} label={t.priority_display} />}
                </div>
                <div className="mt-1 text-sm font-medium">{t.title}</div>
                {t.description && <div className="text-xs text-muted-foreground">{t.description.slice(0, 110)}</div>}
                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <Avatar name={t.assigned_to_detail?.name} className="size-6" />
                    {t.assigned_to_detail?.name}
                  </span>
                  <span className={cn(t.is_overdue ? 'text-destructive' : 'text-muted-foreground')}>{t.due_at ? relDue(t.due_at) : 'No due date'}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <Progress value={t.progress_percent ?? 0} />
                  {t.progress_percent ?? 0}%
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden md:block">
            <DelegatedTable rows={rows} />
          </div>
        </>
      )}
    </Panel>
  );
}

function DelegatedTable({ rows }: { rows: Task[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Task</TH>
          <TH>Assigned to</TH>
          <TH>Status</TH>
          <TH>Priority</TH>
          <TH>Due</TH>
          <TH>Progress</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((t) => (
          <TR key={t.id}>
            <TD className="min-w-64">
              <Link to={`/tasks/tasks/${t.id}`} className="hover:underline">
                <span className="mr-1 font-mono text-xs text-muted-foreground">{t.code}</span>
                <strong>{t.title}</strong>
              </Link>
              {t.description && <div className="mt-0.5 text-xs text-muted-foreground">{t.description.slice(0, 140)}</div>}
              <div className="text-xs text-muted-foreground">
                Given {fmtWhen(t.created_at)}
                {t.effort_minutes ? <> · {t.effort_minutes}m effort</> : null}
                {t.pending_change_requests > 0 && (
                  <>
                    {' '}
                    · <span className="text-destructive">change requested</span>
                  </>
                )}
              </div>
            </TD>
            <TD>
              {t.assigned_to_detail ? (
                <span className="flex items-center gap-2">
                  <Avatar name={t.assigned_to_detail.name} className="size-7" />
                  {t.assigned_to_detail.name}
                </span>
              ) : (
                '—'
              )}
            </TD>
            <TD>
              <TaskStatusChip status={t.status} label={t.status_display} />
            </TD>
            <TD>
              <PriorityChip priority={t.priority} label={t.priority_display} />
            </TD>
            <TD className={cn('whitespace-nowrap', t.is_overdue && 'text-destructive')}>{t.due_at ? relDue(t.due_at) : '—'}</TD>
            <TD>
              <div className="flex w-28 items-center gap-2 text-xs">
                <Progress value={t.progress_percent ?? 0} />
                {t.progress_percent ?? 0}%
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function LeadsDashboard({
  data,
  teamWide,
  mine,
  delegated,
}: {
  data: NonNullable<ReturnType<typeof useLeadsDashboard>['data']>;
  isAdmin: boolean;
  teamWide: boolean;
  mine: React.ReactNode;
  delegated: React.ReactNode;
}) {
  const { tiles, status_dist, per_day, employees, sources, recent_inbound, recent_events } = data;
  const maxStatus = Math.max(1, ...status_dist.map((s) => s.count));
  const hasLeads = tiles.total > 0;
  const teamTasks = `/tasks/tasks?tab=${teamWide ? 'all' : 'my'}&status=`;
  const overduePct = tiles.open_tasks ? Math.round((100 * tiles.overdue_tasks) / tiles.open_tasks) : 0;
  const primary = themeColour('primary');

  return (
    <>
      <SectionHead>Tasks</SectionHead>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={ListTodo} label="Open tasks" to={`${teamTasks}open`} value={tiles.open_tasks} sub="assigned and not done" />
        <Tile
          icon={Flame}
          tone="danger"
          label="Overdue tasks"
          to={`${teamTasks}open&overdue=1`}
          value={tiles.overdue_tasks}
          alert={tiles.overdue_tasks > 0}
          sub={tiles.open_tasks ? `${overduePct}% of open tasks` : null}
        />
        <Tile icon={Phone} tone="info" label="Pending follow-ups" to={LEADS} value={tiles.pending_followups} />
        <Tile icon={Clock} tone="warning" label="Overdue follow-ups" to={LEADS} value={tiles.overdue} alert={tiles.overdue > 0} />
      </div>

      {mine}
      {delegated}

      <SectionHead>Leads</SectionHead>
      {hasLeads ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Tile icon={Target} label="Total leads" to={LEADS} value={tiles.total} />
          <Tile icon={Sparkles} tone="info" label="New" to={LEADS} value={tiles.new} />
          <Tile icon={Play} tone="warning" label="Active" to={LEADS} value={tiles.active} />
          <Tile icon={Trophy} tone="success" label="Won" to={LEADS} value={tiles.won} />
          <Tile icon={X} tone="danger" label="Lost" to={LEADS} value={tiles.lost} />
          <Tile icon={IndianRupee} tone="primary" label="Pipeline value" to={LEADS} value={formatMoney(tiles.pipeline_value, 'INR', true) || '₹0'} />
          <Tile icon={Percent} tone="info" label="Conversion" to={LEADS} value={`${tiles.conversion_pct}%`} />
        </div>
      ) : (
        <Panel>
          <Empty icon={Target} className="py-4">No leads yet. Pipeline, conversion and sources show up here once leads come in.</Empty>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {hasLeads && (
          <Panel className="lg:col-span-8" icon={BarChart3} title="Leads created — last 14 days">
            <div className="h-60" role="img" aria-label={`Leads created per day, last 14 days: ${per_day.map((d) => `${d.date} ${d.count}`).join(', ')}`}>
              <Bar
                plugins={[barValueLabels]}
                data={{
                  labels: per_day.map((d) => new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })),
                  datasets: [{ data: per_day.map((d) => d.count), backgroundColor: primary, borderRadius: 6, maxBarThickness: 26 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } }, plugins: { legend: { display: false }, tooltip: { displayColors: false } }, scales: axisOptions() }}
              />
            </div>
          </Panel>
        )}
        {hasLeads && (
          <Panel className="lg:col-span-4" icon={Target} tone="info" title="Pipeline by stage">
            <div className="grid gap-2">
              {status_dist.map((s) => (
                <div key={s.status} className="flex items-center gap-2 text-sm" title={`${s.label}: ${s.count}`}>
                  <span className="w-28 truncate text-muted-foreground">{s.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        {hasLeads && employees.length > 0 && (
          <Panel className="lg:col-span-12" icon={Users} tone="success" title="Lead performance by employee">
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Lost</TH>
                  <TH className="text-right">Overdue follow-ups</TH>
                  <TH className="text-right">Open tasks</TH>
                </TR>
              </THead>
              <TBody>
                {employees.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={e.name} className="size-7" />
                        <span>
                          <span className="block font-medium">{e.name}</span>
                          <span className="block text-xs text-muted-foreground">{e.role}</span>
                        </span>
                      </span>
                    </TD>
                    <TD className="text-right">{e.total}</TD>
                    <TD className="text-right">{e.open}</TD>
                    <TD className="text-right text-success">{e.won}</TD>
                    <TD className="text-right">{e.lost}</TD>
                    <TD className={cn('text-right', e.overdue > 0 && 'text-destructive')}>{e.overdue}</TD>
                    <TD className="text-right">{e.open_tasks}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Panel>
        )}
        {hasLeads && (
          <Panel className="lg:col-span-4" icon={ClipboardList} tone="warning" title="Lead sources">
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Conv.</TH>
                </TR>
              </THead>
              <TBody>
                {sources.map((s) => (
                  <TR key={s.source}>
                    <TD className="font-medium">{s.label}</TD>
                    <TD className="text-right">{s.total}</TD>
                    <TD className="text-right text-success">{s.won}</TD>
                    <TD className="text-right">{s.conversion_pct}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Panel>
        )}
        <Panel className={hasLeads ? 'lg:col-span-4' : 'lg:col-span-6'} icon={Megaphone} tone="info" title="WhatsApp / Gmail activity">
          {recent_inbound.length === 0 ? (
            <Empty icon={Inbox} className="py-4">No inbound messages yet.</Empty>
          ) : (
            <ul className="grid gap-3">
              {recent_inbound.map((m, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} />
                  <div className="min-w-0">
                    <strong>{m.sender}</strong> <span className="text-xs text-muted-foreground">→ {m.lead_name || m.status}</span>
                    <div className="text-xs text-muted-foreground">{m.body}</div>
                    <div className="text-xs text-muted-foreground">{fmtWhen(m.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className={hasLeads ? 'lg:col-span-4' : 'lg:col-span-6'} icon={Activity} tone="success" title="Recent lead activity">
          {recent_events.length === 0 ? (
            <Empty icon={BarChart3} className="py-4">No lead activity yet.</Empty>
          ) : (
            <ul className="grid gap-3">
              {recent_events.map((e, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <div className="min-w-0">
                    <strong>{e.lead_name}</strong> <span className="text-xs text-muted-foreground">{e.body}</span>
                    <div className="text-xs text-muted-foreground">
                      {e.actor} · {fmtWhen(e.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
