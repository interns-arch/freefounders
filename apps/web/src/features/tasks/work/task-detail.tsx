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
import { AlarmClock, ArrowUpRight, BookOpen, CheckCircle2, CornerLeftUp, FileText, MessageSquare, Paperclip, Pencil, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Checkbox, Progress, Skeleton } from '@/components/ui/primitives';
import { FilePick, Linkify, ProofreadText, fmtDT, fmtEffort, relDue } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { useTaskDialogs } from './dialogs';
import { PriorityPill, SectionHead, StatusPill, TaskCode } from './task-bits';
import { safeHref } from '@/lib/safe-url';

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
                <div className="space-y-4" aria-busy="true">
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                  <Skeleton className="h-16" />
                  <Skeleton className="h-9 w-2/3" />
                  <Skeleton className="h-32" />
                  <Skeleton className="h-24" />
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

/** A titled block of the panel: uppercase heading with a count, then its content. */
function Section({ title, count, extra, children, className }: { title: string; count?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)} aria-label={title}>
      <SectionHead title={title} count={count} extra={extra} />
      {children}
    </section>
  );
}

/** One label / value pair of the details grid (the old drawer's "k / v" fields). */
function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="font-mono text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] font-medium break-words">{children}</dd>
    </div>
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
  const late = canAct && !!t.is_overdue;
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

  const hasActions = canAct || t.can_delete;

  return (
    <>
      <SheetHeader className={cn('gap-2', late && 'border-l-4 border-l-destructive', !late && t.status === 'done' && 'border-l-4 border-l-success')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskCode code={t.code} />
          <StatusPill status={t.status} label={t.status_display} />
          {t.priority !== 'normal' && <PriorityPill priority={t.priority} label={t.priority_display} />}
          {late && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
              <AlarmClock className="size-3" aria-hidden /> Overdue
            </span>
          )}
        </div>
        <SheetTitle className="text-[19px] leading-snug tracking-tight">{t.title}</SheetTitle>
        <SheetDescription className="sr-only">
          Assigned to {t.assigned_to_detail?.name}
          {t.created_by_detail && <> by {t.created_by_detail.name}</>}
        </SheetDescription>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1 sm:grid-cols-3">
          <Fact label="Assigned to">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={t.assigned_to_detail?.name} className="size-5 text-[9px]" />
              {t.assigned_to_detail?.name}
            </span>
          </Fact>
          <Fact label="Assigned by">{t.created_by_detail?.name ?? '—'}</Fact>
          <Fact label={t.completed_at ? 'Completed' : 'Due'}>
            {t.completed_at ? (
              <span className="text-success">{fmtDT(t.completed_at)}</span>
            ) : t.due_at ? (
              <span className={cn(late && 'font-bold text-destructive')}>
                {fmtDT(t.due_at)} <span className={cn('font-normal', late ? 'text-destructive' : 'text-muted-foreground')}>· {relDue(t.due_at)}</span>
              </span>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Effort">
            {t.effort_minutes ? <span className="font-mono tabular">{fmtEffort(t.effort_minutes)}</span> : '—'}
            {!!t.actual_minutes && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · <span className="font-mono tabular">{fmtEffort(t.actual_minutes)}</span> spent
              </span>
            )}
            {t.progress_percent != null && t.status !== 'done' && <span className="font-normal text-muted-foreground"> · {t.progress_percent}% done</span>}
          </Fact>
          <Fact label="Category">{t.category || '—'}</Fact>
          <Fact label="Repeats">{t.frequency !== 'one_time' ? t.frequency_display : 'One time'}</Fact>
          {t.group_name && <Fact label="Group">{t.group_name}</Fact>}
          {t.lead_name && <Fact label="Lead">{t.lead_name}</Fact>}
          {t.parent_code && (
            <Fact label="Part of">
              <span className="inline-flex items-center gap-1">
                <CornerLeftUp className="size-3.5 text-muted-foreground" aria-hidden /> {t.parent_code}
              </span>
            </Fact>
          )}
        </dl>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5 scrollbar-thin">
        {(t.description || t.external_url) && (
          <div className="space-y-2">
            {t.description && (
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
                <Linkify text={t.description} />
              </p>
            )}
            {t.external_url && (
              <a href={safeHref(t.external_url)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Open what this task is about <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        )}

        {hasActions && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2">
            {canAct && isAssignee && (
              <>
                <Button size="sm" disabled={openSteps > 0} title={openSteps > 0 ? `Finish the ${openSteps} open step(s) first` : 'Complete this task'} onClick={() => dialogs.open({ kind: 'complete', task: t })}>
                  <CheckCircle2 /> Complete
                </Button>
                <Button variant="outline" size="sm" onClick={() => dialogs.open({ kind: 'progress', task: t })}>
                  <Plus /> Status update
                </Button>
                {today && (
                  <Button variant="outline" size="sm" title="Write what you did today" onClick={() => dialogs.open({ kind: 'daylog', task: t, day: today })}>
                    <BookOpen /> Today&rsquo;s log
                  </Button>
                )}
              </>
            )}
            {canAct && (
              <Button variant="outline" size="sm" onClick={() => dialogs.open({ kind: 'request', task: t })}>
                <Pencil /> {isAdmin ? 'Edit' : 'Request change'}
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="ghost" size="sm" title="AI summary (works without AI too)" loading={summarize.isPending} onClick={() => summarize.mutate(t.id, { onSuccess: setSummary, onError: fail })}>
              <Sparkles /> Summarize
            </Button>
            {t.can_delete && (
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" title="Move this task to the Deleted bin" loading={del.isPending} onClick={remove}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        )}
        {!hasActions && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" title="AI summary (works without AI too)" loading={summarize.isPending} onClick={() => summarize.mutate(t.id, { onSuccess: setSummary, onError: fail })}>
              <Sparkles /> Summarize
            </Button>
          </div>
        )}
        {summary && (
          <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <p>
              {summary.summary} <span className="text-muted-foreground">({summary.provider})</span>
            </p>
          </div>
        )}

        {pending && (
          <div ref={reviewRef} className="scroll-mt-3 space-y-2.5 rounded-xl border border-primary/50 border-l-4 border-l-primary bg-primary/8 p-4" role="region" aria-label="Waiting for you to accept">
            <p className="flex items-center gap-1.5 text-[14.5px] font-bold text-primary">
              <CheckCircle2 className="size-4" aria-hidden /> Waiting for you to accept
            </p>
            <p className="text-sm">
              <strong>{pending.submitted_by?.name}</strong> marked this done
              {pending.task_actual_minutes ? (
                <>
                  {' '}
                  · took <span className="font-mono font-semibold tabular">{fmtEffort(pending.task_actual_minutes)}</span>
                </>
              ) : null}
              {pending.task_effort_minutes ? (
                <>
                  {' '}
                  against <span className="font-mono font-semibold tabular">{fmtEffort(pending.task_effort_minutes)}</span>
                </>
              ) : null}
            </p>
            {pending.note && <p className="border-l-2 border-primary/30 pl-3 text-sm whitespace-pre-wrap text-foreground/90 italic">“{pending.note}”</p>}
            {!sendingBack ? (
              <div className="flex flex-wrap gap-2 pt-1 [&>button]:flex-1 sm:[&>button]:flex-none">
                <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: pending.id, decision: 'approved' }, { onSuccess: () => toast.success('Accepted'), onError: fail })}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setSendingBack(true)}>
                  Send back
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <ProofreadText label="What is wrong?" required value={why} onChange={setWhy} rows={2} autoFocus placeholder="e.g. The bank letter is missing — attach it and complete again." />
                <div className="flex flex-wrap gap-2">
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

        <Section title="Checklist" count={t.checklist.length > 0 ? `${doneSteps}/${t.checklist.length}` : undefined}>
          {t.checklist.length > 0 && <Progress value={(doneSteps / t.checklist.length) * 100} className="h-1" indicatorClassName={openSteps === 0 ? 'bg-success' : undefined} />}
          {openSteps > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] text-warning">
              <AlarmClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {openSteps} step{openSteps === 1 ? '' : 's'} left — the task can only be completed once every step is ticked.
              </span>
            </p>
          )}
          {t.checklist.length > 0 && (
            <ul className="space-y-1.5">
              {t.checklist.map((c) => (
                <li key={c.id} className={cn('flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-colors', c.done && 'border-success/25 bg-success/5')}>
                  <Checkbox
                    className="mt-0.5"
                    checked={c.done}
                    aria-label={c.done ? `Re-open step: ${c.text}` : `Tick step: ${c.text}`}
                    onCheckedChange={() => (c.done ? step.mutate({ id: t.id, item: c.id }, { onError: fail }) : dialogs.open({ kind: 'step', taskId: t.id, step: c }))}
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className={cn('font-medium', c.done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{c.text}</span>
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
                      className="text-muted-foreground"
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
          )}
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
          <Section title="Sub-tasks" count={t.subtasks.length}>
            <ul className="divide-y rounded-lg border text-sm">
              {t.subtasks.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                  <TaskCode code={s.code} /> <span className="font-medium">{s.title}</span>
                  <span className="text-muted-foreground">— {s.assignee}</span>
                  <StatusPill status={s.status as TaskDetail['status']} label={s.status.replace('_', ' ')} className="ml-auto capitalize" />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {dl && dl.days.length > 1 && (
          <Section title="Daily progress log" count={`${dl.logged_days}/${dl.days.length} days`}>
            {(dl.missed_days > 0 || dl.logged_minutes > 0) && (
              <p className="text-xs text-muted-foreground">
                {dl.missed_days > 0 && (
                  <>
                    {dl.missed_days} day{dl.missed_days === 1 ? '' : 's'} with nothing written.
                  </>
                )}
                {dl.logged_minutes > 0 && (
                  <>
                    {' '}
                    Logged day by day: <span className="font-mono tabular">{fmtEffort(dl.logged_minutes)}</span>
                    {t.actual_minutes ? (
                      <>
                        {' '}
                        · recorded total on the task: <span className="font-mono tabular">{fmtEffort(t.actual_minutes)}</span>
                      </>
                    ) : null}
                  </>
                )}
              </p>
            )}
            <ul className="space-y-1.5">
              {dl.days.map((d) => (
                <DayRow key={d.date} d={d} canWrite={canWriteDay(dl, d)} onWrite={() => dialogs.open({ kind: 'daylog', task: t, day: d })} />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Attachments" count={files.length > 0 ? files.length : undefined}>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {files.map((f) => (
                <li key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {f.url ? (
                    <a href={safeHref(f.url)} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">
                      {f.filename}
                    </a>
                  ) : (
                    <span className="truncate">{f.filename}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">· {f.uploaded_by?.name}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <FilePick busy={upload.isPending} onPick={(all) => upload.mutate({ id: t.id, files: all.slice(0, 5) }, { onSuccess: () => toast.success('Uploaded'), onError: fail })} />
            <span className="text-xs text-muted-foreground">Up to 5 files, 10 MB each.</span>
          </div>
        </Section>

        <Section title="Comments & updates" count={feed.length > 0 ? feed.length : undefined}>
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
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet — the first comment or update lands here.</p>
          ) : (
            <ul className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border" aria-label="Updates">
              {feed.map((a) => (
                <li key={a.id} className="relative pl-5 text-sm">
                  <span className={cn('absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card', a.kind === 'comment' ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden />
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    {a.kind === 'comment' ? <MessageSquare className="size-3 text-primary" aria-hidden /> : <FileText className="size-3" aria-hidden />}
                    <strong className="font-semibold text-foreground">{a.actor?.name || 'System'}</strong> · {fmtDT(a.created_at)}
                  </div>
                  <p className={cn('mt-0.5 whitespace-pre-wrap', a.kind === 'comment' ? 'rounded-lg rounded-tl-sm border bg-card px-3 py-2' : 'text-foreground/90')}>
                    <Linkify text={a.text} />
                  </p>
                </li>
              ))}
            </ul>
          )}
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
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border border-l-[3px] px-3 py-2 text-sm',
        d.entry ? 'border-l-primary bg-primary/5' : 'border-l-border',
        d.is_today && !d.entry && 'border-l-warning bg-warning/5',
        !d.entry && !d.is_today && 'opacity-70',
      )}
    >
      <div className="w-24 shrink-0">
        <strong className="font-mono text-[12.5px] font-semibold">{d.label}</strong>
        {d.is_today && <span className="block text-xs text-muted-foreground">today</span>}
      </div>
      <div className="min-w-0 flex-1">
        {d.entry ? (
          <>
            <p className="whitespace-pre-wrap">{d.entry.did}</p>
            {d.entry.plan_tomorrow && <p className="text-muted-foreground">→ Next: {d.entry.plan_tomorrow}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
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
