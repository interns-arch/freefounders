import { errorMessage, useAccess } from '@freefounders/core';
import {
  type DelegatedSummary,
  type PersonOption,
  type WorkTask,
  errorData,
  useDelegatedSummary,
  useSetTaskStatus,
  useTaskAssignees,
  useTaskPeople,
  useToggleTaskFollow,
  useWorkTaskList,
} from '@freefounders/core/tasks';
import { AlarmClock, Plus, Repeat, Search, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RangePicker } from '@/features/tasks/shared';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { useTaskDialogs } from './dialogs';
import { Segmented, ToggleChip } from './task-bits';
import { TaskRow } from './task-row';

type ListScope = 'my' | 'all' | 'delegated' | 'subscribed';
type PersonRow = PersonOption & { role_display?: string; department_display?: string };

/** ?status= in the address → the API's status list. */
const STATUS_API: Record<string, string> = { open: 'open,in_progress', in_progress: 'in_progress', done: 'done', all: '' };

const EMPTY: Record<ListScope, string> = {
  my: 'No tasks assigned to you here.',
  all: 'No tasks match these filters.',
  delegated: 'No tasks you delegated to others here.',
  subscribed: 'You are not following any tasks. Use Follow on a task to follow it.',
};

/**
 * My Tasks / All Tasks / Delegated / Subscribed. Every filter lives in the address (?status=open|in_progress|done|all,
 * &overdue=1, &done=on_time|late, &recurring=1, and for All Tasks &range= &person= &dept= &q=), so links from the
 * dashboard tiles, Home and WhatsApp land on exactly this view.
 */
