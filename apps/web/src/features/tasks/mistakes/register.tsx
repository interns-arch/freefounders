/** The register tab: filters, the insights panel, one expandable row per mistake, and the "Log mistake" dialog. */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  MISTAKE_CLASSIFICATIONS,
  MISTAKE_LEVEL3_ACTIONS,
  MISTAKE_ROOT_CAUSES,
  MISTAKE_SEVERITIES,
  MISTAKE_STATUS_LABELS,
  type Mistake,
  type MistakeClassification,
  type MistakeFilters,
  type MistakeSeverity,
  type MistakeStatus,
  type MistakeSuggestion,
  useConfirmRepeat,
  useCreateCorrectiveTask,
  useExplainMistake,
  useMistakeDetail,
  useMistakeEvents,
  useMistakeSuggestion,
  useMistakes,
  useReviewMistake,
  useSops,
} from '@freefounders/core/tasks';
import { Flag, PartyPopper, Plus, Sparkles, TriangleAlert } from '@/components/icons';
import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, type Tone, fmtWhen } from '../general/parts';
import { rupees } from './format';
import { MistakeInsights } from './insights';
import { LogMistakeDialog } from './log-dialog';

const SEVERITY_TONE: Record<MistakeSeverity, Tone> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
const STATUS_TONE: Record<MistakeStatus, Tone> = { open: 'warning', explained: 'info', resolved: 'success' };

