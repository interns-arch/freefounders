import { errorMessage, useAccess } from '@freefounders/core';
import {
  type DayLogDay,
  type TaskDetail,
  useAddTaskStep,
  useDeleteTask,
  usePendingReviewOf,
  useReviewCompletion,
  useSummarizeTask,
  useTaskComment,
  useTaskDetail,
  useTaskFeed,
  useTaskFiles,
  useTaskStep,
  useUploadTaskFiles,
} from '@freefounders/core/tasks';
import { ArrowUpRight, BookOpen, CheckCircle2, Clock, CornerLeftUp, MessageSquare, Paperclip, Pencil, Plus, Send, Sparkles, Timer, Trash2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Badge, Checkbox, Skeleton } from '@/components/ui/primitives';
import { FilePick, Linkify, ProofreadText, fmtDT, fmtEffort, relDue } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { useTaskDialogs } from './dialogs';
import { Chip, PRIORITY_TONE, STATUS_TONE, TaskCode } from './task-bits';

/**
 * Everything about one task in a slide-over: steps, review waiting for me, daily log, files, comments and updates.
 * Opened at /tasks/tasks/:taskId (links in emails and notifications); ?review=accept|reject comes from the completion
 * email's buttons and brings the review into view.
 */
export function TaskDetailSheet({ taskId, review, focusComment, onClose }: { taskId: number; review: string | null; focusComment: boolean; onClose: () => void }) {
  const detail = useTaskDetail(taskId);
  const t = detail.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        {!t ? (
          <>
            <SheetHeader>
              <SheetTitle>{detail.error ? 'Task not available' : 'Loading task…'}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              {detail.error ? (
                <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-20" />
                  <Skeleton className="h-40" />
                </div>
              )}
            </SheetBody>
          </>
        ) : (
          <DetailBody t={t} review={review} focusComment={focusComment} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, extra, children, className }: { title: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)} aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {extra && <span className="text-xs font-normal text-muted-foreground">{extra}</span>}
      </h3>
      {children}
    </section>
  );
}

