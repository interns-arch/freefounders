/**
 * The working parts of the dashboard (old HomeInsights.jsx): what is waiting on me, my deadlines, my score, my open
 * mistakes, notices, and — for anyone with a team — where overdue work sits, how late it is, who does best and who
 * needs a look. Numbers come from /tasks/home/ (same scoring as Team Performance).
 */
import { useAccess } from '@freefounders/core';
import { HOME_RANGES, type HomeFilters, type HomeSummary, type Task, useNotices, useTaskDepartments, useTaskList, useWaitingCounts } from '@freefounders/core/tasks';
import { AlertTriangle, Bell, CheckCheck, Inbox, Megaphone, PartyPopper, ThumbsUp, Coffee } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { relDue } from '../shared/format';
import { Linkify } from '../shared/linkify';
import { Chip, Panel, PriorityChip, Segmented, SmartLink, fmtDay } from './parts';

const MISTAKES = '/classic/tasks/mistakes';

// ─── 15: filters ─────────────────────────────────────────────────────────
export function HomeFilterBar({ filters, setFilters, home }: { filters: HomeFilters; setFilters: (f: HomeFilters) => void; home?: HomeSummary }) {
  const depts = useTaskDepartments().data ?? [];
  const name = Object.fromEntries(depts.map((d) => [d.code, d.name]));
  const teamDepts = home?.team?.departments ?? [];
  const r = home?.range;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Date range" className="w-auto" value={filters.range} onChange={(e) => setFilters({ ...filters, range: e.target.value as HomeFilters['range'] })}>
        {HOME_RANGES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
      {filters.range === 'custom' && (
        <span className="flex items-center gap-2">
          <Input type="date" aria-label="From" className="w-auto" value={filters.start} onChange={(e) => setFilters({ ...filters, start: e.target.value })} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To" className="w-auto" value={filters.end} onChange={(e) => setFilters({ ...filters, end: e.target.value })} />
        </span>
      )}
      {teamDepts.length > 1 && (
        <NativeSelect aria-label="Department" className="w-auto" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
          <option value="">All departments</option>
          {teamDepts.map((d) => (
            <option key={d} value={d}>
              {name[d] || d}
            </option>
          ))}
        </NativeSelect>
      )}
      {r?.start && (
        <span className="text-xs text-muted-foreground">
          Scores for {fmtDay(r.start)} – {fmtDay(r.end)}
        </span>
      )}
    </div>
  );
}

// ─── 1: waiting on me ────────────────────────────────────────────────────
export function WaitingOnMe({ home }: { home?: HomeSummary }) {
  const access = useAccess();
  const counts = useWaitingCounts().data;
  const items = [
    { to: '/tasks/tasks?tab=reviews', icon: CheckCheck, label: 'Work to accept', n: counts?.accept ?? null },
    { to: '/tasks/tasks?tab=requests', icon: Inbox, label: 'Requests to decide', n: counts?.requests ?? null },
    ...(access.tasks.module('mistakes') ? [{ to: MISTAKES, icon: AlertTriangle, label: 'My open mistakes', n: home?.me?.mistakes_open ?? null }] : []),
  ];
  const loaded = items.every((i) => i.n !== null);
  const total = items.reduce((s, i) => s + (i.n || 0), 0);
  return (
    <section aria-label="Waiting on you" className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Bell className="size-4 text-primary" />
        <strong>Waiting on you</strong>
        {loaded && total === 0 && <span className="text-xs text-muted-foreground">Nothing — all clear ✓</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <SmartLink
            key={i.to}
            to={i.to}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:border-primary/40',
              (i.n ?? 0) > 0 ? 'border-warning/40 bg-warning/8' : 'bg-muted/30',
            )}
          >
            <i.icon className="size-4 text-muted-foreground" />
            <span className="flex-1">{i.label}</span>
            <strong className="tabular-nums">{i.n ?? '…'}</strong>
          </SmartLink>
        ))}
      </div>
    </section>
  );
}

// ─── 2: my deadlines ─────────────────────────────────────────────────────
type DeadlineTab = 'overdue' | 'today' | 'week';

