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
import { ArrowLeft, LayoutTemplate, ListChecks, Plus, Repeat, Search, Trash2 } from '@/components/icons';
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
import { cn } from '@/lib/utils';
import { Chip, CountPill, PriorityPill, SectionHead } from './task-bits';

const fail = (e: unknown) => toast.error(errorMessage(e));

// ─── Templates ─────────────────────────────────────────────────────────────

/** Reusable task blueprints; "Use" opens the Add task form filled from the template. */
export function TemplatesTab({ onUse }: { onUse: (t: TaskTemplate) => void }) {
  const canManage = useAccess().tasks.can('templates.manage');
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
          <EmptyState icon={LayoutTemplate} title="No templates yet" description={canManage ? 'Create reusable task blueprints for your team, or pick some from the Template Directory.' : 'Your manager can add templates; the Template Directory has ready-made ones.'} />
        </Card>
      ) : (
        grouped.map(([cat, list]) => (
          <section key={cat} className="space-y-2" aria-label={cat}>
            <SectionHead title={cat} count={list.length} />
            <Card className="overflow-hidden">
              <ul className="divide-y">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">
                        {t.name}
                        {t.priority !== 'normal' && <PriorityPill priority={t.priority} label={TASK_PRIORITY_LABELS[t.priority] ?? t.priority} />}
                        {t.frequency !== 'one_time' && (
                          <Chip tone="indigo">
                            <Repeat /> {TASK_FREQUENCY_LABELS[t.frequency] ?? t.frequency}
                          </Chip>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
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
  const canManageTemplates = useAccess().tasks.can('templates.manage');
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

      {browsing && (industries.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={LayoutTemplate} title="The template directory is empty." description="Industry templates appear here once they are loaded; search above or build your own under Templates." />
        </Card>
      ) : browsing ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(industries.data ?? []).map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => (setIndustry(i), setCategory(''))}
              className="flex cursor-pointer gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition hover:border-primary/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xl" aria-hidden>
                {i.icon}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{i.name}</span>
                {i.description && <span className="text-[13px] text-muted-foreground">{i.description}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <CountPill tone="neutral">{i.template_count}</CountPill> template{i.template_count === 1 ? '' : 's'} · <CountPill tone="neutral">{i.categories.length}</CountPill> categor{i.categories.length === 1 ? 'y' : 'ies'}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="max-w-4xl space-y-2">
          {industry && (
            <SectionHead
              title={
                <>
                  <span aria-hidden>{industry.icon}</span> {industry.name}
                </>
              }
              count={templates.data?.length}
            />
          )}
          <Card className="overflow-hidden">
            {templates.isLoading ? (
              <Skeleton className="m-4 h-24" />
            ) : (templates.data ?? []).length === 0 ? (
              <EmptyState icon={Search} title="No templates match." description="Try another word, or clear the search to browse by industry." />
            ) : (
              <ul className="divide-y">
                {(templates.data ?? []).map((t) => (
                  <li key={t.id} className={cn('px-4 py-3 transition-colors', open === t.id ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">
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
                          {t.priority !== 'normal' && <PriorityPill priority={t.priority} label={TASK_PRIORITY_LABELS[t.priority] ?? t.priority} />}
                        </div>
                        {t.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{t.description}</p>}
                        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <ListChecks className="size-3.5" aria-hidden /> {t.step_count} step{t.step_count === 1 ? '' : 's'}
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
      <ol className="space-y-1.5 text-sm">
        {tpl.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 rounded-lg border bg-card px-3 py-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/8 font-mono text-[11px] font-semibold text-primary tabular">{i + 1}</span>
            <span className="min-w-0 flex-1">
            <strong className="font-semibold">{s.title}</strong>
            {!!s.offset_days && s.offset_days > 0 && (
              <Badge tone="neutral" className="ml-1.5">
                day +{s.offset_days}
              </Badge>
            )}
            {s.description && <p className="text-[13px] text-muted-foreground">{s.description}</p>}
            </span>
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
