/**
 * Tasks given and received — day / week / month / overall, plain counts (old Delegation.jsx).
 * Admins see everyone (dashboard and Team Performance); everybody else sees their own numbers.
 */
import { DELEGATION_WINDOWS, type DelegationReport, type DelegationWindow, useDelegationReport, usePersonDelegation } from '@freefounders/core/tasks';
import { errorMessage } from '@freefounders/core';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, Panel, Segmented, fmtDay, todayLocal } from './parts';

type Side = 'given' | 'received';

function span(data: Pick<DelegationReport, 'date' | 'week' | 'month'>, win: DelegationWindow) {
  if (win === 'day') return fmtDay(data.date);
  if (win === 'week') return `${fmtDay(data.week[0])} – ${fmtDay(data.week[1])}`;
  if (win === 'month') return new Date(`${data.month[0]}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return 'all time';
}

function DateBox({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  return <Input type="date" aria-label="Day" className="h-8 w-auto" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} />;
}

/** Everyone's numbers (admins). Renders nothing for people who only get their own numbers. */
export function DelegationCard({ department = '', className }: { department?: string; className?: string }) {
  const [date, setDate] = useState(todayLocal());
  const [win, setWin] = useState<DelegationWindow>('month');
  const [sortBy, setSortBy] = useState<Side>('given');
  const [open, setOpen] = useState<number | null>(null);
  const q = useDelegationReport(date, department);
  const data = q.data;

  const rows = useMemo(
    () => (data ? [...data.people].sort((a, b) => b[sortBy][win] - a[sortBy][win] || a.name.localeCompare(b.name)) : []),
    [data, win, sortBy],
  );

  if (q.error) return <Panel title="Tasks given & received" className={className}><ErrorNote>{errorMessage(q.error)}</ErrorNote></Panel>;
  if (!data) return <Skeleton className={cn('h-48', className)} />;
  if (!data.everyone) return null;

  const max = { given: Math.max(1, ...data.people.map((p) => p.given[win])), received: Math.max(1, ...data.people.map((p) => p.received[win])) };

  return (
    <Panel
      className={className}
      title="Tasks given & received"
      actions={
        <>
          <DateBox date={date} setDate={setDate} />
          <Segmented label="Period" value={win} onChange={setWin} options={DELEGATION_WINDOWS} />
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted-foreground">
        Showing <strong className="text-foreground">{span(data, win)}</strong> · {data.totals[win].given} tasks given to others
        {data.totals[win].self > 0 && <>, {data.totals[win].self} self-assigned</>}
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Sort by
        <Segmented label="Sort by" value={sortBy} onChange={setSortBy} options={[['given', 'Tasks given'], ['received', 'Tasks received']]} />
      </div>

      <div className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH rowSpan={2}>Person</TH>
              <TH colSpan={4} className="text-center">Tasks given</TH>
              <TH colSpan={4} className="text-center">Tasks received</TH>
              <TH rowSpan={2} className="text-right">Self</TH>
            </TR>
            <TR>
              {(['given', 'received'] as Side[]).map((k) =>
                DELEGATION_WINDOWS.map(([w, l]) => (
                  <TH key={k + w} className={cn('text-right', w === win && 'text-foreground')}>
                    {l}
                  </TH>
                )),
              )}
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(p.id)}>
                <TD>
                  <button type="button" className="flex cursor-pointer items-center gap-2 text-left" title={`See who ${p.name} gives tasks to, and who gives tasks to ${p.name}`}>
                    <Avatar name={p.name} className="size-7" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{p.role}</span>
                    </span>
                  </button>
                </TD>
                {(['given', 'received'] as Side[]).map((k) =>
                  DELEGATION_WINDOWS.map(([w]) => (
                    <TD key={k + w} className={cn('text-right tabular-nums', p[k][w] === 0 && 'text-muted-foreground', w === win && 'font-semibold')}>
                      {w === win ? (
                        <span className="inline-flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted lg:inline-block">
                            <span className={cn('block h-full rounded-full', k === 'given' ? 'bg-primary' : 'bg-info')} style={{ width: `${(p[k][w] / max[k]) * 100}%` }} />
                          </span>
                          {p[k][w]}
                        </span>
                      ) : (
                        p[k][w]
                      )}
                    </TD>
                  )),
                )}
                <TD className="text-right tabular-nums">{p.self[win]}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* phone: one card per person */}
      <div className="grid gap-2 md:hidden">
        {rows.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="cursor-pointer rounded-lg border p-3 text-left">
            <span className="flex items-center gap-2">
              <Avatar name={p.name} className="size-7" />
              <span className="font-medium">{p.name}</span>
            </span>
            <span className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
              <span>
                Given<strong className="block text-base text-foreground">{p.given[win]}</strong>
              </span>
              <span>
                Received<strong className="block text-base text-foreground">{p.received[win]}</strong>
              </span>
              <span>
                Overall<strong className="block text-base text-foreground">{p.given.all} / {p.received.all}</strong>
              </span>
            </span>
          </button>
        ))}
      </div>

      {data.pairs.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Who gives to whom most — this month</p>
          <div className="flex flex-wrap gap-1.5">
            {data.pairs.map((x, i) => (
              <Chip key={i} tone="neutral">
                <strong className="text-foreground">{x.from}</strong> → {x.to} <b className="text-foreground">{x.count}</b>
              </Chip>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Click a person to see who they give tasks to and who gives tasks to them. Counted on the day a task was given. Self-assigned tasks are shown apart;
        automatic repeats of recurring tasks and form-created tasks are not counted.
      </p>
      <PersonBreakdown userId={open} date={date} startWin={win} onClose={() => setOpen(null)} />
    </Panel>
  );
}

/** Just my own numbers (everyone who is not an admin). */
export function MyDelegationCard({ className }: { className?: string }) {
  const [date, setDate] = useState(todayLocal());
  const [open, setOpen] = useState(false);
  const q = useDelegationReport(date, '');
  const me = q.data?.people?.[0];
  return (
    <Panel
      className={className}
      title="My tasks given & received"
      actions={
        <>
          {me && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Who? →
            </Button>
          )}
          <DateBox date={date} setDate={setDate} />
        </>
      }
    >
      {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
      {!me && !q.error && <Skeleton className="h-20" />}
      {me && q.data && (
        <div className="grid gap-3">
          {(
            [
              ['given', 'Given to others'],
              ['received', 'Received from others'],
            ] as Array<[Side, string]>
          ).map(([k, label]) => (
            <div key={k} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-5">
              <div className="col-span-2 text-sm font-medium sm:col-span-1">{label}</div>
              {DELEGATION_WINDOWS.map(([w, l]) => (
                <div key={w} className={cn('rounded-lg border px-3 py-2 text-center', k === 'given' ? 'bg-primary/5' : 'bg-info/5')}>
                  <strong className="block text-lg tabular-nums">{me[k][w]}</strong>
                  <span className="text-xs text-muted-foreground">{w === 'day' ? fmtDay(q.data!.date) : l}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <PersonBreakdown userId={open && me ? me.id : null} date={date} startWin="month" onClose={() => setOpen(false)} />
    </Panel>
  );
}

/** Who this person gives tasks to, and who gives tasks to them. */
function PersonBreakdown({ userId, date, startWin, onClose }: { userId: number | null; date: string; startWin: DelegationWindow; onClose: () => void }) {
  const [win, setWin] = useState<DelegationWindow>(startWin);
  const q = usePersonDelegation(userId, date);
  const data = userId != null ? q.data : undefined;

  const list = (rows: NonNullable<typeof data>['gave_to'], kind: Side) => {
    const shown = rows.filter((r) => r[win] > 0).sort((a, b) => b[win] - a[win] || a.name.localeCompare(b.name));
    const total = shown.reduce((n, r) => n + r[win], 0);
    const max = Math.max(1, ...shown.map((r) => r[win]));
    return (
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          {kind === 'given' ? 'Gave tasks to' : 'Received tasks from'}
          <Chip tone={kind === 'given' ? 'primary' : 'info'}>{total}</Chip>
        </div>
        {shown.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nobody in this period.</p>}
        <ol className="grid gap-2">
          {shown.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
              <Avatar name={r.name} className="size-7" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {r.name}
                  {!r.active && <span className="text-xs text-muted-foreground"> (inactive)</span>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', kind === 'given' ? 'bg-primary' : 'bg-info')} style={{ width: `${(r[win] / max) * 100}%` }} />
                </div>
              </div>
              <strong className="tabular-nums">{r[win]}</strong>
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <Dialog open={userId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data ? `${data.person.name}: tasks given & received` : 'Tasks given & received'}</DialogTitle>
          <DialogDescription>Who they delegate to and who delegates to them.</DialogDescription>
        </DialogHeader>
        {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
        {!data && !q.error && <Skeleton className="h-40" />}
        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{data.person.role}</span>
              <div className="flex items-center gap-2">
                <Segmented label="Period" value={win} onChange={setWin} options={DELEGATION_WINDOWS} />
                <span className="text-xs text-muted-foreground">{span(data, win)}</span>
              </div>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {list(data.gave_to, 'given')}
              {list(data.received_from, 'received')}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
