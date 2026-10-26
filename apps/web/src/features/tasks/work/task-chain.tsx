/**
 * Sub-tasks and the Task chain (original app 1dabd35; PLAN.md §19.41).
 * Whoever holds a task gives parts of it to other people; they can pass parts of their part on (5 levels). Each part's
 * completion goes to whoever gave it, and the task above can't be completed until every part is done and accepted.
 * Admins and the Owner see the whole chain (tree) and every chain (Tasks → Chains).
 */
import { errorMessage, useAccess } from '@kaampilot/core';
import {
  type ChainNode,
  type ChainResult,
  type ChainStatusFilter,
  type ChainTreeNode,
  type TaskDetail,
  partError,
  useGiveParts,
  usePartAssignees,
  useTaskChain,
  useTaskChains,
} from '@kaampilot/core/tasks';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { EmptyState, ErrorState } from '@/components/common/page';
import { CornerLeftUp, Hourglass, Network, Plus, UserPlus, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { fmtDT, fmtEffort, toLocalInput, toMinutes } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { EffortInput, type EffortUnit } from './effort-input';
import { MiniStat, SectionHead, Segmented, TaskCode } from './task-bits';

const PILL = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-bold';
const RESULT_TONE: Record<string, string> = {
  'On time': 'bg-success/10 text-success',
  Delayed: 'bg-warning/12 text-warning',
  Overdue: 'bg-destructive/10 text-destructive',
  'In progress': 'bg-info/10 text-info',
  Pending: 'bg-muted text-muted-foreground',
};

/** On time / Delayed / Overdue / In progress / Pending as a tinted label (the word carries the meaning). */
export function ResultLabel({ result, className }: { result: ChainResult | string; className?: string }) {
  return <span className={cn(PILL, RESULT_TONE[result] ?? 'bg-muted text-muted-foreground', className)}>{result}</span>;
}

const taskHref = (id: number) => `/tasks/tasks/${id}`;

/** "Sub-task of T-00659 … held by Prateek" under a part's title, so the person knows who accepts it. */
export function PartOfNote({ t }: { t: TaskDetail }) {
  const p = t.chain?.parent;
  if (!p) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px]" data-testid="part-of-note">
      <CornerLeftUp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        Sub-task of{' '}
        <Link to={taskHref(p.id)} className="font-semibold text-primary hover:underline">
          {p.code}
        </Link>{' '}
        {p.title} — held by <strong>{p.assignee}</strong>
        {p.due_at && <>, due {fmtDT(p.due_at)}</>}.
        {t.chain.root && t.chain.root.id !== p.id && (
          <>
            {' '}
            Main task:{' '}
            <Link to={taskHref(t.chain.root.id)} className="font-semibold text-primary hover:underline">
              {t.chain.root.code}
            </Link>
            .
          </>
        )}
        <span className="text-muted-foreground"> When you complete this, {p.assignee} accepts it.</span>
      </span>
    </p>
  );
}

/** The "Sub-tasks" block of a task's panel: its parts, "Give a part to someone" and (admins) "Task chain". */
export function SubtasksSection({ t }: { t: TaskDetail }) {
  const c = t.chain;
  const parts = t.subtasks ?? [];
  const [giving, setGiving] = useState(false);
  const [viewing, setViewing] = useState(false);
  if (!c || (!parts.length && !c.can_give_part && !c.can_view_chain)) return null;
  return (
    <section className="space-y-3" aria-label="Sub-tasks">
      <SectionHead title="Sub-tasks" count={parts.length ? `${c.parts_done}/${c.parts_total} done` : undefined} />
      {(c.can_give_part || c.can_view_chain) && (
        <div className="flex flex-wrap gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
          {c.can_give_part && (
            <Button variant="outline" size="sm" onClick={() => setGiving(true)} title="Give a piece of this task to someone else — their completion comes to you">
              <UserPlus /> Give a part to someone
            </Button>
          )}
          {c.can_view_chain && (
            <Button variant="outline" size="sm" onClick={() => setViewing(true)} title="Who gave what to whom, and how each part went">
              <Network /> Task chain
            </Button>
          )}
        </div>
      )}
      {c.blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] text-warning" role="status">
          <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span>{c.blocked}</span>
        </p>
      )}
      {parts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Need help from others on this? Give them a part — each person is scored on their own part and sends it back to you to accept.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {parts.map((p) => (
            <PartRow key={p.id} p={p} />
          ))}
        </ul>
      )}
      {giving && <GivePartsDialog task={t} onClose={() => setGiving(false)} />}
      {viewing && <ChainDialog taskId={t.id} onClose={() => setViewing(false)} />}
    </section>
  );
}

