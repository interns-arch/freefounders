import { errorMessage, useAccess } from '@freefounders/core';
import {
  type DayLogDay,
  type TaskChangeRequest,
  type WorkTask,
  TASK_PRIORITY_LABELS,
  type TaskPriority,
  useCompleteTask,
  useDeleteTask,
  useEditTask,
  useRequestTaskChange,
  useSaveDayLog,
  useTaskAssignees,
  useTaskEstimate,
  useTaskProgress,
  useTaskStep,
  useTaskWorkSettings,
  useTeamPeople,
} from '@freefounders/core/tasks';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { FilePick, PickedFiles, ProofreadText, addFiles, fmtDT, fmtEffort, nowForInput, toMinutes } from '@/features/tasks/shared';
import { EffortInput, type EffortUnit } from './effort-input';

/** The task fields every dialog needs (a list row or the full detail). */
type TaskLike = Pick<WorkTask, 'id' | 'code' | 'title' | 'effort_minutes' | 'actual_minutes' | 'progress_percent' | 'frequency' | 'created_by_detail'>;

function FormDialog({
  open,
  onClose,
  title,
  description,
  onSubmit,
  submitLabel,
  submitting,
  disabled,
  destructive,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  onSubmit: () => void;
  submitLabel: string;
  submitting?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && !submitting) onSubmit();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'max-w-2xl' : 'max-w-lg'}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader className="-mx-5 -mt-5 border-b bg-muted/40 px-5 pt-5 pb-4">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <DialogFooter className="-mx-5 -mb-5 border-t bg-muted/30 px-5 py-3.5">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={submitting} disabled={disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const fail = (err: unknown) => toast.error(errorMessage(err));

// ─── Complete with evidence ───────────────────────────────────────────────

function CompleteDialog({ task, onClose }: { task: TaskLike; onClose: () => void }) {
  const settings = useTaskWorkSettings().data;
  const complete = useCompleteTask();
  const [remarks, setRemarks] = useState('');
  const [actual, setActual] = useState(task.actual_minutes ? String(task.actual_minutes) : '');
  const [unit, setUnit] = useState<EffortUnit>('minutes');
  const [files, setFiles] = useState<File[]>([]);
  const needFile = !!settings?.require_completion_attachment;
  const minutes = toMinutes(actual, unit);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Complete ${task.code}`}
      description={task.title}
      submitLabel="Complete task"
      submitting={complete.isPending}
      disabled={!remarks.trim() || !minutes || minutes < 1 || (needFile && !files.length)}
      onSubmit={() =>
        complete.mutate(
          { id: task.id, remarks: remarks.trim(), actualMinutes: minutes ?? 0, files },
          {
            onSuccess: () => {
              toast.success(`${task.code} completed`);
              onClose();
            },
            onError: fail,
          },
        )
      }
    >
      <ProofreadText label="What was done?" required value={remarks} onChange={setRemarks} rows={3} placeholder="e.g. Delivered the quotation and confirmed on call" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assigned task time">
          <Input value={task.effort_minutes ? (fmtEffort(task.effort_minutes) ?? '') : 'not set'} disabled aria-label="Assigned task time" className="font-mono" />
        </Field>
        <EffortInput label="Total effort you spent" required value={actual} onChange={setActual} unit={unit} onUnit={setUnit} placeholder={unit === 'hours' ? 'e.g. 1.5' : 'e.g. 60'} />
      </div>
      <div className="grid gap-1.5 rounded-lg border border-dashed bg-muted/30 p-3">
        <span className="text-[13px] font-semibold">Proof files / photos {needFile ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}</span>
        <div className="flex flex-wrap items-center gap-2">
          <FilePick onPick={(picked) => setFiles((p) => addFiles(p, picked))} />
          <span className="text-xs text-muted-foreground">Up to 5 files, 10 MB each.</span>
        </div>
        <PickedFiles files={files} onRemove={(i) => setFiles((p) => p.filter((_, k) => k !== i))} />
      </div>
    </FormDialog>
  );
}

// ─── In progress: status update ───────────────────────────────────────────

function ProgressDialog({ task, onClose }: { task: TaskLike; onClose: () => void }) {
  const progress = useTaskProgress();
  const pid = useId();
  const [percent, setPercent] = useState(task.progress_percent ? String(task.progress_percent) : '');
  const [spent, setSpent] = useState(task.actual_minutes ? String(task.actual_minutes) : '');
  const [unit, setUnit] = useState<EffortUnit>('minutes');
  const [comment, setComment] = useState('');
  const nothing = percent === '' && spent === '' && !comment.trim();
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Status update — ${task.code}`}
      description={`${task.title} · every field is optional, add what you know. All updates stay in the task history.`}
      submitLabel="Post update"
      submitting={progress.isPending}
      disabled={nothing}
      onSubmit={() =>
        progress.mutate(
          {
            id: task.id,
            ...(percent !== '' ? { percent: Number(percent) } : {}),
            ...(spent !== '' ? { spent_minutes: toMinutes(spent, unit) ?? 0 } : {}),
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          },
          {
            onSuccess: () => {
              toast.success('Status update posted');
              onClose();
            },
            onError: fail,
          },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="% work done" htmlFor={pid}>
          <Input id={pid} type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 60" />
        </Field>
        <EffortInput label="Total effort spent so far" value={spent} onChange={setSpent} unit={unit} onUnit={setUnit} />
      </div>
      <ProofreadText label="Comments" value={comment} onChange={setComment} rows={2} placeholder="e.g. waiting on vendor confirmation" />
    </FormDialog>
  );
}

// ─── Daily log ────────────────────────────────────────────────────────────

function DayLogDialog({ task, day, onClose }: { task: TaskLike; day: DayLogDay; onClose: () => void }) {
  const save = useSaveDayLog();
  const entry = day.entry;
  const pid = useId();
  const [did, setDid] = useState(entry?.did ?? '');
  const [plan, setPlan] = useState(entry?.plan_tomorrow ?? '');
  const [percent, setPercent] = useState(entry?.percent_done != null ? String(entry.percent_done) : '');
  const [mins, setMins] = useState(entry?.minutes_spent ? String(entry.minutes_spent) : '');
  const [unit, setUnit] = useState<EffortUnit>('minutes');
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${entry ? 'Edit' : 'Add'} day log — ${day.label}`}
      description={`${task.title} · one entry per day, so posting again replaces this one. Everybody who can see the task can read it.`}
      submitLabel={entry ? 'Save this day' : 'Save day log'}
      submitting={save.isPending}
      disabled={did.trim().length < 5}
      onSubmit={() =>
        save.mutate(
          {
            id: task.id,
            date: day.date,
            did: did.trim(),
            ...(plan.trim() ? { plan_tomorrow: plan.trim() } : {}),
            ...(percent !== '' ? { percent_done: Number(percent) } : {}),
            ...(mins !== '' ? { minutes_spent: toMinutes(mins, unit) ?? 0 } : {}),
          },
          {
            onSuccess: () => {
              toast.success('Day log saved');
              onClose();
            },
            onError: fail,
          },
        )
      }
    >
      <ProofreadText label="What I did today" required value={did} onChange={setDid} rows={3} autoFocus placeholder="e.g. Called four vendors and collected two revised quotes" />
      <ProofreadText label="Plan for tomorrow" value={plan} onChange={setPlan} rows={2} placeholder="e.g. Chase the remaining two and compare the pricing" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="% done at end of day" htmlFor={pid}>
          <Input id={pid} type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 60" />
        </Field>
        <EffortInput label="Time spent today" hint="This one day only, not the running total." value={mins} onChange={setMins} unit={unit} onUnit={setUnit} />
      </div>
    </FormDialog>
  );
}

// ─── Request a change (or an admin edit) ──────────────────────────────────

function RequestChangeDialog({ task, onClose, onDeleted }: { task: TaskLike; onClose: () => void; onDeleted?: () => void }) {
  const access = useAccess();
  const isAdmin = access.tasks.can('tasks.view_all');
  const me = access.tasks.me;
  // An admin edit gives the task directly (only people they may give tasks to); a request only proposes a new
  // person, and whoever approves it needs "Give tasks to others", so anyone can be proposed.
  const assignees = useTaskAssignees().data;
  const everyone = useTeamPeople().data;
  const team = (isAdmin ? assignees : everyone) ?? [];
  const request = useRequestTaskChange();
  const edit = useEditTask();
  const del = useDeleteTask();
  const ids = { due: useId(), prio: useId(), effort: useId(), assignee: useId(), title: useId(), stop: useId(), cancel: useId() };
  const [f, setF] = useState({ due_at: '', priority: '', effort: '', title: '', stop_recurring: false, cancel: false, assigned_to: '', reason: '' });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const approver = task.created_by_detail?.id === me?.id ? 'an admin' : 'the task creator';
  const past = !!f.due_at && new Date(f.due_at) <= new Date();
  const busy = request.isPending || edit.isPending || del.isPending;

  const submit = () => {
    const changes: Record<string, unknown> = {};
    if (f.cancel) changes.cancel = true;
    else {
      if (f.due_at) changes.due_at = new Date(f.due_at).toISOString();
      if (f.priority) changes.priority = f.priority;
      if (f.effort) changes.effort_minutes = Number(f.effort);
      if (f.title.trim()) changes.title = f.title.trim();
      if (f.stop_recurring) changes.frequency = 'one_time';
      if (f.assigned_to) changes.assigned_to = Number(f.assigned_to);
    }
    if (!Object.keys(changes).length) {
      toast.error('Pick at least one change.');
      return;
    }
    const done = (msg: string) => () => {
      toast.success(msg);
      onClose();
    };
    if (isAdmin) {
      if (changes.cancel) del.mutate(task.id, { onSuccess: () => (toast.success(`${task.code} moved to Deleted`), onDeleted?.(), onClose()), onError: fail });
      else edit.mutate({ id: task.id, ...changes }, { onSuccess: done('Task updated'), onError: fail });
    } else {
      request.mutate({ id: task.id, changes, reason: f.reason.trim() }, { onSuccess: done('Change request sent'), onError: fail });
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      wide
      title={isAdmin ? `Edit task — ${task.code}` : `Request a change — ${task.code}`}
      description={
        <>
          {task.title} ·{' '}
          {isAdmin ? (
            'admin edit: applies immediately and is logged in the task activity.'
          ) : (
            <>
              approved by <strong>{approver}</strong>, logged for admin.
            </>
          )}
        </>
      }
      submitLabel={isAdmin ? 'Apply changes' : 'Send request'}
      submitting={busy}
      disabled={!isAdmin && !f.reason.trim()}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New due date" htmlFor={ids.due} error={past ? 'That time has already passed — check AM/PM.' : undefined}>
          <Input id={ids.due} type="datetime-local" value={f.due_at} min={nowForInput()} disabled={f.cancel} onChange={(e) => set('due_at', e.target.value)} />
        </Field>
        <Field label="New priority" htmlFor={ids.prio}>
          <NativeSelect id={ids.prio} value={f.priority} disabled={f.cancel} onChange={(e) => set('priority', e.target.value)}>
            <option value="">— keep —</option>
            {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="New effort (minutes)" htmlFor={ids.effort}>
          <Input id={ids.effort} type="number" min={1} value={f.effort} disabled={f.cancel} onChange={(e) => set('effort', e.target.value)} />
        </Field>
        <Field label="Reassign to" htmlFor={ids.assignee}>
          <NativeSelect id={ids.assignee} value={f.assigned_to} disabled={f.cancel} onChange={(e) => set('assigned_to', e.target.value)}>
            <option value="">— keep —</option>
            {team.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="New title" htmlFor={ids.title} className="sm:col-span-2">
          <Input id={ids.title} value={f.title} placeholder="— keep —" disabled={f.cancel} onChange={(e) => set('title', e.target.value)} />
        </Field>
        {task.frequency !== 'one_time' && (
          <div className="flex items-center gap-2">
            <Checkbox id={ids.stop} checked={f.stop_recurring} disabled={f.cancel} onCheckedChange={(v) => set('stop_recurring', v === true)} />
            <Label htmlFor={ids.stop}>Stop the recurrence</Label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Checkbox id={ids.cancel} checked={f.cancel} onCheckedChange={(v) => set('cancel', v === true)} />
          <Label htmlFor={ids.cancel}>Cancel this task entirely</Label>
        </div>
      </div>
      {!isAdmin && <ProofreadText label="Reason" required value={f.reason} onChange={(v) => set('reason', v)} rows={2} placeholder="e.g. Deadline was set to midnight by mistake" />}
    </FormDialog>
  );
}

// ─── Small ones ────────────────────────────────────────────────────────────

function StepDoneDialog({ taskId, step, onClose }: { taskId: number; step: { id: number; text: string }; onClose: () => void }) {
  const tick = useTaskStep();
  const [note, setNote] = useState('');
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Step done"
      description={step.text}
      submitLabel="Mark done"
      submitting={tick.isPending}
      disabled={note.trim().length < 5}
      onSubmit={() => tick.mutate({ id: taskId, item: step.id, note: note.trim() }, { onSuccess: onClose, onError: fail })}
    >
      <ProofreadText label="What did you do?" required value={note} onChange={setNote} rows={3} autoFocus placeholder="e.g. Collected the invoice copy and filed it under Aug" />
    </FormDialog>
  );
}

function EstimateDialog({ task, onClose }: { task: TaskLike; onClose: () => void }) {
  const estimate = useTaskEstimate();
  const id = useId();
  const [minutes, setMinutes] = useState('');
  const n = Number(minutes);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Your estimate — ${task.code}`}
      description={`${task.title}${task.effort_minutes ? ` · the assigner said ${fmtEffort(task.effort_minutes)}` : ''}. Disagree with the effort? Record your own.`}
      submitLabel="Save estimate"
      submitting={estimate.isPending}
      disabled={!minutes || !(n > 0)}
      onSubmit={() =>
        estimate.mutate(
          { id: task.id, minutes: Math.round(n) },
          {
            onSuccess: () => {
              toast.success('Estimate saved');
              onClose();
            },
            onError: fail,
          },
        )
      }
    >
      <Field label="Your estimate (minutes)" htmlFor={id}>
        <Input id={id} type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus />
      </Field>
    </FormDialog>
  );
}