export function TaskListTab({
  scope,
  href,
  onAdd,
  onProfile,
}: {
  scope: ListScope;
  href: (id: number) => string;
  onAdd: () => void;
  onProfile: (id: number, name: string) => void;
}) {
  const access = useAccess();
  const me = access.tasks.me?.id;
  const isAdmin = access.tasks.can('tasks.view_all');
  const { values, set } = useUrlFilters({ status: 'open' });
  const status = STATUS_API[values.status] !== undefined ? values.status : 'open';
  const overdue = values.overdue === '1';
  const recurring = values.recurring === '1';
  const fDone = status === 'done' ? (values.done ?? '') : '';
  const range = values.range ?? 'all';
  const custom = { start: values.start ?? '', end: values.end ?? '' };
  const person = values.person ?? '';
  const dept = values.dept ?? '';
  const [search, setSearch] = useSearchBox(values.q ?? '', (q) => set({ q }), 300);

  const people = (useTaskPeople().data ?? []) as PersonRow[];
  const team = useTaskAssignees().data ?? [];
  const summary = useDelegatedSummary(scope === 'delegated');

  const customReady = range !== 'custom' || (!!custom.start && !!custom.end);
  const list = useWorkTaskList(
    {
      scope,
      status: STATUS_API[status],
      overdue,
      done: fDone || undefined,
      recurring,
      ...(scope === 'all' && range !== 'all' ? { range, ...(range === 'custom' ? custom : {}) } : {}),
      ...(scope === 'all' || scope === 'delegated' ? { assigned_to: person || undefined } : {}),
      ...(scope === 'all' ? { department: dept || undefined, search: values.q || undefined } : {}),
    },
    { enabled: customReady },
  );
  const rows = list.data?.rows ?? [];

  // Delegated: I can hand work to anyone, so the filter lists everyone I can assign to.
  const filterPeople = useMemo<PersonRow[]>(() => {
    if (scope !== 'delegated') return people;
    const byId = new Map<number, PersonRow>(people.map((p) => [p.id, p]));
    team.forEach((t) => {
      if (!byId.has(t.id)) byId.set(t.id, { ...t, department_display: t.department_name });
    });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scope, people, team]);
  const deptOptions = useMemo(() => {
    const seen = new Map<string, string>();
    filterPeople.forEach((p) => p.department && seen.set(p.department, p.department_display || p.department_name || p.department));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filterPeople]);
  const shownPeople = dept ? filterPeople.filter((p) => p.department === dept) : filterPeople;

  const counts = useMemo(
    () => ({
      total: rows.length,
      overdue: rows.filter((t) => t.is_overdue && t.status !== 'done').length,
      pending: rows.filter((t) => t.status === 'open').length,
      in_progress: rows.filter((t) => t.status === 'in_progress').length,
      done: rows.filter((t) => t.status === 'done').length,
    }),
    [rows],
  );

  const dialogs = useTaskDialogs();
  const setTaskStatus = useSetTaskStatus();
  const follow = useToggleTaskFollow();

  const setStatus = (t: WorkTask, next: 'open' | 'in_progress' | 'done') => {
    if (next === 'done') return dialogs.open({ kind: 'complete', task: t }); // completing always collects remarks + effort
    if (next === 'in_progress') return dialogs.open({ kind: 'progress', task: t }); // In progress opens the status update
    setTaskStatus.mutate(
      { id: t.id, status: next },
      {
        onError: (err) => {
          if (errorData(err).needs) dialogs.open({ kind: 'complete', task: t });
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  const pickAgent = (id: number | string, kind: string) => {
    set({
      person: id ? String(id) : null,
      overdue: kind === 'overdue' ? '1' : null,
      done: kind === 'on_time' || kind === 'late' ? kind : null,
      status: kind === 'open' || kind === 'overdue' ? 'open' : kind === 'on_time' || kind === 'late' ? 'done' : 'all',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Status"
          value={status === 'in_progress' ? 'open' : status}
          onChange={(v) => set({ status: v, done: null })}
          options={[
            ['open', 'Open'],
            ['done', 'Done'],
            ['all', 'All'],
          ]}
        />
        <ToggleChip on={overdue} onChange={(v) => set({ overdue: v ? '1' : null })}>
          <AlarmClock /> Overdue only
        </ToggleChip>
        <ToggleChip on={recurring} onChange={(v) => set({ recurring: v ? '1' : null })} title="Only the tasks that repeat — daily, weekly or monthly">
          <Repeat /> Recurring only
        </ToggleChip>
        {status === 'in_progress' && <span className="text-xs text-muted-foreground">Showing in progress only</span>}
        {fDone && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {fDone === 'on_time' ? 'Finished on time' : 'Finished late'}
            <Button variant="ghost" size="icon-xs" aria-label="Clear finished filter" onClick={() => set({ done: null })}>
              <X />
            </Button>
          </span>
        )}
        <span className="flex-1" />
        {scope !== 'all' && (
          <Button onClick={onAdd}>
            <Plus /> Add task
          </Button>
        )}
      </div>

      {scope === 'all' && (
        <div className="space-y-3">
          <RangePicker
            range={range}
            setRange={(v) => set({ range: v === 'all' ? null : v })}
            custom={custom}
            setCustom={(c) => set({ start: c.start, end: c.end })}
            applied={list.data?.range_from ? { from: list.data.range_from, to: list.data.range_to } : null}
            countedBy={status === 'done' ? 'completion date' : status === 'all' ? 'completion date (done) or due date (open)' : 'due date'}
          />
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Department" className="w-auto min-w-40" value={dept} onChange={(e) => set({ dept: e.target.value, person: null })}>
              <option value="">All departments</option>
              {deptOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Person" className="w-auto min-w-44" value={person} onChange={(e) => set({ person: e.target.value })}>
              <option value="">{dept ? 'Everyone in this department' : 'All people'}</option>
              {shownPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role_display ? ` — ${p.role_display}` : ''}
                </option>
              ))}
            </NativeSelect>
            <div className="relative min-w-52 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" aria-label="Search tasks" placeholder="Search task, code or person…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            {(person || dept || values.q) && (
              <Button variant="ghost" size="sm" onClick={() => (setSearch(''), set({ person: null, dept: null, q: null }))}>
                Clear
              </Button>
            )}
            {person && (
              <Button variant="outline" size="sm" title="Open this person's full profile" onClick={() => onProfile(Number(person), filterPeople.find((p) => String(p.id) === person)?.name ?? '')}>
                <UserRound /> Profile
              </Button>
            )}
          </div>
        </div>
      )}

      {scope === 'delegated' && summary.data && <DelegatedAgents data={summary.data} person={person} status={status} fDone={fDone} overdue={overdue} onPick={pickAgent} />}

      {scope === 'all' && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{counts.total}</strong> tasks · {counts.pending} pending · {counts.in_progress} in progress · {counts.done} completed ·{' '}
          <span className={cn(counts.overdue > 0 && 'font-medium text-destructive')}>{counts.overdue} overdue</span>
        </p>
      )}

      <Card className="overflow-hidden">
        {list.isLoading || !customReady ? (
          customReady ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : (
            <EmptyState title="Pick both dates" description="Choose a from and a to date for the custom range." />
          )
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={EMPTY[scope]} />
        ) : (
          <ul className="divide-y" aria-label="Tasks">
            {rows.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                me={me}
                isAdmin={isAdmin}
                scope={scope}
                actions={{
                  href,
                  setStatus,
                  estimate: (task) => dialogs.open({ kind: 'estimate', task }),
                  request: (task) => dialogs.open({ kind: 'request', task }),
                  update: (task) => dialogs.open({ kind: 'progress', task }),
                  follow: (task) => follow.mutate({ id: task.id, follow: !task.subscribed }, { onError: (e) => toast.error(errorMessage(e)) }),
                  profile: onProfile,
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {dialogs.element}
    </div>
  );
}

/** Delegated: everyone I gave tasks to, with open / overdue / on time / late. A number narrows the list below. */
function DelegatedAgents({
  data,
  person,
  status,
  fDone,
  overdue,
  onPick,
}: {
  data: DelegatedSummary;
  person: string;
  status: string;
  fDone: string;
  overdue: boolean;
  onPick: (id: number | string, kind: string) => void;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const agents = data.agents.filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()));
  const shown = all || q ? agents : agents.slice(0, 8);
  const picked = data.agents.find((a) => String(a.id) === person);
  const kind = overdue ? 'overdue' : fDone ? fDone : status === 'open' ? 'open' : status === 'done' ? 'done' : 'all';
  const KIND: Record<string, string> = { all: 'all tasks', open: 'open tasks', overdue: 'overdue tasks', done: 'completed tasks', on_time: 'completed on time', late: 'completed late (after due date)' };
  if (data.agents.length === 0) return null;

  const Num = ({ a, k, v, tone }: { a: DelegatedSummary['agents'][number]; k: string; v: number; tone?: string }) => (
    <button
      type="button"
      disabled={v === 0}
      aria-label={`${a.name}: ${v} ${KIND[k === 'on_time' ? 'on_time' : k] ?? k}`}
      onClick={() => onPick(a.id, k)}
      className={cn(
        'min-w-8 cursor-pointer rounded-md px-2 py-0.5 font-medium tabular transition hover:bg-accent disabled:cursor-default disabled:text-muted-foreground/50 disabled:hover:bg-transparent',
        v > 0 && tone,
        String(a.id) === person && kind === k && 'bg-primary/10 ring-1 ring-primary/30',
      )}
    >
      {v}
    </button>
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          Agents I&apos;ve delegated to <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{data.agents.length}</span>
        </h3>
        <span className="flex-1" />
        <NativeSelect aria-label="Filter by agent" className="h-8 w-auto text-[13px]" value={person} onChange={(e) => onPick(e.target.value, 'all')}>
          <option value="">All agents</option>
          {data.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.open} open)
            </option>
          ))}
        </NativeSelect>
        <Input type="search" aria-label="Search agent" placeholder="Search agent…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-40" />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          <strong>{data.totals.open}</strong> open
        </span>
        <span className="text-destructive">
          <strong>{data.totals.overdue}</strong> overdue
        </span>
        <span className="text-success">
          <strong>{data.totals.done_on_time}</strong> done on time
        </span>
        <span className="text-warning">
          <strong>{data.totals.done_late}</strong> done late
        </span>
        <span className="text-muted-foreground">{data.totals.total} given in all</span>
      </p>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Agent</TH>
              <TH className="text-right">Open</TH>
              <TH className="text-right">Overdue</TH>
              <TH className="text-right">Done on time</TH>
              <TH className="text-right">Done late</TH>
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((a) => (
              <TR key={a.id} className={cn(String(a.id) === person && 'bg-primary/5')}>
                <TD>
                  <button type="button" className="cursor-pointer font-medium hover:text-primary hover:underline" onClick={() => onPick(a.id, 'all')}>
                    {a.name}
                  </button>
                  {!a.active && <span className="text-xs text-muted-foreground"> (inactive)</span>}
                  <div className="text-xs text-muted-foreground">{a.role}</div>
                </TD>
                <TD className="text-right">
                  <Num a={a} k="open" v={a.open} />
                </TD>
                <TD className="text-right">
                  <Num a={a} k="overdue" v={a.overdue} tone="text-destructive" />
                </TD>
                <TD className="text-right">
                  <Num a={a} k="on_time" v={a.done_on_time} tone="text-success" />
                </TD>
                <TD className="text-right">
                  <Num a={a} k="late" v={a.done_late} tone="text-warning" />
                </TD>
                <TD className="text-right">
                  <Num a={a} k="all" v={a.total} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {!q && agents.length > 8 && (
        <Button variant="link" size="sm" className="mt-1 px-0" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${agents.length} agents`}
        </Button>
      )}
      {picked && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          Showing <strong>{picked.name}</strong> — {KIND[kind]}
          <Button variant="outline" size="xs" onClick={() => onPick('', 'open')}>
            <X /> Clear
          </Button>
        </div>
      )}
    </Card>
  );
}