export function Deadlines({ className }: { className?: string }) {
  const q = useTaskList({ scope: 'my', status: 'open,in_progress', page_size: 200 });
  const [tab, setTab] = useState<DeadlineTab | null>(null);
  const rows = q.data;

  const groups = useMemo(() => {
    const g: Record<DeadlineTab, Task[]> = { overdue: [], today: [], week: [] };
    if (!rows) return g;
    const now = new Date();
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const endWeek = new Date(endToday);
    endWeek.setDate(endWeek.getDate() + ((7 - endWeek.getDay()) % 7)); // through Sunday
    for (const t of rows) {
      if (!t.due_at) continue;
      const due = new Date(t.due_at);
      if (due < now) g.overdue.push(t);
      else if (due <= endToday) g.today.push(t);
      else if (due <= endWeek) g.week.push(t);
    }
    for (const k of Object.keys(g) as DeadlineTab[]) g[k].sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    return g;
  }, [rows]);

  const tabs: Array<[DeadlineTab, string]> = [
    ['overdue', 'Overdue'],
    ['today', 'Today'],
    ['week', 'This week'],
  ];
  const current = tab ?? tabs.find(([k]) => groups[k].length)?.[0] ?? 'today';
  const list = groups[current];

  return (
    <Panel
      className={className}
      title="My deadlines"
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/tasks/tasks">All my tasks →</Link>
        </Button>
      }
    >
      <Segmented
        label="Deadlines"
        value={current}
        onChange={setTab}
        className="mb-2"
        options={tabs.map(([k, l]) => [
          k,
          <>
            {l}
            <span className={cn('rounded-full bg-muted px-1.5 text-[11px] tabular-nums', k === 'overdue' && groups.overdue.length > 0 && 'bg-destructive/15 text-destructive')}>{groups[k].length}</span>
          </>,
        ])}
      />
      {!rows && <Skeleton className="h-24" />}
      {rows && list.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-6 text-sm text-muted-foreground">
          {current === 'overdue' ? <PartyPopper className="size-5" /> : <Coffee className="size-5" />}
          {current === 'overdue' ? 'Nothing overdue.' : current === 'today' ? 'Nothing due today.' : 'Nothing else due this week.'}
        </div>
      )}
      <ul className="divide-y">
        {list.slice(0, 8).map((t) => (
          <li key={t.id}>
            <Link to={`/tasks/tasks/${t.id}`} className="flex items-start gap-3 py-2 hover:bg-muted/30">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.is_overdue ? 'bg-destructive' : 'bg-primary')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  <span className="mr-1 font-mono text-xs text-muted-foreground">{t.code}</span>
                  {t.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.status_display}
                  {t.created_by_detail && <> · from {t.created_by_detail.name}</>}
                  <span className={cn(t.is_overdue && 'text-destructive')}> · {relDue(t.due_at)}</span>
                </div>
              </div>
              {t.priority !== 'normal' && <PriorityChip priority={t.priority} label={t.priority_display} />}
            </Link>
          </li>
        ))}
      </ul>
      {list.length > 8 && <p className="mt-2 text-xs text-muted-foreground">+{list.length - 8} more in Tasks</p>}
    </Panel>
  );
}

// ─── 3: my score ─────────────────────────────────────────────────────────
export function ScoreDial({ value, size = 112 }: { value: number | null | undefined; size?: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const scored = value !== null && value !== undefined;
  const pct = scored ? Math.max(0, Math.min(100, value)) : 0;
  const tone = !scored ? 'stroke-border text-muted-foreground' : pct >= 75 ? 'stroke-success text-success' : pct >= 45 ? 'stroke-warning text-warning' : 'stroke-destructive text-destructive';
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" role="img" aria-label={scored ? `Score ${Math.round(pct)}` : 'No score yet'} className={tone}>
      <circle cx="56" cy="56" r={r} fill="none" className="stroke-muted" strokeWidth="10" />
      <circle cx="56" cy="56" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 56 56)" />
      <text x="56" y="56" textAnchor="middle" className="fill-current text-[26px] font-bold">
        {scored ? Math.round(pct) : '—'}
      </text>
      <text x="56" y="74" textAnchor="middle" className="fill-muted-foreground text-[11px]">
        score
      </text>
    </svg>
  );
}

