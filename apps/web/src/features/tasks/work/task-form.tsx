import { errorMessage, useAccess } from '@freefounders/core';
import {
  PartialCreateError,
  TASK_FREQUENCY_LABELS,
  TASK_PRIORITY_LABELS,
  type TaskFrequency,
  type TaskGroupOption,
  type TaskPriority,
  type TaskTemplate,
  type VoiceDraft,
  useActiveGroups,
  useAiTaskDraft,
  useCreateTaskCategory,
  useCreateTasks,
  useTaskAssignees,
  useTaskDepartments,
  useTaskFormCategories,
  useWorkloads,
} from '@freefounders/core/tasks';
import { ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, Kbd, NativeSelect } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { FilePick, MultiSelect, PickedFiles, ProofreadText, addFiles, fmtDT, nowForInput, toLocalInput, toMinutes } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { EffortInput, type EffortUnit } from './effort-input';
import { VoiceNote } from './voice-note';
import { WorkloadPanel } from './workload-panel';

interface Step {
  text: string;
  due_at: string;
}

/** "Add task": one task per picked person, with steps, people in the loop and reference files. */
export function TaskFormSheet({ template, onClose }: { template?: TaskTemplate | null; onClose: () => void }) {
  const access = useAccess();
  const me = access.tasks.me;
  const canAddCategory = access.tasks.can('tasks.assign');
  const team = useTaskAssignees().data ?? [];
  const groups = (useActiveGroups().data ?? []) as TaskGroupOption[];
  const departments = useTaskDepartments().data ?? [];
  const create = useCreateTasks();
  const ai = useAiTaskDraft();
  const addCategory = useCreateTaskCategory();
  const ids = { title: useId(), assign: useId(), due: useId(), category: useId(), dept: useId(), freq: useId(), until: useId(), prio: useId(), group: useId(), loop: useId(), ai: useId(), cat: useId() };

  const [f, setF] = useState({
    title: template?.title ?? '',
    description: template?.description ?? '',
    category: template?.category ?? '',
    frequency: (template?.frequency ?? 'one_time') as TaskFrequency,
    department: me?.department === 'management' ? '' : (me?.department ?? ''),
    group: '',
    priority: (template?.priority ?? 'normal') as TaskPriority,
    due_at: '',
    repeat_until: '',
    effort: '',
  });
  const [unit, setUnit] = useState<EffortUnit>('minutes');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const [assignees, setAssignees] = useState<number[]>([]); // nobody pre-picked
  const [fromGroup, setFromGroup] = useState<{ name: string; added: number; skipped: number } | null>(null);
  const [inLoop, setInLoop] = useState<number[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepDraft, setStepDraft] = useState<Step>({ text: '', due_at: '' });
  const [editIdx, setEditIdx] = useState(-1);
  const [editDraft, setEditDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [aiPrompt, setAiPrompt] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceDraft | null>(null);
  const [catBox, setCatBox] = useState<string | null>(null);
  const [catNote, setCatNote] = useState('');
  const [err, setErr] = useState('');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  const categories = useTaskFormCategories(f.department).data;
  // A category from another department is cleared when the department changes.
  useEffect(() => {
    if (categories && f.category && !categories.some((c) => c.name === f.category)) set('category', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  const workloads = useWorkloads(assignees);

  const pickGroup = (id: string) => {
    set('group', id);
    const g = groups.find((x) => String(x.id) === id);
    if (!g) return setFromGroup(null);
    const allowed = new Set(team.map((t) => t.id));
    const members = (g.members_detail ?? []).map((m) => m.id).filter((mid) => allowed.has(mid));
    setAssignees(members);
    setFromGroup({ name: g.name, added: members.length, skipped: (g.members_detail ?? []).length - members.length });
  };

  const applyVoice = (d: VoiceDraft) => {
    setVoice(d);
    setF((p) => ({
      ...p,
      title: d.title || p.title,
      description: d.description || p.description,
      due_at: d.due_at ? toLocalInput(d.due_at) : p.due_at,
      effort: d.effort_minutes ? String(d.effort_minutes) : p.effort,
    }));
    if (d.effort_minutes) setUnit('minutes');
    if (d.checklist?.length) setSteps((prev) => (prev.length ? prev : d.checklist!.map((text) => ({ text, due_at: '' }))));
    if (d.assigned_to) setAssignees([d.assigned_to]);
  };

  const runAi = () => {
    if (!aiPrompt?.trim()) return;
    setErr('');
    ai.mutate(aiPrompt, {
      onSuccess: (d) => {
        setF((p) => ({ ...p, title: d.title, description: d.description }));
        setSteps((prev) => [...prev, ...(d.checklist ?? []).map((text) => ({ text, due_at: '' }))].slice(0, 30));
        if (d.checklist?.length) setStepsOpen(true);
        setAiPrompt(null);
      },
      onError: (e) => setErr(errorMessage(e)),
    });
  };

  const submitCategory = () => {
    const name = (catBox ?? '').trim();
    if (!name) return;
    setErr('');
    setCatNote('');
    addCategory.mutate(
      { name, department: f.department },
      {
        onSuccess: (cat) => {
          setCatBox(null);
          if (cat.pending) setCatNote(`Sent — "${cat.name}" is waiting for your manager's approval.`);
          else set('category', cat.name);
        },
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  const addStep = () => {
    const text = stepDraft.text.trim();
    if (!text) return;
    setSteps((p) => [...p, { text, due_at: stepDraft.due_at }].slice(0, 30));
    setStepDraft({ text: '', due_at: '' });
  };
  const moveStep = (i: number, by: number) =>
    setSteps((prev) => {
      const j = i + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const saveEdit = () => {
    const text = editDraft.trim();
    if (!text) return;
    setSteps((p) => p.map((s, k) => (k === editIdx ? { ...s, text } : s)));
    setEditIdx(-1);
  };

  const effort = toMinutes(f.effort, unit);
  const past = !!f.due_at && new Date(f.due_at) <= new Date();
  const ready = !!f.title.trim() && !!f.description.trim() && !!f.category && !!effort && !!f.due_at && assignees.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!assignees.length) return setErr('Pick who this task is for — nobody is selected by default.');
    if (!ready) return setErr('Fill in every field marked *.');
    create.mutate(
      {
        task: {
          title: f.title,
          description: f.description,
          category: f.category,
          department: f.department,
          frequency: f.frequency,
          priority: f.priority,
          group: f.group ? Number(f.group) : null,
          due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
          repeat_until: f.frequency !== 'one_time' && f.repeat_until ? f.repeat_until : null,
          effort_minutes: effort,
        },
        assignees,
        steps,
        inLoop,
        files,
      },
      {
        onSuccess: (made) => {
          toast.success(made.length > 1 ? `${made.length} tasks created` : `${made[0]?.code ?? 'Task'} created`);
          onClose();
        },
        onError: (e) => setErr(e instanceof PartialCreateError ? e.message : errorMessage(e)),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <form
          className="flex h-full min-h-0 flex-col"
          onSubmit={submit}
          noValidate
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <SheetHeader>
            <SheetTitle>{template ? `New task from "${template.name}"` : 'Add task'}</SheetTitle>
            <SheetDescription>Each person you pick gets their own copy of the task.</SheetDescription>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <VoiceNote onDraft={applyVoice} disabled={create.isPending} />
              <Button type="button" variant="outline" size="sm" aria-expanded={aiPrompt !== null} title="Describe the task in your words — AI drafts title, description & steps" onClick={() => setAiPrompt((p) => (p === null ? '' : null))}>
                <Sparkles /> AI draft
              </Button>
            </div>
          </SheetHeader>
          <SheetBody className="space-y-5">
            {voice && (
              <div className="space-y-1 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
                <p>
                  <strong>Heard:</strong> “{voice.transcript}”
                </p>
                {(voice.assignee_heard || voice.due_heard) && (
                  <p className="text-warning">
                    {voice.assignee_heard && (
                      <>
                        Could not place the name <strong>“{voice.assignee_heard}”</strong> — pick the person below.{' '}
                      </>
                    )}
                    {voice.due_heard && <>The time it heard has already passed — set the due date below.</>}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Check every field before creating — this was filled in from speech.</p>
                <Button type="button" variant="link" size="xs" className="px-0" onClick={() => setVoice(null)}>
                  Hide
                </Button>
              </div>
            )}
            {aiPrompt !== null && (
              <div className="flex gap-2">
                <Input
                  id={ids.ai}
                  aria-label="Describe the task for the AI draft"
                  autoFocus
                  value={aiPrompt}
                  placeholder="e.g. Ravi ko brake pads ke baare mein call karo, phir quotation bhejo"
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runAi();
                    }
                  }}
                />
                <Button type="button" size="sm" className="h-9" loading={ai.isPending} onClick={runAi}>
                  Generate
                </Button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required htmlFor={ids.title} className="sm:col-span-2">
                <Input id={ids.title} value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus placeholder="e.g. Call Ravi with revised quote" />
              </Field>
              <div className="sm:col-span-2">
                <ProofreadText
                  label="Description"
                  required
                  value={f.description}
                  rows={4}
                  onChange={(v) => set('description', v)}
                  placeholder={'What exactly has to be done?\nPress Enter for a new line — write as many points as you need.'}
                />
              </div>
              <Field label="Assign to" required htmlFor={ids.assign} hint="Anyone in the company. Each person gets their own copy.">
                <MultiSelect
                  id={ids.assign}
                  options={team}
                  selected={assignees}
                  onChange={(v) => setAssignees(v)}
                  placeholder="— pick people —"
                />
                {fromGroup && (
                  <p className="text-xs text-muted-foreground">
                    {fromGroup.added} from <strong>{fromGroup.name}</strong>
                    {fromGroup.skipped > 0 && <> · {fromGroup.skipped} skipped (inactive)</>} — remove anyone who should not get this.
                  </p>
                )}
                {assignees.length === 0 && me && (
                  <Button type="button" variant="outline" size="xs" className="w-fit" onClick={() => setAssignees([me.id])}>
                    Assign to myself
                  </Button>
                )}
              </Field>
              <Field label={`Due${f.frequency !== 'one_time' ? ' (first occurrence)' : ''}`} required htmlFor={ids.due} error={past ? 'That time has already passed — check AM/PM.' : undefined}>
                <Input id={ids.due} type="datetime-local" value={f.due_at} min={nowForInput()} onChange={(e) => set('due_at', e.target.value)} />
              </Field>
              <EffortInput label="Effort" required hint="How long should this take?" value={f.effort} onChange={(v) => set('effort', v)} unit={unit} onUnit={setUnit} placeholder={unit === 'hours' ? 'e.g. 1.5' : 'required'} />
              <Field label="Category" required htmlFor={catBox === null ? ids.category : ids.cat}>
                {catBox === null ? (
                  <div className="flex gap-2">
                    <NativeSelect id={ids.category} value={f.category} onChange={(e) => set('category', e.target.value)}>
                      <option value="">— pick a category —</option>
                      {(categories ?? []).map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                          {c.department ? '' : ' (general)'}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="button" variant="outline" size="sm" className="h-9" title={canAddCategory ? 'Add a new category' : 'Ask your manager to add a new category'} onClick={() => setCatBox('')}>
                      <Plus /> {canAddCategory ? 'New' : 'Request'}
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <div className="flex gap-2">
                      <Input
                        id={ids.cat}
                        value={catBox}
                        autoFocus
                        placeholder={canAddCategory ? 'New category name' : 'Category you need…'}
                        onChange={(e) => setCatBox(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitCategory();
                          }
                        }}
                      />
                      <Button type="button" size="sm" className="h-9" loading={addCategory.isPending} onClick={submitCategory}>
                        {canAddCategory ? 'Add' : 'Send request'}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Cancel new category" onClick={() => setCatBox(null)}>
                        <X />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {canAddCategory ? 'It goes straight into the list for everyone.' : 'Your manager gets this and approves it — pick an existing category for now.'}
                    </p>
                  </div>
                )}
                {catNote && <p className="text-xs font-medium text-muted-foreground">{catNote}</p>}
              </Field>
              {workloads.length > 0 && (
                <div className="space-y-2 sm:col-span-2">
                  {workloads.map((w) => (
                    <WorkloadPanel key={w.user} w={w} />
                  ))}
                </div>
              )}
              <Field label="Department" htmlFor={ids.dept}>
                <NativeSelect id={ids.dept} value={f.department} onChange={(e) => set('department', e.target.value)}>
                  <option value="">General (no department)</option>
                  {departments
                    .filter((d) => d.active || d.code === f.department)
                    .map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="Frequency" htmlFor={ids.freq}>
                <NativeSelect id={ids.freq} value={f.frequency} onChange={(e) => set('frequency', e.target.value as TaskFrequency)}>
                  {(Object.keys(TASK_FREQUENCY_LABELS) as TaskFrequency[]).map((k) => (
                    <option key={k} value={k}>
                      {TASK_FREQUENCY_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {f.frequency !== 'one_time' && (
                <Field label="Repeat until" htmlFor={ids.until} hint="Optional — leave blank to repeat forever.">
                  <Input id={ids.until} type="date" value={f.repeat_until} onChange={(e) => set('repeat_until', e.target.value)} />
                </Field>
              )}
              <Field label="Priority" htmlFor={ids.prio}>
                <NativeSelect id={ids.prio} value={f.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                  {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => (
                    <option key={k} value={k}>
                      {TASK_PRIORITY_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Group" htmlFor={ids.group} hint="Picking one fills Assign to with its members.">
                <NativeSelect id={ids.group} value={f.group} onChange={(e) => pickGroup(e.target.value)}>
                  <option value="">None</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.member_count !== undefined ? ` (${g.member_count} member${g.member_count === 1 ? '' : 's'})` : ''}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Loop" htmlFor={ids.loop} hint="Colleagues who follow this task, but are not doing it.">
                <MultiSelect id={ids.loop} options={team.filter((a) => a.id !== me?.id)} selected={inLoop} onChange={setInLoop} placeholder="— optional —" />
              </Field>
            </div>

            <Collapsible
              open={stepsOpen}
              onToggle={() => setStepsOpen((v) => !v)}
              title="Steps to finish this task"
              summary={steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'} added` : 'optional — a big task is easier one step at a time'}
            >
              {steps.length > 0 && (
                <ol className="mb-3 space-y-1.5" aria-label="Steps">
                  {steps.map((s, i) => (
                    <li
                      key={i}
                      draggable={editIdx < 0}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                        if (Number.isNaN(from) || from === i) return;
                        setSteps((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(from, 1);
                          next.splice(i, 0, moved);
                          return next;
                        });
                      }}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm"
                    >
                      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                      <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{i + 1}.</span>
                      {editIdx === i ? (
                        <>
                          <Input
                            aria-label={`Edit step ${i + 1}`}
                            value={editDraft}
                            autoFocus
                            className="h-8 min-w-40 flex-1"
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                saveEdit();
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditIdx(-1);
                              }
                            }}
                          />
                          <Input
                            type="datetime-local"
                            aria-label={`Due time of step ${i + 1}`}
                            className="h-8 w-auto"
                            value={s.due_at}
                            onChange={(e) => setSteps((p) => p.map((x, k) => (k === i ? { ...x, due_at: e.target.value } : x)))}
                          />
                          <Button type="button" size="icon-xs" aria-label="Save step" disabled={!editDraft.trim()} onClick={saveEdit}>
                            <Check />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancel editing" onClick={() => setEditIdx(-1)}>
                            <X />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 break-words">
                            {s.text}
                            {s.due_at && <span className="ml-1.5 text-xs text-muted-foreground">· Due: {fmtDT(s.due_at)}</span>}
                          </span>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move step ${i + 1} up`} disabled={i === 0 || editIdx >= 0} onClick={() => moveStep(i, -1)}>
                            <ArrowUp />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1 || editIdx >= 0} onClick={() => moveStep(i, 1)}>
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Edit step ${i + 1}`}
                            disabled={editIdx >= 0}
                            onClick={() => {
                              setEditIdx(i);
                              setEditDraft(s.text);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove step ${i + 1}`} disabled={editIdx >= 0} onClick={() => setSteps((p) => p.filter((_, k) => k !== i))}>
                            <X />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="New step"
                  className="min-w-48 flex-1"
                  value={stepDraft.text}
                  placeholder="e.g. Collect the invoice copy from accounts"
                  onChange={(e) => setStepDraft((d) => ({ ...d, text: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addStep();
                    }
                  }}
                />
                <Input type="datetime-local" aria-label="Due time for this step" className="w-auto" value={stepDraft.due_at} onChange={(e) => setStepDraft((d) => ({ ...d, due_at: e.target.value }))} />
                <Button type="button" variant="outline" className="h-9" disabled={!stepDraft.text.trim()} onClick={addStep}>
                  <Plus /> Add step
                </Button>
              </div>
              {steps.length > 0 && <p className="mt-2 text-xs text-muted-foreground">The assignee ticks each step with a note on what they did, and can only mark the task complete once every step is done.</p>}
            </Collapsible>

            <Collapsible
              open={filesOpen}
              onToggle={() => setFilesOpen((v) => !v)}
              title="Attachments"
              summary={files.length ? `${files.length} file${files.length === 1 ? '' : 's'} attached` : 'optional — invoice, photo, anything they need'}
            >
              <FilePick onPick={(picked) => setFiles((p) => addFiles(p, picked))} />
              <PickedFiles files={files} onRemove={(i) => setFiles((p) => p.filter((_, k) => k !== i))} />
              <p className="mt-2 text-xs text-muted-foreground">Up to 5 files, 10 MB each. Everyone on the task can open them.</p>
            </Collapsible>

            {err && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {err}
              </p>
            )}
          </SheetBody>
          <SheetFooter>
            <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd> to create
            </span>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!ready}>
              {assignees.length > 1 ? `Create ${assignees.length} tasks` : 'Create task'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Collapsible({ open, onToggle, title, summary, children }: { open: boolean; onToggle: () => void; title: string; summary: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left">
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition', !open && '-rotate-90')} aria-hidden />
        <span className="text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </section>
  );
}