/** "due date → 8 Oct, 5:00 pm · effort → 1h" for a change request without the server's own wording. */
export function describeChanges(r: Pick<TaskChangeRequest, 'changes' | 'changes_display'>): string[] {
  if (r.changes_display?.length) return r.changes_display;
  const LABELS: Record<string, string> = { due_at: 'due date', effort_minutes: 'effort', priority: 'priority', title: 'title', description: 'description', frequency: 'recurrence', repeat_until: 'repeat-until', category: 'category', assigned_to: 'assignee' };
  return [
    Object.entries(r.changes)
      .map(([k, v]) => {
        if (k === 'cancel') return 'cancel the task';
        if (k === 'due_at' && v) return `due date → ${fmtDT(String(v))}`;
        if (k === 'effort_minutes') return `effort → ${fmtEffort(Number(v))}`;
        if (k === 'frequency' && v === 'one_time') return 'stop recurrence';
        return `${LABELS[k] ?? k} → ${String(v)}`;
      })
      .join(' · '),
  ];
}

// ─── one place that opens them ────────────────────────────────────────────

type TaskDialog =
  | { kind: 'complete' | 'progress' | 'request' | 'estimate'; task: TaskLike }
  | { kind: 'daylog'; task: TaskLike; day: DayLogDay }
  | { kind: 'step'; taskId: number; step: { id: number; text: string } };

/** The task dialogs a screen can open: `const d = useTaskDialogs(); d.open({kind:'complete', task}); …{d.element}`. */
export function useTaskDialogs(opts: { onDeleted?: () => void } = {}) {
  const [state, setState] = useState<TaskDialog | null>(null);
  const close = () => setState(null);
  let element: ReactNode = null;
  if (state?.kind === 'complete') element = <CompleteDialog key="c" task={state.task} onClose={close} />;
  else if (state?.kind === 'progress') element = <ProgressDialog key="p" task={state.task} onClose={close} />;
  else if (state?.kind === 'request') element = <RequestChangeDialog key="r" task={state.task} onClose={close} onDeleted={opts.onDeleted} />;
  else if (state?.kind === 'estimate') element = <EstimateDialog key="e" task={state.task} onClose={close} />;
  else if (state?.kind === 'daylog') element = <DayLogDialog key="d" task={state.task} day={state.day} onClose={close} />;
  else if (state?.kind === 'step') element = <StepDoneDialog key="s" taskId={state.taskId} step={state.step} onClose={close} />;
  return { open: setState, element };
}