export function ScoreCard({ home, className }: { home?: HomeSummary; className?: string }) {
  const me = home?.me;
  const d = me?.score_delta;
  return (
    <Panel title="My score" className={className}>
      {!me ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <ScoreDial value={me.score} />
          <div className="min-w-40 flex-1 space-y-1.5 text-sm">
            {d !== null && d !== undefined && (
              <div className={cn('text-xs font-semibold', d > 0 ? 'text-success' : d < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                {d > 0 ? '▲' : d < 0 ? '▼' : '•'} {Math.abs(d)} vs previous period
              </div>
            )}
            {me.score === null && <p className="text-xs text-muted-foreground">Nothing scored yet in this range — finish work others gave you to earn a score.</p>}
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">On time</span>
              <strong>{me.on_time_rate === null ? '—' : `${Math.round(me.on_time_rate)}%`}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Completed</span>
              <strong>{me.completed}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Finished late</span>
              <strong className={cn(me.delayed > 0 && 'text-destructive')}>{me.delayed}</strong>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ─── 6: my open mistakes ─────────────────────────────────────────────────
export function MistakesCard({ home, className }: { home?: HomeSummary; className?: string }) {
  const access = useAccess();
  const me = home?.me;
  if (!me || me.mistakes_open === 0 || !access.tasks.module('mistakes')) return null;
  return (
    <Panel
      className={className}
      title={
        <>
          My open mistakes <Chip tone="danger">{me.mistakes_open}</Chip>
        </>
      }
      actions={
        <Button asChild size="sm" variant="outline">
          <a href={MISTAKES}>Open register →</a>
        </Button>
      }
    >
      <ul className="divide-y">
        {me.mistakes.map((m) => (
          <li key={m.id}>
            <a href={MISTAKES} className="flex items-start gap-3 py-2 hover:bg-muted/30">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', m.is_overdue ? 'bg-destructive' : 'bg-warning')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  <span className="mr-1 font-mono text-xs text-muted-foreground">{m.code}</span>
                  {m.category}
                </div>
                <div className="text-xs text-muted-foreground">{m.description}</div>
                <div className="text-xs text-muted-foreground">
                  {m.status_display}
                  {m.sla_due_at && <span className={cn(m.is_overdue && 'text-destructive')}> · reply {relDue(m.sla_due_at)}</span>}
                </div>
              </div>
              <Chip tone={m.severity === 'high' || m.severity === 'critical' ? 'danger' : 'warning'}>{m.severity_display}</Chip>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── 7, 8, 12: the team ──────────────────────────────────────────────────
const AGE_TONE = ['bg-warning/60', 'bg-warning', 'bg-destructive/70', 'bg-destructive'];

export function TeamInsights({ home }: { home?: HomeSummary }) {
  const team = home?.team;
  const [all, setAll] = useState(false);
  if (!team) return null;
  const people = all ? team.overdue_by_person : team.overdue_by_person.slice(0, 8);
  const maxP = Math.max(1, ...team.overdue_by_person.map((p) => p.overdue));
  const maxA = Math.max(1, ...team.ageing.map((a) => a.count));
  const pct = team.open ? Math.round((100 * team.overdue) / team.open) : 0;
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <section aria-label="Team" className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Team</h2>
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title={
            <>
              Overdue by person <Chip tone="danger">{team.overdue} overdue</Chip>
            </>
          }
          actions={
            <span className="text-xs text-muted-foreground">
              {pct}% of {team.open} open tasks
            </span>
          }
        >
          {team.overdue_by_person.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-6 text-sm text-muted-foreground">
              <PartyPopper className="size-5" />
              Nobody has overdue work.
            </div>
          ) : (
            <div className="grid gap-2">
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-3" title={`${p.name}: ${p.overdue} overdue of ${p.open} open`}>
                  <span className="flex w-40 min-w-0 items-center gap-2">
                    <Avatar name={p.name} className="size-6" />
                    <span className="truncate text-sm">{p.name}</span>
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-destructive" style={{ width: `${(p.overdue / maxP) * 100}%` }} />
                  </div>
                  <span className="w-14 text-right text-sm tabular-nums">
                    <strong>{p.overdue}</strong>
                    <span className="text-muted-foreground">/{p.open}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {team.overdue_by_person.length > 8 && (
            <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${team.overdue_by_person.length} people`}
            </Button>
          )}
        </Panel>

        <Panel className="lg:col-span-5" title="How late is overdue work?">
          <div className="flex h-36 items-end gap-3">
            {team.ageing.map((a, i) => (
              <div key={a.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-sm font-semibold tabular-nums">{a.count}</span>
                <div className="flex w-full flex-1 items-end rounded-md bg-muted/50">
                  <div className={cn('w-full rounded-md', AGE_TONE[i] ?? 'bg-destructive')} style={{ height: `${Math.max(a.count ? 8 : 0, (a.count / maxA) * 100)}%` }} />
                </div>
                <span className="text-center text-[11px] text-muted-foreground">{a.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Days past the due date, for every open task that is overdue right now.</p>
        </Panel>

        <Panel className="lg:col-span-5" title="Top performers">
          {team.top.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No scored work in this range yet.</p>
          ) : (
            <ul className="grid gap-2">
              {team.top.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3">
                  <span aria-hidden className="w-5 text-lg">
                    {medals[i]}
                  </span>
                  <Avatar name={t.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.on_time_rate !== null && `${Math.round(t.on_time_rate)}% on time · `}
                      {t.completed} done
                    </div>
                  </div>
                  <div className="text-right">
                    <strong className="tabular-nums">{t.score}</strong>
                    {t.score_delta !== null && (
                      <span className={cn('ml-1 text-xs', t.score_delta > 0 ? 'text-success' : t.score_delta < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {t.score_delta > 0 ? '▲' : t.score_delta < 0 ? '▼' : ''}
                        {Math.abs(t.score_delta)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-7"
          title={
            <>
              Needs attention {team.attention.length > 0 && <Chip tone="warning">{team.attention.length}</Chip>}
            </>
          }
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/tasks/team">Team Performance →</Link>
            </Button>
          }
        >
          {team.attention.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-6 text-sm text-muted-foreground">
              <ThumbsUp className="size-5" />
              Everyone is active and on track.
            </div>
          ) : (
            <ul className="grid gap-3">
              {team.attention.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <Avatar name={a.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {a.name} <span className="text-xs font-normal text-muted-foreground">· {a.role}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.reasons.map((r) => (
                        <Chip key={r} tone="warning">
                          {r}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
              {team.attention.length > 8 && <li className="text-xs text-muted-foreground">+{team.attention.length - 8} more on Team Performance</li>}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

// ─── notices ─────────────────────────────────────────────────────────────
export function NoticesCard({ className }: { className?: string }) {
  const rows = useNotices().data;
  if (!rows || rows.length === 0) return null; // nothing live: no empty card
  const unread = rows.filter((n) => n.read === false).length;
  return (
    <Panel
      className={className}
      title={
        <>
          <Megaphone className="size-4 text-primary" /> Notices {unread > 0 && <Chip tone="warning">{unread} new</Chip>}
        </>
      }
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/tasks/notices">All notices →</Link>
        </Button>
      }
    >
      <ul className="grid gap-2">
        {rows.slice(0, 3).map((n) => (
          <li key={n.id}>
            <Link
              to="/tasks/notices"
              className={cn(
                'block rounded-lg border px-3 py-2 transition hover:border-primary/40',
                n.read === false && 'border-primary/30 bg-primary/5',
                n.priority === 'urgent' && 'border-l-4 border-l-destructive',
                n.priority === 'important' && 'border-l-4 border-l-warning',
              )}
            >
              <div className="flex items-center gap-2">
                {n.read === false && <span className="size-2 rounded-full bg-primary" />}
                <strong className="text-sm">{n.title}</strong>
                {n.priority !== 'normal' && <Chip tone={n.priority === 'urgent' ? 'danger' : 'warning'}>{n.priority_display}</Chip>}
              </div>
              {n.content && (
                <div className="mt-1 text-sm text-muted-foreground">
                  <Linkify text={n.content.length > 220 ? `${n.content.slice(0, 220)}…` : n.content} />
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">
                {n.author_detail?.name || 'Admin'} · {new Date(n.publish_at || n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