function DetailBody({ t, review, focusComment, onClose }: { t: TaskDetail; review: string | null; focusComment: boolean; onClose: () => void }) {
  const access = useAccess();
  const me = access.tasks.me;
  const isAdmin = access.tasks.can('tasks.view_all');
  const confirm = useConfirm();
  const feed = useTaskFeed(t.id).data ?? [];
  const files = useTaskFiles(t.id).data ?? [];
  const pending = usePendingReviewOf(t.id).data ?? null;
  const comment = useTaskComment();
  const addStep = useAddTaskStep();
  const step = useTaskStep();
  const summarize = useSummarizeTask();
  const upload = useUploadTaskFiles();
  const del = useDeleteTask();
  const decide = useReviewCompletion();
  const dialogs = useTaskDialogs({ onDeleted: onClose });

  const [text, setText] = useState('');
  const [newStep, setNewStep] = useState({ text: '', due_at: '' });
  const [summary, setSummary] = useState<{ summary: string; provider: string } | null>(null);
  const [sendingBack, setSendingBack] = useState(review === 'reject');
  const [why, setWhy] = useState('');
  const reviewRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);

  const dl = t.day_log;
  const isAssignee = t.assigned_to === me?.id;
  const canAct = t.status !== 'done';
  const doneSteps = t.checklist.filter((c) => c.done).length;
  const openSteps = t.checklist.length - doneSteps;
  const today = dl?.days?.find((d) => d.is_today);
  const fail = (e: unknown) => toast.error(errorMessage(e));

  // Arriving from the email: bring the review into view; otherwise from a notification: the comment box.
  useEffect(() => {
    if (review && pending) reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [review, pending]);
  useEffect(() => {
    if (focusComment && !review) {
      const id = setTimeout(() => {
        commentRef.current?.scrollIntoView({ block: 'center' });
        commentRef.current?.focus();
      }, 250);
      return () => clearTimeout(id);
    }
  }, [focusComment, review]);

  const send = () => {
    const v = text.trim();
    if (!v) return;
    comment.mutate({ id: t.id, text: v }, { onSuccess: () => setText(''), onError: fail });
  };
  const addOneStep = () => {
    const v = newStep.text.trim();
    if (!v) return;
    addStep.mutate({ id: t.id, text: v, due_at: newStep.due_at || undefined }, { onSuccess: () => setNewStep({ text: '', due_at: '' }), onError: fail });
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${t.code}?`, description: `"${t.title}" moves to the Deleted bin and can be restored by an admin.`, confirmText: 'Delete', destructive: true });
    if (!ok.confirmed) return;
    del.mutate(t.id, {
      onSuccess: () => {
        toast.success(`${t.code} moved to Deleted`);
        onClose();
      },
      onError: fail,
    });
  };

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <TaskCode code={t.code} />
          <Badge tone={STATUS_TONE[t.status]} dot>
            {t.status_display}
          </Badge>
          {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority_display}</Badge>}
        </div>
        <SheetTitle className="text-lg leading-snug">{t.title}</SheetTitle>
        <SheetDescription>
          Assigned to <strong className="text-foreground">{t.assigned_to_detail?.name}</strong>
          {t.created_by_detail && (
            <>
              {' '}
              by <strong className="text-foreground">{t.created_by_detail.name}</strong>
            </>
          )}
          {t.due_at && (
            <>
              {' '}
              · due {fmtDT(t.due_at)} <span className={cn(t.is_overdue && 'text-destructive')}>({relDue(t.due_at)})</span>
            </>
          )}
          {t.completed_at && <> · completed {fmtDT(t.completed_at)}</>}
          {t.lead_name && <> · lead: {t.lead_name}</>}
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5 scrollbar-thin">
        <div className="flex flex-wrap gap-1.5">
          {t.category && <Chip>{t.category}</Chip>}
          {!!t.effort_minutes && (
            <Chip title="Effort set by the assigner">
              <Timer /> {fmtEffort(t.effort_minutes)}
            </Chip>
          )}
          {!!t.actual_minutes && (
            <Chip title="Effort spent">
              <Clock /> {fmtEffort(t.actual_minutes)} spent
            </Chip>
          )}
          {t.progress_percent != null && t.status !== 'done' && <Chip title="Latest status update">{t.progress_percent}% done</Chip>}
          {t.parent_code && (
            <Chip>
              <CornerLeftUp /> sub-task of {t.parent_code}
            </Chip>
          )}
          {t.frequency !== 'one_time' && <Chip>{t.frequency_display}</Chip>}
          {t.group_name && <Chip>{t.group_name}</Chip>}
        </div>
        {t.description && (
          <p className="text-sm whitespace-pre-wrap">
            <Linkify text={t.description} />
          </p>
        )}
        {t.external_url && (
          <a href={t.external_url} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Open what this task is about <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        )}

        <div className="flex flex-wrap gap-2">
          {canAct && isAssignee && (
            <>
              <Button variant="outline" size="sm" onClick={() => dialogs.open({ kind: 'progress', task: t })}>
                <Plus /> Status update
              </Button>
              {today && (
                <Button variant="outline" size="sm" title="Write what you did today" onClick={() => dialogs.open({ kind: 'daylog', task: t, day: today })}>
                  <BookOpen /> Today&rsquo;s log
                </Button>
              )}
              <Button size="sm" disabled={openSteps > 0} title={openSteps > 0 ? `Finish the ${openSteps} open step(s) first` : 'Complete this task'} onClick={() => dialogs.open({ kind: 'complete', task: t })}>
                <CheckCircle2 /> Complete
              </Button>
            </>
          )}
          {canAct && (
            <Button variant="outline" size="sm" onClick={() => dialogs.open({ kind: 'request', task: t })}>
              <Pencil /> {isAdmin ? 'Edit' : 'Request change'}
            </Button>
          )}
          {t.can_delete && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" title="Move this task to the Deleted bin" loading={del.isPending} onClick={remove}>
              <Trash2 /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" title="AI summary (works without AI too)" loading={summarize.isPending} onClick={() => summarize.mutate(t.id, { onSuccess: setSummary, onError: fail })}>
            <Sparkles /> Summarize
          </Button>
        </div>
        {summary && (
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            {summary.summary} <span className="text-muted-foreground">({summary.provider})</span>
          </div>
        )}

        {pending && (
          <div ref={reviewRef} className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4" role="region" aria-label="Waiting for you to accept">
            <p className="text-sm font-semibold">Waiting for you to accept</p>
            <p className="text-sm">
              <strong>{pending.submitted_by?.name}</strong> marked this done
              {pending.task_actual_minutes ? <> · took {fmtEffort(pending.task_actual_minutes)}</> : null}
              {pending.task_effort_minutes ? <> against {fmtEffort(pending.task_effort_minutes)}</> : null}
            </p>
            {pending.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">“{pending.note}”</p>}
            {!sendingBack ? (
              <div className="flex gap-2">
                <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: pending.id, decision: 'approved' }, { onSuccess: () => toast.success('Accepted'), onError: fail })}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setSendingBack(true)}>
                  Send back
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <ProofreadText label="What is wrong?" required value={why} onChange={setWhy} rows={2} autoFocus placeholder="e.g. The bank letter is missing — attach it and complete again." />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={decide.isPending}
                    disabled={why.trim().length < 10}
                    onClick={() =>
                      decide.mutate(
                        { id: pending.id, decision: 'rejected', remarks: why.trim() },
                        {
                          onSuccess: () => {
                            toast.success('Sent back');
                            setSendingBack(false);
                            setWhy('');
                          },
                          onError: fail,
                        },
                      )
                    }
                  >
                    Send it back
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => (setSendingBack(false), setWhy(''))}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Section title="Checklist" extra={t.checklist.length > 0 ? `${doneSteps}/${t.checklist.length}` : undefined}>
          {openSteps > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              {openSteps} step{openSteps === 1 ? '' : 's'} left — the task can only be completed once every step is ticked.
            </p>
          )}
          <ul className="space-y-1.5">
            {t.checklist.map((c) => (
              <li key={c.id} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5', c.done && 'bg-muted/40')}>
                <Checkbox
                  className="mt-0.5"
                  checked={c.done}
                  aria-label={c.done ? `Re-open step: ${c.text}` : `Tick step: ${c.text}`}
                  onCheckedChange={() => (c.done ? step.mutate({ id: t.id, item: c.id }, { onError: fail }) : dialogs.open({ kind: 'step', taskId: t.id, step: c }))}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <span className={cn(c.done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{c.text}</span>
                  {c.due_at && <span className="ml-1.5 text-xs text-muted-foreground">· Due: {fmtDT(c.due_at)}</span>}
                  {c.done && c.note && (
                    <p className="mt-0.5 text-xs text-success">
                      ✓ {c.note}
                      {c.done_by_name && <> — {c.done_by_name}</>}
                      {c.done_at && <>, {fmtDT(c.done_at)}</>}
                    </p>
                  )}
                </div>
                {!c.done && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove step: ${c.text}`}
                    onClick={async () => {
                      if ((await confirm({ title: 'Remove this step?', description: `"${c.text}"`, confirmText: 'Remove', destructive: true })).confirmed)
                        step.mutate({ id: t.id, item: c.id, remove: true }, { onError: fail });
                    }}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Add a step"
              placeholder="Add a step…"
              className="min-w-44 flex-1"
              value={newStep.text}
              onChange={(e) => setNewStep((s) => ({ ...s, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOneStep();
                }
              }}
            />
            <Input type="datetime-local" aria-label="Due time for the new step" title="Optional due time for this step" className="w-auto" value={newStep.due_at} onChange={(e) => setNewStep((s) => ({ ...s, due_at: e.target.value }))} />
            <Button variant="outline" className="h-9" disabled={!newStep.text.trim()} loading={addStep.isPending} onClick={addOneStep}>
              <Plus /> Add step
            </Button>
          </div>
        </Section>

        {t.subtasks.length > 0 && (
          <Section title="Sub-tasks">
            <ul className="space-y-1 text-sm">
              {t.subtasks.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                  <TaskCode code={s.code} /> {s.title}
                  <span className="text-muted-foreground">
                    — {s.assignee} · {s.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {dl && dl.days.length > 1 && (
          <Section title="Daily progress log" extra={`${dl.logged_days}/${dl.days.length} days`}>
            {dl.missed_days > 0 && (
              <p className="text-xs text-muted-foreground">
                {dl.missed_days} day{dl.missed_days === 1 ? '' : 's'} with nothing written.
              </p>
            )}
            {dl.logged_minutes > 0 && (
              <p className="text-xs text-muted-foreground">
                Logged day by day: {fmtEffort(dl.logged_minutes)}
                {t.actual_minutes ? <> · recorded total on the task: {fmtEffort(t.actual_minutes)}</> : null}
              </p>
            )}
            <ul className="space-y-1">
              {dl.days.map((d) => (
                <DayRow key={d.date} d={d} canWrite={canWriteDay(dl, d)} onWrite={() => dialogs.open({ kind: 'daylog', task: t, day: d })} />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Attachments" extra={files.length > 0 ? String(files.length) : undefined}>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-1.5">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                      {f.filename}
                    </a>
                  ) : (
                    f.filename
                  )}
                  <span className="text-muted-foreground"> · {f.uploaded_by?.name}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <FilePick busy={upload.isPending} onPick={(all) => upload.mutate({ id: t.id, files: all.slice(0, 5) }, { onSuccess: () => toast.success('Uploaded'), onError: fail })} />
            <span className="text-xs text-muted-foreground">Up to 5 files, 10 MB each.</span>
          </div>
        </Section>

        <Section title="Comments & updates">
          <div className="flex gap-2">
            <Input
              ref={commentRef}
              aria-label="Write a comment"
              placeholder="Write a comment…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button className="h-9" disabled={!text.trim()} loading={comment.isPending} onClick={send}>
              <Send /> Send
            </Button>
          </div>
          <ul className="space-y-1.5" aria-label="Updates">
            {feed.map((a) => (
              <li key={a.id} className={cn('rounded-md border-l-2 px-3 py-1.5 text-sm', a.kind === 'comment' ? 'border-primary bg-primary/5' : 'border-border')}>
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {a.kind === 'comment' && <MessageSquare className="size-3" aria-hidden />}
                  <strong className="text-foreground">{a.actor?.name || 'System'}</strong> · {fmtDT(a.created_at)}
                </div>
                <p className="whitespace-pre-wrap">
                  <Linkify text={a.text} />
                </p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      {dialogs.element}
    </>
  );
}

function canWriteDay(dl: TaskDetail['day_log'], d: DayLogDay): boolean {
  const daysAgo = Math.round((new Date(dl.today).getTime() - new Date(d.date).getTime()) / 864e5);
  return dl.can_write && !d.is_future && daysAgo <= dl.backfill_days;
}

function DayRow({ d, canWrite, onWrite }: { d: DayLogDay; canWrite: boolean; onWrite: () => void }) {
  return (
    <li className={cn('flex items-start gap-3 rounded-md border-l-2 px-3 py-2 text-sm', d.entry ? 'border-primary bg-primary/5' : 'border-border', !d.entry && !d.is_today && 'opacity-70')}>
      <div className="w-24 shrink-0">
        <strong>{d.label}</strong>
        {d.is_today && <span className="text-muted-foreground"> · today</span>}
      </div>
      <div className="min-w-0 flex-1">
        {d.entry ? (
          <>
            <p className="whitespace-pre-wrap">{d.entry.did}</p>
            {d.entry.plan_tomorrow && <p className="text-muted-foreground">→ Next: {d.entry.plan_tomorrow}</p>}
            <p className="text-xs text-muted-foreground">
              {d.entry.percent_done != null && <>{d.entry.percent_done}% · </>}
              {d.entry.minutes_spent ? <>{fmtEffort(d.entry.minutes_spent)} · </> : null}
              {d.entry.author_name}
            </p>
          </>
        ) : (
          <span className="text-muted-foreground">{d.is_future ? 'Not yet' : 'Nothing written'}</span>
        )}
      </div>
      {canWrite && (
        <Button variant="outline" size="xs" aria-label={`${d.entry ? 'Edit' : 'Add'} log for ${d.label}`} onClick={onWrite}>
          {d.entry ? 'Edit' : 'Add'}
        </Button>
      )}
    </li>
  );
}
