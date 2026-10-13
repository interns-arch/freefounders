import { errorMessage, useAccess } from '@freefounders/core';
import {
  type TaskCompletion,
  type TaskFile,
  useBulkAcceptCompletions,
  useChangeRequests,
  useCompletionReviews,
  useRestoreTask,
  useReviewChangeRequest,
  useReviewCompletion,
  useWorkTaskList,
} from '@freefounders/core/tasks';
import { ArrowUp, CheckCircle2, ClipboardCheck, Clock, Paperclip, RotateCcw, Trash2 } from '@/components/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Badge, Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { ProofreadText, fmtDT, fmtEffort } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { describeChanges } from './dialogs';
import { CountPill, Segmented, TaskCode } from './task-bits';
import { safeHref } from '@/lib/safe-url';

const fail = (e: unknown) => toast.error(errorMessage(e));
const IMAGE = /\.(jpe?g|png|gif|webp|heic|bmp)$/i;

function Loading() {
  return (
    <ul className="divide-y" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="space-y-2 px-4 py-4">
          <Skeleton className="h-4 w-2/3 max-w-sm" />
          <Skeleton className="h-3 w-1/2 max-w-64" />
        </li>
      ))}
    </ul>
  );
}

/** The photos and files sent with the work: photos as thumbnails, the rest as links. */
function ProofFiles({ files }: { files: TaskFile[] }) {
  const images = files.filter((f) => IMAGE.test(f.filename) && f.url);
  const others = files.filter((f) => !IMAGE.test(f.filename) || !f.url);
  return (
    <div className="mt-2 space-y-1.5">
      <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        <Paperclip className="size-3" aria-hidden /> Proof attached <CountPill tone="neutral">{files.length}</CountPill>
      </p>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <a key={f.id} href={safeHref(f.url)} target="_blank" rel="noreferrer" title={f.filename} className="block size-20 overflow-hidden rounded-lg border shadow-xs transition hover:border-primary/50">
              <img src={f.url!} alt={f.filename} loading="lazy" className="size-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((f) => (
            <a key={f.id} href={safeHref(f.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border bg-card px-2 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary">
              <Paperclip className="size-3" aria-hidden /> {f.filename}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── To accept ─────────────────────────────────────────────────────────────

/**
 * Work submitted as done, waiting for the person who gave it to accept. Accepting is one click; sending back needs a
 * reason. In "To accept" rows can be ticked, or narrowed to one person, and accepted in one go (only the rows on screen).
 */
export function ReviewsTab({ href }: { href: (id: number) => string }) {
  const isAdmin = useAccess().tasks.can('tasks.view_all');
  const confirm = useConfirm();
  const [scope, setScope] = useState<'inbox' | 'mine' | 'all'>('inbox');
  const q = useCompletionReviews(scope);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const decide = useReviewCompletion();
  const bulk = useBulkAcceptCompletions();
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [person, setPerson] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const inbox = scope === 'inbox';
  const busy = decide.isPending || bulk.isPending;

  useEffect(() => {
    setPerson('');
    setPicked(new Set());
  }, [scope]);
  // drop ticks on rows that are gone (accepted elsewhere, sent back…)
  useEffect(() => setPicked((prev) => new Set(rows.filter((r) => prev.has(r.id)).map((r) => r.id))), [rows]);

  const people = useMemo(() => {
    const m = new Map<number, { id: number; name: string; n: number }>();
    rows.forEach((r) => {
      const p = r.submitted_by;
      if (!p) return;
      const cur = m.get(p.id) ?? { id: p.id, name: p.name, n: 0 };
      cur.n += 1;
      m.set(p.id, cur);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  useEffect(() => {
    if (person && !people.some((p) => String(p.id) === person)) setPerson('');
  }, [person, people]);
  const shown = useMemo(() => rows.filter((r) => !inbox || !person || String(r.submitted_by?.id) === person), [rows, inbox, person]);
  const pendingShown = shown.filter((r) => r.status === 'pending');
  // The first 50 are drawn, "Load more" adds the next. "Select all shown" ticks the rows drawn; "Accept all (N)" names its count.
  const more = useShowMore(shown, { reset: [scope, person] });
  const pendingDrawn = more.visible.filter((r) => r.status === 'pending');
  const allTicked = pendingDrawn.length > 0 && pendingDrawn.every((r) => picked.has(r.id));
  const personName = people.find((p) => String(p.id) === person)?.name;
  const tickedRows = pendingShown.filter((r) => picked.has(r.id));

  const acceptMany = async (list: TaskCompletion[], what: string) => {
    if (!list.length) return;
    const ok = await confirm({ title: `Accept ${list.length} task(s) ${what}?`, description: 'Each person gets one notification listing what you accepted.', confirmText: 'Accept' });
    if (!ok.confirmed) return;
    bulk.mutate(
      list.map((r) => r.id),
      {
        onSuccess: (res) => {
          setPicked(new Set());
          if (res?.skipped) toast.info(`Accepted ${res.accepted}. ${res.skipped} were already decided and were left as they were.`);
          else toast.success(`Accepted ${res?.accepted ?? list.length}`);
        },
        onError: fail,
      },
    );
  };

  return (
    <div className="max-w-4xl space-y-4">
      <Segmented
        label="Which reviews"
        value={scope}
        onChange={setScope}
        options={[['inbox', 'To accept'], ['mine', 'My submissions'], ...(isAdmin ? [['all', 'All (log)'] as ['all', string]] : [])]}
      />
      {inbox && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Submitted by" className="w-auto" value={person} onChange={(e) => setPerson(e.target.value)} title="Show one person's submissions">
            <option value="">All people ({rows.length})</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.n})
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allTicked}
              disabled={busy || pendingDrawn.length === 0}
              onCheckedChange={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  pendingDrawn.forEach((r) => (allTicked ? next.delete(r.id) : next.add(r.id)));
                  return next;
                })
              }
            />
            Select all shown
          </label>
          <span className="flex-1" />
          {tickedRows.length > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => acceptMany(tickedRows, 'that you ticked')}>
              Accept selected ({tickedRows.length})
            </Button>
          )}
          <Button loading={bulk.isPending} disabled={busy || pendingShown.length === 0} onClick={() => acceptMany(pendingShown, personName ? `from ${personName}` : 'from everyone')}>
            {personName ? `Accept all from ${personName} (${pendingShown.length})` : `Accept all (${pendingShown.length})`}
          </Button>
        </div>
      )}
      {inbox && total > rows.length && (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[13px] text-muted-foreground">
          Showing the latest <strong className="font-mono text-foreground">{rows.length}</strong> of <strong className="font-mono text-foreground">{total}</strong>. Accept these and the rest will load.
        </p>
      )}
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={inbox ? 'Nothing waiting for you to accept.' : 'Nothing here yet.'} description={inbox ? 'When someone marks a task you gave them as done, it lands here for you to accept or send back.' : undefined} />
        ) : (
          <ul className="divide-y" aria-label="Completions">
            {more.visible.map((r) => {
              const late = !!r.task_due_at && new Date(r.created_at) > new Date(r.task_due_at);
              const over = !!r.task_actual_minutes && !!r.task_effort_minutes && r.task_actual_minutes > r.task_effort_minutes;
              return (
                <li key={r.id} className={cn('flex flex-col gap-3 border-l-[3px] py-3.5 pr-4 pl-3.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-start', r.status === 'pending' ? 'border-l-primary' : r.status === 'rejected' ? 'border-l-warning' : 'border-l-success')}>
                  <div className="flex min-w-0 flex-1 gap-3">
                    {inbox && r.status === 'pending' && (
                      <Checkbox
                        className="mt-1"
                        aria-label={`Select ${r.task_code}`}
                        checked={picked.has(r.id)}
                        disabled={busy}
                        onCheckedChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TaskCode code={r.task_code} />
                        <Link to={href(r.task)} state={{ fromList: true }} className="text-[14.5px] font-semibold hover:text-primary hover:underline">
                          {r.task_title}
                        </Link>
                        {r.status !== 'pending' && (
                          <Badge tone={r.status === 'rejected' ? 'orange' : 'green'} >
                            {r.status_display}
                          </Badge>
                        )}
                        {late && (
                          <Badge tone="red">
                            finished late
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        <strong className="font-semibold text-foreground">{r.submitted_by?.name}</strong> · submitted {fmtDT(r.created_at)}
                        <span className={cn('inline-flex items-center gap-1 rounded-sm border bg-card px-2 py-0.5 font-mono font-semibold tabular', over ? 'border-destructive/40 text-destructive' : 'text-foreground')} title={over ? 'Took longer than the assigned effort' : 'Effort spent against the assigned effort'}>
                          <Clock className="size-3" aria-hidden /> {fmtEffort(r.task_actual_minutes) ?? '—'} <span className="font-sans font-normal text-muted-foreground">of</span> {fmtEffort(r.task_effort_minutes) ?? '—'}
                        </span>
                        {over && <span className="font-semibold text-destructive">over estimate</span>}
                      </p>
                      {r.note && <p className="mt-1.5 border-l-2 border-border pl-3 text-sm whitespace-pre-wrap text-foreground/90">{r.note}</p>}
                      {r.files?.length > 0 && <ProofFiles files={r.files} />}
                      {r.remarks && (
                        <p className={cn('mt-1.5 rounded-lg px-3 py-1.5 text-sm', r.status === 'rejected' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
                          <strong>{r.status === 'rejected' ? 'Sent back' : 'Note'}:</strong> {r.remarks}
                        </p>
                      )}
                      {rejecting === r.id && (
                        <div className="mt-2 space-y-2">
                          <ProofreadText label="What is wrong?" required value={why} onChange={setWhy} rows={2} autoFocus placeholder="e.g. The invoice copy is missing — attach it and complete again." />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              loading={decide.isPending}
                              disabled={why.trim().length < 10}
                              onClick={() =>
                                decide.mutate(
                                  { id: r.id, decision: 'rejected', remarks: why.trim() },
                                  {
                                    onSuccess: () => {
                                      toast.success(`${r.task_code} sent back`);
                                      setRejecting(null);
                                      setWhy('');
                                    },
                                    onError: fail,
                                  },
                                )
                              }
                            >
                              Send it back
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => (setRejecting(null), setWhy(''))}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {r.status === 'pending' && rejecting !== r.id && (
                    <div className="flex gap-2 pl-7 sm:pl-0 [&>button]:flex-1 sm:[&>button]:flex-none">
                      <Button size="sm" disabled={busy} aria-label={`Accept ${r.task_code}`} onClick={() => decide.mutate({ id: r.id, decision: 'approved' }, { onSuccess: () => toast.success(`${r.task_code} accepted`), onError: fail })}>
                        <CheckCircle2 /> Accept
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} aria-label={`Send back ${r.task_code}`} onClick={() => (setRejecting(r.id), setWhy(''))}>
                        Send back
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!q.isLoading && !q.error && <ShowMore {...more.footer} noun="submissions" className="border-t" />}
      </Card>
    </div>
  );
}

// ─── Requests (change requests) ───────────────────────────────────────────

export function RequestsTab({ href }: { href: (id: number) => string }) {
  const isAdmin = useAccess().tasks.can('tasks.view_all');
  const [scope, setScope] = useState<'inbox' | 'mine' | 'all'>('inbox');
  const q = useChangeRequests(scope);
  const review = useReviewChangeRequest();
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const more = useShowMore(rows, { reset: scope });
  const act = (id: number, code: string, decision: 'approved' | 'rejected' | 'escalated') =>
    review.mutate({ id, decision, remarks: remarks[id] ?? '' }, { onSuccess: () => toast.success(`${code}: ${decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'escalated to admin'}`), onError: fail });

  return (
    <div className="max-w-4xl space-y-4">
      <Segmented
        label="Which requests"
        value={scope}
        onChange={setScope}
        options={[['inbox', 'To approve'], ['mine', 'My requests'], ...(isAdmin ? [['all', 'All (log)'] as ['all', string]] : [])]}
      />
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={scope === 'inbox' ? 'Nothing waiting for your approval.' : 'No requests here.'} description={scope === 'inbox' ? 'Change requests on tasks you gave (deadline, effort, priority…) land here.' : undefined} />
        ) : (
          <ul className="divide-y" aria-label="Change requests">
            {more.visible.map((r) => (
              <li key={r.id} className={cn('flex flex-col gap-3 border-l-[3px] py-3.5 pr-4 pl-3.5 transition-colors hover:bg-muted/40 lg:flex-row lg:items-start', r.status === 'pending' ? 'border-l-warning' : r.status === 'approved' ? 'border-l-success' : r.status === 'rejected' ? 'border-l-destructive' : 'border-l-border')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TaskCode code={r.task_code} />
                    <Link to={href(r.task)} state={{ fromList: true }} className="text-[14.5px] font-semibold hover:text-primary hover:underline">
                      {r.task_title}
                    </Link>
                    <Badge tone={r.status === 'pending' ? 'amber' : r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'neutral'} >
                      {r.status_display}
                    </Badge>
                    {r.escalated && (
                      <Badge tone="violet">
                        <ArrowUp /> escalated to admin
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Task of <strong className="font-semibold text-foreground">{r.task_assignee_name || r.task_assignee || '—'}</strong>
                    {r.task_created_by_name && <> · created by {r.task_created_by_name}</>}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
                    {describeChanges(r).map((line, i) => (
                      <li key={i} className="rounded-md border border-warning/30 bg-warning/8 px-2 py-1 font-medium">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 border-l-2 border-border pl-3 text-sm text-foreground/90">
                    <span className="text-muted-foreground">Reason:</span> {r.reason}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.requested_by?.name} · {fmtDT(r.created_at)}
                    {r.reviewed_by && (
                      <>
                        {' '}
                        · reviewed by {r.reviewed_by.name}
                        {r.remarks ? ` — "${r.remarks}"` : ''}
                      </>
                    )}
                  </p>
                </div>
                {scope === 'inbox' && r.status === 'pending' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Remarks for ${r.task_code}`} placeholder="Remarks…" className="h-8 w-40" value={remarks[r.id] ?? ''} onChange={(e) => setRemarks((p) => ({ ...p, [r.id]: e.target.value }))} />
                    <Button size="sm" disabled={review.isPending} aria-label={`Approve ${r.task_code}`} onClick={() => act(r.id, r.task_code, 'approved')}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={review.isPending} aria-label={`Reject ${r.task_code}`} onClick={() => act(r.id, r.task_code, 'rejected')}>
                      Reject
                    </Button>
                    {!isAdmin && (
                      <Button size="sm" variant="ghost" disabled={review.isPending} title="Let the admin decide this one" onClick={() => act(r.id, r.task_code, 'escalated')}>
                        Escalate <ArrowUp />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!q.isLoading && !q.error && <ShowMore {...more.footer} noun="requests" className="border-t" />}
      </Card>
    </div>
  );
}

// ─── Deleted bin (admin) ───────────────────────────────────────────────────

export function DeletedTab() {
  const q = useWorkTaskList({ scope: 'deleted' });
  const restore = useRestoreTask();
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const more = useShowMore(rows);
  return (
    <div className="max-w-3xl space-y-3">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Trash2 className="mt-0.5 size-4 shrink-0" aria-hidden /> Deleted tasks are never destroyed — they rest here, restorable any time.
      </p>
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Trash2} title="The bin is empty." description="Tasks that are deleted or cancelled show up here." />
        ) : (
          <ul className="divide-y" aria-label="Deleted tasks">
            {more.visible.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TaskCode code={t.code} />
                    <span className="font-semibold text-muted-foreground line-through decoration-muted-foreground/40">{t.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.assigned_to_detail?.name} · deleted {fmtDT(t.deleted_at)}
                  </p>
                </div>
                <Button size="sm" variant="outline" loading={restore.isPending && restore.variables === t.id} aria-label={`Restore ${t.code}`} onClick={() => restore.mutate(t.id, { onSuccess: () => toast.success(`${t.code} restored`), onError: fail })}>
                  <RotateCcw /> Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!q.isLoading && !q.error && <ShowMore {...more.footer} noun="deleted tasks" className="border-t" />}
      </Card>
    </div>
  );
}