export function MistakeRegister() {
  const access = useAccess();
  const isAdmin = access.tasks.can('mistakes.review_all');
  const isManager = isAdmin || access.tasks.can('mistakes.review_department');
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<MistakeFilters>({ status: '', severity: '', important: false });
  const [openId, setOpenId] = useState<number | null>(() => (params.get('open') ? Number(params.get('open')) : null));
  const [showLog, setShowLog] = useState(false);
  const [logged, setLogged] = useState('');
  const q = useMistakes(filters);

  const toggle = (id: number) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    const p = new URLSearchParams(params);
    if (next) p.set('open', String(next));
    else p.delete('open');
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Status" className="w-auto" value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value as MistakeStatus | '' })}>
          <option value="">All statuses</option>
          {Object.entries(MISTAKE_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Severity" className="w-auto" value={filters.severity ?? ''} onChange={(e) => setFilters({ ...filters, severity: e.target.value as MistakeSeverity | '' })}>
          <option value="">All severities</option>
          {MISTAKE_SEVERITIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
        {isAdmin && (
          <Button
            type="button"
            size="sm"
            variant={filters.important ? 'default' : 'outline'}
            aria-pressed={!!filters.important}
            title="Critical / escalated / overdue / third occurrences only"
            onClick={() => setFilters({ ...filters, important: !filters.important })}
          >
            <Flag /> Action required
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="cta" onClick={() => setShowLog(true)}>
          <Plus /> Log mistake
        </Button>
      </div>
      <OkNote>{logged}</OkNote>
      {isManager && <MistakeInsights isAdmin={isAdmin} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-40" />}
      {q.data?.length === 0 && (
        <Card>
          <EmptyState icon={PartyPopper} title="Nothing here — clean register" description={filters.status || filters.severity || filters.important ? 'No mistake matches these filters.' : 'Mistakes you log, or that are logged for you, show here.'} />
        </Card>
      )}
      {!!q.data?.length && (
        <ul className="grid gap-2" aria-label="Mistakes">
          {q.data.map((m) => (
            <MistakeRow key={m.id} m={m} open={openId === m.id} onToggle={() => toggle(m.id)} />
          ))}
        </ul>
      )}
      <Dialog open={showLog} onOpenChange={(o) => !o && setShowLog(false)}>
        <DialogContent className="max-w-2xl">
          {showLog && (
            <LogMistakeDialog
              onClose={() => setShowLog(false)}
              onSaved={(m) => {
                setShowLog(false);
                setLogged(`${m.code} logged. ${m.employee_detail?.name ?? 'The person'} is asked to explain; a corrective task was created.`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MistakeRow({ m, open, onToggle }: { m: Mistake; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <Card className={cn('overflow-hidden', m.sla_overdue && m.status !== 'resolved' && 'border-destructive/40', m.severity === 'critical' && 'border-l-4 border-l-destructive')}>
        <button type="button" aria-expanded={open} aria-label={`${m.code} ${m.category}`} onClick={onToggle} className="block w-full cursor-pointer p-3 text-left sm:px-4">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
            <strong className="text-sm">{m.category}</strong>
            <Chip tone={SEVERITY_TONE[m.severity] ?? 'neutral'}>{m.severity_display}</Chip>
            <Chip tone={STATUS_TONE[m.status] ?? 'neutral'}>{m.status_display}</Chip>
            {m.occurrence_level > 1 && (
              <Chip tone="danger" title={`Occurrence ${m.occurrence_level}`}>
                ×{m.occurrence_level}
              </Chip>
            )}
            {m.escalation_level > 0 && <Chip tone="warning">↑ {m.escalation_level === 1 ? 'dept head' : 'founder'}</Chip>}
            {m.classification && <Chip>{m.classification_display}</Chip>}
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">{m.description}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {m.employee_detail?.name}
            {m.manager_detail && <> · manager: {m.manager_detail.name}</>}
            {m.financial_loss && <> · {rupees(m.financial_loss)} loss</>}
            {' · '}
            {fmtWhen(m.created_at)}
            {m.sla_due_at && m.status !== 'resolved' && <span className={cn(m.sla_overdue && 'font-semibold text-destructive')}> · SLA {m.sla_overdue ? 'missed' : `till ${fmtWhen(m.sla_due_at)}`}</span>}
          </span>
        </button>
        {open && <MistakeDetail m={m} />}
      </Card>
    </li>
  );
}

function LevelBanner({ m }: { m: Mistake }) {
  if (m.occurrence_level >= 3) {
    return (
      <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
        Third occurrence — performance escalation. Department-head action required.
      </p>
    );
  }
  if (m.occurrence_level === 2) {
    return (
      <p role="alert" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm font-medium text-warning">
        Repeat error detected (earlier: {m.repeat_of_code}). Root cause, corrective and preventive action are mandatory.
      </p>
    );
  }
  return null;
}

function MistakeDetail({ m }: { m: Mistake }) {
  const access = useAccess();
  const me = access.tasks.me;
  const detail = useMistakeDetail(m.id);
  const events = useMistakeEvents(m.id);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [repeatDecided, setRepeatDecided] = useState(false);
  const [editResponse, setEditResponse] = useState(false);
  const isEmployee = m.employee_detail?.id === me?.id;
  const isReviewer = !isEmployee && (access.tasks.can('mistakes.review_all') || m.manager_detail?.id === me?.id || access.tasks.can('mistakes.review_department'));
  const candidates = detail.data?.possible_repeats ?? [];
  const note = (e: unknown) => {
    setOk('');
    setErr(errorMessage(e));
  };
  const done = (text: string) => {
    setErr('');
    setOk(text);
  };

  return (
    <div className="space-y-3 border-t px-3 pt-3 pb-3 sm:px-4">
      <LevelBanner m={m} />
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{ok}</OkNote>
      {m.impact && (
        <p className="text-sm">
          <strong>Impact:</strong> {m.impact}
        </p>
      )}
      {m.explanation && (
        <p className="text-sm">
          <strong>Explanation:</strong> {m.explanation}
          {m.root_cause_display && (
            <>
              {' · '}
              <strong>Root cause:</strong> {m.root_cause_display}
              {m.root_cause_note && ` (${m.root_cause_note})`}
            </>
          )}
          {m.corrective_action && (
            <>
              <br />
              <strong>Corrective:</strong> {m.corrective_action}
            </>
          )}
          {m.preventive_action && (
            <>
              <br />
              <strong>Preventive:</strong> {m.preventive_action}
            </>
          )}
        </p>
      )}
      {m.sop_name && (
        <p className="text-sm text-muted-foreground">
          SOP: {m.sop_name} {m.sop_version && `v${m.sop_version}`}
          {m.sop_followed != null && <> · followed: {m.sop_followed ? 'yes' : 'NO — employee side'}</>}
          {m.sop_adequate != null && <> · adequate: {m.sop_adequate ? 'yes' : 'NO — fix the process, not the person'}</>}
        </p>
      )}
      {m.corrective_task_code && (
        <p className="text-sm text-muted-foreground">
          Corrective task:{' '}
          {m.corrective_task ? (
            <Link to={`/tasks/tasks/${m.corrective_task}`} className="font-semibold text-primary hover:underline">
              {m.corrective_task_code}
            </Link>
          ) : (
            <strong>{m.corrective_task_code}</strong>
          )}{' '}
          ({m.corrective_task_status})
        </p>
      )}
      {m.manager_remarks && (
        <p className="text-sm">
          <strong>Manager:</strong> {m.manager_remarks}
          {m.level3_action_display && (
            <>
              {' · '}
              <strong>Action:</strong> {m.level3_action_display}
              {m.level3_action_note && ` (${m.level3_action_note})`}
            </>
          )}
        </p>
      )}
      {m.reported_by_detail && <p className="text-xs text-muted-foreground">Logged by {m.reported_by_detail.name}</p>}

      {isEmployee && m.status === 'explained' && !editResponse && (
        <Button type="button" size="sm" variant="outline" onClick={() => setEditResponse(true)}>
          Update your response
        </Button>
      )}
      {isEmployee && m.status !== 'resolved' && (m.status === 'open' || editResponse) && (
        <ExplainForm
          m={m}
          onError={note}
          onDone={() => {
            setEditResponse(false);
            done('Your response is saved. Your manager reviews it next.');
          }}
        />
      )}
      {isReviewer && candidates.length > 0 && !m.repeat_of && !repeatDecided && (
        <RepeatPrompt
          m={m}
          candidates={candidates}
          onError={note}
          onDone={(same) => {
            setRepeatDecided(true);
            done(same ? 'Linked as a repeat of the earlier mistake.' : 'Noted as a different error.');
          }}
        />
      )}
      {isReviewer && m.status !== 'resolved' && <ReviewForm m={m} onError={note} onDone={done} />}

      {!!events.data?.length && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">History ({events.data.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-3 text-xs text-muted-foreground">
            {events.data.map((ev) => (
              <li key={ev.id}>
                {fmtWhen(ev.created_at)} — {ev.actor?.name || 'System'}: {ev.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Level 1: the employee's structured response. */
function ExplainForm({ m, onError, onDone }: { m: Mistake; onError: (e: unknown) => void; onDone: () => void }) {
  const id = useId();
  const explain = useExplainMistake();
  const [f, setF] = useState({ explanation: '', root_cause: '', root_cause_note: '', corrective_action: '', preventive_action: '' });
  const needsCapa = m.occurrence_level >= 2;
  const ready = !!f.explanation.trim() && !!f.root_cause && (!needsCapa || (!!f.corrective_action.trim() && !!f.preventive_action.trim()));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    explain.mutate({ id: m.id, ...f }, { onSuccess: onDone, onError });
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-muted/40 p-3" aria-label="Your response">
      <p className="text-sm font-semibold">Your response</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-exp`}>What happened? *</Label>
        <Textarea id={`${id}-exp`} rows={3} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} placeholder="'Mistake happened' is not an explanation — say what actually went wrong" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-rc`}>Root cause *</Label>
          <NativeSelect id={`${id}-rc`} value={f.root_cause} onChange={(e) => setF({ ...f, root_cause: e.target.value })}>
            <option value="">— pick —</option>
            {MISTAKE_ROOT_CAUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-rcn`}>Root cause detail</Label>
          <Input id={`${id}-rcn`} value={f.root_cause_note} onChange={(e) => setF({ ...f, root_cause_note: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-ca`}>Corrective action {needsCapa && '*'} (fix it now)</Label>
          <Input id={`${id}-ca`} value={f.corrective_action} onChange={(e) => setF({ ...f, corrective_action: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-pa`}>Preventive action {needsCapa && '*'} (never again)</Label>
          <Input id={`${id}-pa`} value={f.preventive_action} onChange={(e) => setF({ ...f, preventive_action: e.target.value })} />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={!ready} loading={explain.isPending}>
        Submit response
      </Button>
    </form>
  );
}

/** The system suggests a repeat; a human confirms "same error" or "different error". */
function RepeatPrompt({
  m,
  candidates,
  onError,
  onDone,
}: {
  m: Mistake;
  candidates: Array<{ id: number; code: string; description: string; created_at: string }>;
  onError: (e: unknown) => void;
  onDone: (same: boolean) => void;
}) {
  const confirm = useConfirmRepeat();
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3" role="group" aria-label="Possible repeat">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <TriangleAlert className="size-4 text-warning" /> Possible repeat — is this the same error as before?
      </p>
      {candidates.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1">
            <strong>{c.code}</strong> · {c.description} ({fmtWhen(c.created_at)})
          </span>
          <Button size="xs" aria-label={`Same error as ${c.code}`} loading={confirm.isPending} onClick={() => confirm.mutate({ id: m.id, repeat_of: c.id }, { onSuccess: () => onDone(true), onError })}>
            Same error
          </Button>
        </div>
      ))}
      <Button size="xs" variant="outline" loading={confirm.isPending} onClick={() => confirm.mutate({ id: m.id, repeat_of: null }, { onSuccess: () => onDone(false), onError })}>
        Different error
      </Button>
    </div>
  );
}

/** Level 2/3: the manager's review — a decision, not a click. */
function ReviewForm({ m, onError, onDone }: { m: Mistake; onError: (e: unknown) => void; onDone: (text: string) => void }) {
  const id = useId();
  const review = useReviewMistake();
  const createTask = useCreateCorrectiveTask();
  const suggest = useMistakeSuggestion();
  const sops = useSops().data ?? [];
  const [f, setF] = useState({
    classification: (m.classification || '') as MistakeClassification | '',
    manager_remarks: m.manager_remarks || '',
    sop_name: m.sop_name || '',
    sop_followed: m.sop_followed,
    sop_adequate: m.sop_adequate,
    level3_action: m.level3_action || '',
    level3_action_note: m.level3_action_note || '',
  });
  const [hint, setHint] = useState<MistakeSuggestion | null>(null);
  const [task, setTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [dueDays, setDueDays] = useState('1');
  // Keep the form in step when the record changes under it (another reviewer, a refetch).
  useEffect(() => {
    setF((p) => ({ ...p, classification: (m.classification || p.classification) as MistakeClassification | '', manager_remarks: m.manager_remarks || p.manager_remarks }));
  }, [m.classification, m.manager_remarks]);

  const yesNo = (v: boolean | null) => (v == null ? '' : v ? 'yes' : 'no');
  const fromYesNo = (v: string) => (v === '' ? null : v === 'yes');
  const save = (resolve: boolean) =>
    review.mutate({ id: m.id, ...f, resolve }, { onSuccess: () => onDone(resolve ? `${m.code} resolved.` : 'Review saved.'), onError });
  const askSuggestion = () =>
    suggest.mutate(m.id, { onSuccess: setHint, onError: () => setHint({ reasoning: 'Could not fetch a suggestion right now.' }) });
  const useHint = () =>
    hint &&
    setF((p) => ({
      ...p,
      classification: hint.classification || p.classification,
      manager_remarks: p.manager_remarks || `Corrective: ${hint.corrective_action ?? ''} Preventive: ${hint.preventive_action ?? ''}`.trim(),
    }));

  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3" role="group" aria-label="Manager review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Manager review — a review is a decision, not a click</p>
        <Button type="button" size="xs" variant="outline" onClick={askSuggestion} loading={suggest.isPending} title="Suggests a classification and corrective / preventive action — you still decide">
          <Sparkles /> Suggest
        </Button>
      </div>
      {hint && (
        <div className="space-y-1 rounded-md border border-info/30 bg-info/10 p-2.5 text-sm" role="status">
          {hint.classification && (
            <p>
              <strong>Suggested:</strong> {MISTAKE_CLASSIFICATIONS.find(([v]) => v === hint.classification)?.[1]}
            </p>
          )}
          {hint.reasoning && <p>{hint.reasoning}</p>}
          {hint.corrective_action && (
            <p>
              <strong>Corrective:</strong> {hint.corrective_action}
            </p>
          )}
          {hint.preventive_action && (
            <p>
              <strong>Preventive:</strong> {hint.preventive_action}
            </p>
          )}
          {hint.classification && (
            <p className="flex items-center gap-2">
              <Button type="button" size="xs" variant="outline" onClick={useHint}>
                Use suggestion
              </Button>
              {hint.provider && <span className="text-xs text-muted-foreground">({hint.provider})</span>}
            </p>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-cls`}>What failed? *</Label>
          <NativeSelect id={`${id}-cls`} value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as MistakeClassification | '' })}>
            <option value="">— classify —</option>
            {MISTAKE_CLASSIFICATIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-sop`}>SOP name (if any)</Label>
          <Input id={`${id}-sop`} list={`${id}-sops`} value={f.sop_name} onChange={(e) => setF({ ...f, sop_name: e.target.value })} />
          <datalist id={`${id}-sops`}>
            {sops.map((s) => (
              <option key={s.id} value={s.title} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-sf`}>SOP followed?</Label>
          <NativeSelect id={`${id}-sf`} value={yesNo(f.sop_followed)} onChange={(e) => setF({ ...f, sop_followed: fromYesNo(e.target.value) })}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No — employee side</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-sa`}>SOP adequate?</Label>
          <NativeSelect id={`${id}-sa`} value={yesNo(f.sop_adequate)} onChange={(e) => setF({ ...f, sop_adequate: fromYesNo(e.target.value) })}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No — fix the process</option>
          </NativeSelect>
        </div>
        {m.occurrence_level >= 3 && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-l3`}>Level-3 action * (human decision)</Label>
              <NativeSelect id={`${id}-l3`} value={f.level3_action} onChange={(e) => setF({ ...f, level3_action: e.target.value })}>
                <option value="">— decide —</option>
                {MISTAKE_LEVEL3_ACTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-l3n`}>Action note</Label>
              <Input id={`${id}-l3n`} value={f.level3_action_note} onChange={(e) => setF({ ...f, level3_action_note: e.target.value })} />
            </div>
          </>
        )}
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-rem`}>Remarks / decision *</Label>
          <Textarea id={`${id}-rem`} rows={2} value={f.manager_remarks} onChange={(e) => setF({ ...f, manager_remarks: e.target.value })} placeholder="training / SOP change / system fix / no action because…" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" loading={review.isPending} onClick={() => save(false)}>
          Save review
        </Button>
        <Button type="button" size="sm" loading={review.isPending} onClick={() => save(true)}>
          Save &amp; resolve
        </Button>
        {!m.corrective_task_code && !task && (
          <Button type="button" size="sm" variant="outline" onClick={() => setTask(true)}>
            <Plus /> Corrective task
          </Button>
        )}
      </div>
      {task && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-2.5">
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor={`${id}-tt`}>Corrective task title</Label>
            <Input id={`${id}-tt`} placeholder={`Audit: ${m.category}`} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
          </div>
          <div className="grid w-24 gap-1.5">
            <Label htmlFor={`${id}-dd`}>Due in days</Label>
            <Input id={`${id}-dd`} type="number" min={1} max={60} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </div>
          <Button
            type="button"
            size="sm"
            loading={createTask.isPending}
            onClick={() =>
              createTask.mutate(
                { id: m.id, title: taskTitle.trim() || `Audit: ${m.category}`, due_days: Math.max(1, Math.min(60, Number(dueDays) || 1)) },
                {
                  onSuccess: (r) => {
                    setTask(false);
                    onDone(`Corrective task ${r.corrective_task_code} created.`);
                  },
                  onError,
                },
              )
            }
          >
            Create task
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTask(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
