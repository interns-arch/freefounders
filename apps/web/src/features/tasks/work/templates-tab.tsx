import { errorMessage, useAccess } from '@freefounders/core';
import {
  type DirectoryIndustry,
  type DirectoryTemplate,
  TASK_FREQUENCY_LABELS,
  TASK_PRIORITY_LABELS,
  type TaskFrequency,
  type TaskPriority,
  type TaskTemplate,
  useActiveGroups,
  useCreateTaskTemplate,
  useDeleteTaskTemplate,
  useDirectoryAddToTemplates,
  useDirectoryCreateTasks,
  useDirectoryIndustries,
  useDirectoryTemplates,
  useTaskTemplates,
  useTeamPeople,
} from '@freefounders/core/tasks';
import { ArrowLeft, Plus, Repeat, Search, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { ProofreadText } from '@/features/tasks/shared';
import { Chip, PRIORITY_TONE } from './task-bits';

const fail = (e: unknown) => toast.error(errorMessage(e));

// ─── Templates ─────────────────────────────────────────────────────────────

/** Reusable task blueprints; "Use" opens the Add task form filled from the template. */
export function TemplatesTab({ onUse }: { onUse: (t: TaskTemplate) => void }) {
  const canManage = useAccess().tasks.can('tasks.assign');
  const confirm = useConfirm();
  const q = useTaskTemplates();
  const del = useDeleteTaskTemplate();
  const [adding, setAdding] = useState(false);
  const grouped = useMemo(() => {
    const g: Record<string, TaskTemplate[]> = {};
    (q.data ?? []).forEach((t) => (g[t.category || 'General'] ||= []).push(t));
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [q.data]);

  return (
    <div className="max-w-4xl space-y-4">
      {canManage && (
        <Button onClick={() => setAdding(true)}>
          <Plus /> New template
        </Button>
      )}
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState title="No templates yet" description={canManage ? 'Create reusable task blueprints for your team.' : undefined} />
        </Card>
      ) : (
        grouped.map(([cat, list]) => (
          <section key={cat} className="space-y-2" aria-label={cat}>
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{cat}</h3>
            <Card className="overflow-hidden">
              <ul className="divide-y">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        {t.name}
                        {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABELS[t.priority] ?? t.priority}</Badge>}
                        {t.frequency !== 'one_time' && (
                          <Chip>
                            <Repeat /> {TASK_FREQUENCY_LABELS[t.frequency] ?? t.frequency}
                          </Chip>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t.title}
                        {t.description ? ` — ${t.description}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" aria-label={`Use template ${t.name}`} onClick={() => onUse(t)}>
                        Use
                      </Button>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Delete template ${t.name}`}
                          onClick={async () => {
                            if ((await confirm({ title: `Delete template "${t.name}"?`, confirmText: 'Delete', destructive: true })).confirmed) del.mutate(t.id, { onError: fail });
                          }}
                        >
                          <Trash2 /> Delete
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
      {adding && <TemplateDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function TemplateDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateTaskTemplate();
  const ids = { name: useId(), cat: useId(), title: useId(), prio: useId(), freq: useId() };
  const [f, setF] = useState({ name: '', category: '', title: '', description: '', priority: 'normal' as TaskPriority, frequency: 'one_time' as TaskFrequency });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const ok = !!f.name.trim() && !!f.title.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok)
              create.mutate(f, {
                onSuccess: () => {
                  toast.success('Template saved');
                  onClose();
                },
                onError: fail,
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>New task template</DialogTitle>
            <DialogDescription>A blueprint your team can turn into a task in one click.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template name" required htmlFor={ids.name}>
              <Input id={ids.name} value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field label="Category" htmlFor={ids.cat}>
              <Input id={ids.cat} value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Calls" />
            </Field>
            <Field label="Task title" required htmlFor={ids.title} className="sm:col-span-2">
              <Input id={ids.title} value={f.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <ProofreadText label="Description" value={f.description} rows={3} onChange={(v) => set('description', v)} />
            </div>
            <Field label="Priority" htmlFor={ids.prio}>
              <NativeSelect id={ids.prio} value={f.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => (
                  <option key={k} value={k}>
                    {TASK_PRIORITY_LABELS[k]}
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!ok}>
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template directory ───────────────────────────────────────────────────

/** Industry task template directory: industries → categories → templates; preview the steps, then use one. */
export function DirectoryTab() {
  const canManageTemplates = useAccess().tasks.can('tasks.assign');
  const industries = useDirectoryIndustries();
  const [industry, setIndustry] = useState<DirectoryIndustry | null>(null);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const templates = useDirectoryTemplates({ industry: industry?.id, category: category || undefined, search: q });

  if (industries.isLoading) return <Skeleton className="h-48" />;
  if (industries.error) return <ErrorState error={industries.error} onRetry={() => industries.refetch()} />;
  const browsing = !industry && !q.trim();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search all templates"
            placeholder="Search all templates…"
            className="pl-8"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (e.target.value) setIndustry(null);
            }}
          />
        </div>
        {industry && (
          <>
            <Button variant="outline" size="sm" onClick={() => (setIndustry(null), setCategory(''))}>
              <ArrowLeft /> All industries
            </Button>
            <NativeSelect aria-label="Category" className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {industry.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
      </div>
      {msg && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {msg}
        </p>
      )}

      {browsing ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(industries.data ?? []).map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => (setIndustry(i), setCategory(''))}
              className="flex cursor-pointer flex-col gap-1 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                <span className="text-xl" aria-hidden>
                  {i.icon}
                </span>
                {i.name}
              </span>
              {i.description && <span className="text-sm text-muted-foreground">{i.description}</span>}
              <span className="mt-1 text-xs text-muted-foreground">
                {i.template_count} template{i.template_count === 1 ? '' : 's'} · {i.categories.length} categor{i.categories.length === 1 ? 'y' : 'ies'}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="max-w-4xl space-y-2">
          {industry && (
            <h3 className="text-sm font-semibold">
              {industry.icon} {industry.name}
            </h3>
          )}
          <Card className="overflow-hidden">
            {templates.isLoading ? (
              <Skeleton className="m-4 h-24" />
            ) : (templates.data ?? []).length === 0 ? (
              <EmptyState title="No templates match." />
            ) : (
              <ul className="divide-y">
                {(templates.data ?? []).map((t) => (
                  <li key={t.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          {t.name}
                          <Chip>{t.category}</Chip>
                          {!industry && (
                            <Chip>
                              {t.industry_icon} {t.industry_name}
                            </Chip>
                          )}
                          {t.frequency !== 'one_time' && (
                            <Chip>
                              <Repeat /> {TASK_FREQUENCY_LABELS[t.frequency] ?? t.frequency}
                            </Chip>
                          )}
                          {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABELS[t.priority] ?? t.priority}</Badge>}
                        </div>
                        {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                        <p className="text-xs text-muted-foreground">
                          {t.step_count} step{t.step_count === 1 ? '' : 's'}
                          {t.tags?.length > 0 && ` · ${t.tags.join(', ')}`}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                        {open === t.id ? 'Hide' : 'Preview'}
                      </Button>
                    </div>
                    {open === t.id && (
                      <DirectoryTemplateDetail
                        tpl={t}
                        canManageTemplates={canManageTemplates}
                        onDone={(m) => {
                          setMsg(m);
                          setOpen(null);
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function DirectoryTemplateDetail({ tpl, canManageTemplates, onDone }: { tpl: DirectoryTemplate; canManageTemplates: boolean; onDone: (msg: string) => void }) {
  const team = useTeamPeople();
  const groups = useActiveGroups().data ?? [];
  const createTasks = useDirectoryCreateTasks();
  const addTemplates = useDirectoryAddToTemplates();
  const [assignee, setAssignee] = useState('');
  const [group, setGroup] = useState('');
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        {tpl.steps.map((s, i) => (
          <li key={i}>
            <strong>{s.title}</strong>
            {!!s.offset_days && s.offset_days > 0 && (
              <Badge tone="neutral" className="ml-1.5">
                day +{s.offset_days}
              </Badge>
            )}
            {s.description && <p className="text-muted-foreground">{s.description}</p>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {canManageTemplates && (
          <NativeSelect aria-label="Assign to" className="w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Assign to me</option>
            {(team.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {groups.length > 0 && (
          <NativeSelect aria-label="Group" className="w-auto" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          loading={createTasks.isPending}
          onClick={() =>
            createTasks.mutate(
              { id: tpl.id, ...(assignee ? { assigned_to: Number(assignee) } : {}), ...(group ? { group: Number(group) } : {}) },
              { onSuccess: (res) => onDone(`Created ${res.length} task(s) from "${tpl.name}".`), onError: fail },
            )
          }
        >
          Create {tpl.step_count} task{tpl.step_count === 1 ? '' : 's'}
        </Button>
        {canManageTemplates && (
          <Button variant="outline" loading={addTemplates.isPending} onClick={() => addTemplates.mutate(tpl.id, { onSuccess: (res) => onDone(`Added ${res.length} template(s) to your Task Templates.`), onError: fail })}>
            Add to my Task Templates
          </Button>
        )}
      </div>
    </div>
  );
}