function PartRow({ p }: { p: ChainNode }) {
  return (
    <li className="space-y-0.5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ResultLabel result={p.result} />
        <Link to={taskHref(p.id)} className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:text-primary hover:underline">
          <TaskCode code={p.code} /> <span className="min-w-0 break-words">{p.title}</span>
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        {p.assignee} · due {fmtDT(p.due_at) ?? '—'}
        {p.effort_minutes ? <> · {fmtEffort(p.effort_minutes)}</> : null}
        {p.approval && <> · {p.approval === 'Pending' ? 'waiting for you to accept' : p.approval.toLowerCase()}</>}
        {!!p.parts_below && (
          <>
            {' '}
            · split into {p.parts_below} more part{p.parts_below === 1 ? '' : 's'}
          </>
        )}
      </p>
    </li>
  );
}

// ─── Give parts ─────────────────────────────────────────────────────────────

interface Row {
  person: string;
  title: string;
  due: string;
  effort: string;
  unit: EffortUnit;
  description: string;
  error?: string;
}
const blankRow = (due: string): Row => ({ person: '', title: '', due, effort: '', unit: 'minutes', description: '' });

export function GivePartsDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const c = task.chain;
  const maxDue = task.due_at ? toLocalInput(task.due_at) : '';
  const people = usePartAssignees(task.id);
  const give = useGiveParts();
  const [rows, setRows] = useState<Row[]>([blankRow(maxDue)]);
  const [note, setNote] = useState('');
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch, error: undefined } : row)));
  const minutes = rows.map((r) => toMinutes(r.effort, r.unit) ?? 0);
  const total = minutes.reduce((s, m) => s + m, 0);
  const over = c.effort_left !== null && total > c.effort_left;
  const ready = rows.every((r, i) => r.person && r.title.trim() && r.due && minutes[i] > 0);

  const submit = () => {
    if (!ready || over || give.isPending) return;
    setNote('');
    give.mutate(
      {
        parent: { id: task.id, department: task.department, category: task.category, priority: task.priority },
        parts: rows.map((r, i) => ({
          assigned_to: Number(r.person),
          title: r.title.trim(),
          description: r.description.trim(),
          due_at: r.due ? new Date(r.due).toISOString() : null,
          effort_minutes: minutes[i] || null,
        })),
      },
      {
        onSuccess: (res) => {
          if (!res.failed.length) {
            toast.success(`${res.given} part${res.given === 1 ? '' : 's'} given`);
            onClose();
            return;
          }
          // keep only the rows that did not go through, each with its reason
          setRows(res.failed.map((f) => ({ ...rows[f.index], error: partError(f.error) })));
          setNote(res.given ? `${res.given} part${res.given === 1 ? '' : 's'} given. Fix the rest below.` : '');
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader className="-mx-5 -mt-5 border-b bg-muted/40 px-5 pt-5 pb-4">
            <DialogTitle>Give parts of {task.code}</DialogTitle>
            <DialogDescription>
              {task.title}. Each person gets their part as a task of their own. When they complete it, it comes to <strong>you</strong> to accept, and you complete {task.code} once every part is
              accepted. They can pass parts of their part on too.
            </DialogDescription>
          </DialogHeader>
          {c.effort_left !== null && (
            <p className={cn('text-sm', over ? 'font-semibold text-destructive' : 'text-muted-foreground')} role={over ? 'alert' : undefined}>
              Effort left to give: <strong className="font-mono tabular">{fmtEffort(c.effort_left) || '0m'}</strong> of {fmtEffort(task.effort_minutes)}
              {total > 0 && <> · giving {fmtEffort(total)} now</>}. What you give is earned by them; you keep the rest.
            </p>
          )}
          {rows.map((r, i) => (
            <fieldset key={i} className="grid gap-3 rounded-lg border p-3" aria-label={`Part ${i + 1}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Give to" required>
                  <NativeSelect value={r.person} onChange={(e) => set(i, { person: e.target.value })} aria-label={`Part ${i + 1}: give to`}>
                    <option value="">{people.isLoading ? 'Loading people…' : '— pick a person —'}</option>
                    {(people.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.department_name ? ` · ${p.department_name}` : ''}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Due by" required hint={task.due_at ? `No later than ${fmtDT(task.due_at)}` : undefined}>
                  <Input type="datetime-local" value={r.due} max={maxDue || undefined} onChange={(e) => set(i, { due: e.target.value })} aria-label={`Part ${i + 1}: due by`} />
                </Field>
              </div>
              <Field label="What should they do?" required>
                <Input value={r.title} maxLength={200} placeholder="e.g. Get 3 supplier quotes for brake pads" onChange={(e) => set(i, { title: e.target.value })} aria-label={`Part ${i + 1}: what should they do`} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <EffortInput label="Effort" required value={r.effort} onChange={(v) => set(i, { effort: v })} unit={r.unit} onUnit={(u) => set(i, { unit: u })} placeholder={r.unit === 'hours' ? 'e.g. 1.5' : 'e.g. 60'} />
                <Field label="Details (optional)">
                  <Textarea rows={2} value={r.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Part ${i + 1}: details`} />
                </Field>
              </div>
              {r.error && (
                <p className="text-sm text-destructive" role="alert">
                  {r.error}
                </p>
              )}
              {rows.length > 1 && (
                <Button type="button" variant="ghost" size="sm" className="justify-self-start text-muted-foreground" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <X /> Remove this part
                </Button>
              )}
            </fieldset>
          ))}
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setRows((rs) => [...rs, blankRow(maxDue)])}>
            <Plus /> Another person
          </Button>
          {note && <p className="text-sm text-warning">{note}</p>}
          <DialogFooter className="-mx-5 -mb-5 border-t bg-muted/30 px-5 py-3.5">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={give.isPending} disabled={!ready || over}>
              {give.isPending ? 'Giving…' : `Give ${rows.length} part${rows.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── the whole chain ───────────────────────────────────────────────────────

function TreeNode({ n, focus }: { n: ChainTreeNode; focus: number }) {
  return (
    <>
      <li
        className={cn('rounded-md py-2 pr-2 text-sm', n.level > 0 && 'border-l-2 border-border', n.id === focus && 'bg-primary/8')}
        // indent by level; small on phones so 5 levels still fit at 320 px
        style={{ marginLeft: `${Math.min(n.level, 5) * 0.75}rem`, paddingLeft: n.level ? '0.6rem' : '0.25rem' }}
        data-testid="chain-node"
        data-level={n.level}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={taskHref(n.id)} className="inline-flex min-w-0 items-center gap-1.5 font-semibold hover:text-primary hover:underline">
            <TaskCode code={n.code} /> <span className="min-w-0 break-words">{n.title}</span>
          </Link>
          <ResultLabel result={n.result} className="ml-auto" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">{n.assignee}</strong>
          {n.given_by && <> · given by {n.given_by}</>} · due {fmtDT(n.due_at) ?? '—'}
          {n.completed_at && <> · done {fmtDT(n.completed_at)}</>}
          {n.days_late ? (
            <>
              {' '}
              · {n.days_late} day{n.days_late === 1 ? '' : 's'} late
            </>
          ) : null}
          {n.own_effort_minutes !== null && (
            <>
              {' '}
              · {fmtEffort(n.own_effort_minutes) || '0m'}
              {n.parts.length > 0 && n.effort_minutes !== n.own_effort_minutes && <> kept of {fmtEffort(n.effort_minutes)}</>}
            </>
          )}
          {n.approval && <> · approval: {n.approval.toLowerCase()}</>}
        </p>
      </li>
      {n.parts.map((p) => (
        <TreeNode key={p.id} n={p} focus={focus} />
      ))}
    </>
  );
}

/** Admins / Owner: the whole chain a task belongs to, main task at the top. */
export function ChainDialog({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const q = useTaskChain(taskId);
  const d = q.data;
  const s = d?.summary;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="size-5 text-primary" aria-hidden /> Task chain{d && ` — ${d.tree.code}`}
          </DialogTitle>
          <DialogDescription>Who gave what to whom, and how each part went. Each person is scored only on their own part.</DialogDescription>
        </DialogHeader>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d || !s ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <MiniStat label="People" value={s.people} />
              <MiniStat label="Sub-tasks" value={s.parts} />
              <MiniStat label="Done" value={s.done} tone="good" />
              <MiniStat label="On time" value={s.on_time} />
              <MiniStat label="Delayed" value={s.delayed} tone={s.delayed ? 'bad' : undefined} />
              <MiniStat label="Overdue" value={s.overdue} tone={s.overdue ? 'bad' : undefined} />
            </div>
            <ul className="space-y-1" aria-label="Chain">
              <TreeNode n={d.tree} focus={d.focus} />
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tasks → Chains (admins / Owner) ───────────────────────────────────────

export function ChainsTab() {
  const access = useAccess();
  const [status, setStatus] = useState<ChainStatusFilter>('open');
  const [open, setOpen] = useState<number | null>(null);
  const q = useTaskChains(status);
  const rows = q.data?.rows ?? [];
  if (!access.tasks.can('tasks.view_all')) return null;
  const pct = (done: number, all: number) => (all ? Math.round((100 * done) / all) : 0);
  const sheet = () => ({
    title: 'Task chains',
    header: ['Main task', 'Title', 'Held by', 'Given by', 'Sub-tasks', 'Done', 'People', 'Levels', 'On time', 'Delayed', 'Overdue', 'Due', 'Result'],
    rows: rows.map((r) => [r.code, r.title, r.assignee, r.given_by, r.parts, r.done, r.people, r.levels, r.on_time, r.delayed, r.overdue, r.due_at ? new Date(r.due_at) : null, r.result]),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Chains"
          value={status}
          onChange={setStatus}
          options={[
            ['open', 'Open'],
            ['done', 'Done'],
            ['all', 'All'],
          ]}
        />
        <span className="text-sm text-muted-foreground">
          {q.data ? `${q.data.total} chain${q.data.total === 1 ? '' : 's'} · ` : ''}tasks split into sub-tasks, overdue first
        </span>
        <DownloadMenu className="ml-auto" rows={sheet} filename={fileSlug('tasks', 'chains', status, todayStamp())} empty={!!q.data && rows.length === 0} loading={!q.data && !q.error} />
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Network} title="No chains here yet." description="One starts when someone uses “Give a part to someone” on a task." />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Main task</TH>
                  <TH>Held by</TH>
                  <TH>Progress</TH>
                  <TH className="text-right">People</TH>
                  <TH className="text-right">Levels</TH>
                  <TH className="text-right">Overdue</TH>
                  <TH>Due</TH>
                  <TH>Result</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(r.id)} title="Open the whole chain">
                    <TD>
                      <button type="button" className="flex min-h-8 cursor-pointer flex-wrap items-center gap-1.5 text-left font-semibold">
                        <TaskCode code={r.code} /> {r.title}
                      </button>
                      {r.given_by && <div className="text-xs text-muted-foreground">given by {r.given_by}</div>}
                    </TD>
                    <TD>{r.assignee}</TD>
                    <TD>
                      <Progress done={r.done} all={r.parts} pct={pct(r.done, r.parts)} />
                    </TD>
                    <TD className="text-right tabular">{r.people}</TD>
                    <TD className="text-right tabular">{r.levels}</TD>
                    <TD className={cn('text-right tabular', r.overdue > 0 && 'font-semibold text-destructive')}>{r.overdue}</TD>
                    <TD className="text-xs whitespace-nowrap">{fmtDT(r.due_at) ?? '—'}</TD>
                    <TD>
                      <ResultLabel result={r.result} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-2 md:hidden" aria-label="Chains">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="w-full space-y-1.5 rounded-xl border bg-card p-3 text-left">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    <TaskCode code={r.code} /> <span className="min-w-0 break-words">{r.title}</span>
                    <ResultLabel result={r.result} className="ml-auto" />
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {r.assignee}
                    {r.given_by && <> · given by {r.given_by}</>} · due {fmtDT(r.due_at) ?? '—'}
                  </span>
                  <Progress done={r.done} all={r.parts} pct={pct(r.done, r.parts)} />
                  <span className={cn('block text-xs', r.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                    {r.people} people · {r.levels} level{r.levels === 1 ? '' : 's'} · {r.overdue} overdue
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {open && <ChainDialog taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Progress({ done, all, pct }: { done: number; all: number; pct: number }) {
  return (
    <span className="flex items-center gap-2 text-xs tabular">
      <span className="h-1.5 w-20 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <span className="block h-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      {done}/{all} done
    </span>
  );
}
