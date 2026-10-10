import { type AppKey, errorMessage } from '@freefounders/core';
import {
  type AppCatalogue,
  APP_NAMES,
  type Duty,
  DUTY_FREQUENCY_LABELS,
  type DutyFrequency,
  type Grant,
  LEVEL_LABELS,
  type Role,
  type Scope,
  SCOPE_LABELS,
  useSaveRole,
  WEEKDAYS,
} from '@freefounders/core/admin';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote } from './parts';

const key = (g: Pick<Grant, 'app' | 'permission'>) => `${g.app}:${g.permission}`;

const APP_HEADING: Record<string, string> = { tasks: 'text-app-tasks', assets: 'text-app-assets' };

/** New role / Edit <role> / view a locked role: name, level, the permission matrix with scopes, and duties. */
export function RoleEditor({ role, catalogue, onClose }: { role: Role | null; catalogue: AppCatalogue[]; onClose: () => void }) {
  const locked = !!role?.system;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [level, setLevel] = useState(role?.level ?? 1);
  const [grants, setGrants] = useState<Map<string, Grant>>(() => new Map((role?.grants ?? []).map((g) => [key(g), g])));
  const [duties, setDuties] = useState<Duty[]>(() => role?.duties ?? []);
  const [error, setError] = useState('');
  const save = useSaveRole();

  const groups = useMemo(
    () =>
      catalogue.map((c) => ({
        app: c.app,
        groups: [...new Set(c.permissions.map((p) => p.group))].map((g) => ({ name: g, permissions: c.permissions.filter((p) => p.group === g) })),
      })),
    [catalogue],
  );

  const toggle = (app: AppKey, permission: string, scopes: Scope[] | null) =>
    setGrants((prev) => {
      const next = new Map(prev);
      const k = key({ app, permission });
      if (next.has(k)) next.delete(k);
      // A newly ticked permission starts at the narrowest scope; widen it on purpose.
      else next.set(k, { app, permission, scope: scopes ? scopes[0] : '' });
      return next;
    });
  const setScope = (app: AppKey, permission: string, scope: Scope) => setGrants((prev) => new Map(prev).set(key({ app, permission }), { app, permission, scope }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (locked || !name.trim()) return;
    setError('');
    save.mutate(
      {
        id: role?.id,
        name: name.trim(),
        description: description.trim() || null,
        level,
        grants: [...grants.values()],
        duties: duties.map((d) => ({ ...d, steps: d.steps.map((st) => st.trim()).filter(Boolean) })),
      },
      { onSuccess: onClose, onError: (err) => setError(errorMessage(err)) },
    );
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
          <SheetHeader>
            <SheetTitle>{role ? (locked ? role.name : `Edit ${role.name}`) : 'New role'}</SheetTitle>
            <SheetDescription>
              {locked ? `${role?.description ?? ''} Duplicate it to make an editable copy.` : 'Tick what this role may do; pick how far each permission reaches.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="role-name">
                <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={locked} required maxLength={80} />
              </Field>
              <Field label="Level" htmlFor="role-level" hint="Admin level: an administrator in every app (work given to them is protected from deletion).">
                <NativeSelect id="role-level" value={level} onChange={(e) => setLevel(Number(e.target.value))} disabled={locked}>
                  {[1, 2, 3].map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABELS[l]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Description (optional)" htmlFor="role-description" className="sm:col-span-2">
                <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} maxLength={300} />
              </Field>
            </div>

            <div className="space-y-5">
              {groups.map((app) => (
                <section key={app.app} aria-label={`${APP_NAMES[app.app]} permissions`} className="overflow-hidden rounded-lg border shadow-card">
                  <h3 className={cn('flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm font-bold', APP_HEADING[app.app])}>
                    <AppChip app={app.app} />
                    <span className="sr-only">{APP_NAMES[app.app]}</span>
                    <span className="ml-auto font-mono text-[11px] font-medium text-muted-foreground">
                      {[...grants.values()].filter((g) => g.app === app.app).length} / {app.groups.reduce((n, g) => n + g.permissions.length, 0)} on
                    </span>
                  </h3>
                  <div className="divide-y">
                    {app.groups.map((g) => (
                      <div key={g.name} className="px-4 py-3">
                        <h4 className="mb-2 font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.name}</h4>
                        <ul className="space-y-1">
                          {g.permissions.map((p) => {
                            const grant = grants.get(key({ app: app.app, permission: p.key }));
                            const id = `perm-${app.app}-${p.key}`;
                            return (
                              <li key={p.key} className={cn('-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors', grant && 'bg-accent/40')}>
                                <span className="flex items-center gap-2.5">
                                  <Checkbox
                                    id={id}
                                    checked={!!grant}
                                    onCheckedChange={() => toggle(app.app, p.key, p.scopes)}
                                    disabled={locked}
                                    aria-label={`${APP_NAMES[app.app]}: ${p.label}`}
                                  />
                                  <label htmlFor={id} className={cn('cursor-pointer text-sm', grant && 'font-medium')}>
                                    {p.label}
                                  </label>
                                </span>
                                {p.scopes && grant && (
                                  <div role="radiogroup" aria-label={`Scope for ${p.label}`} className="inline-flex rounded-full border bg-card p-0.5 shadow-xs">
                                    {p.scopes.map((s) => (
                                      <button
                                        type="button"
                                        key={s}
                                        role="radio"
                                        aria-checked={grant.scope === s}
                                        disabled={locked}
                                        onClick={() => setScope(app.app, p.key, s)}
                                        className={cn(
                                          'cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed',
                                          grant.scope === s && 'bg-gradient-to-b from-brand-2 to-primary font-semibold text-primary-foreground shadow-xs',
                                        )}
                                      >
                                        {SCOPE_LABELS[s]}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Own</span> = only my records · <span className="font-semibold text-foreground">Team</span> = mine and my direct reports ·{' '}
                <span className="font-semibold text-foreground">Department</span> = everyone in my department · <span className="font-semibold text-foreground">Company</span> = everyone.
              </p>
            </div>

            {!locked && <DutiesEditor duties={duties} onChange={setDuties} />}
            <ErrorNote>{error}</ErrorNote>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {!locked && (
              <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
                Save role
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** What this role is responsible for: each duty becomes a task for everyone holding the role (PLAN.md §17.3). */
function DutiesEditor({ duties, onChange }: { duties: Duty[]; onChange: (d: Duty[]) => void }) {
  const update = (i: number, patch: Partial<Duty>) => onChange(duties.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <section aria-label="Duties" className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">Duties</h3>
          <p className="text-xs text-muted-foreground">Each duty becomes a task in Tasks for everyone with this role, at the time you choose. Steps become its checklist.</p>
        </div>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {duties.map((d, i) => {
        const n = i + 1;
        return (
          <fieldset key={d.id ?? `new-${i}`} className="relative grid gap-3 rounded-lg border bg-muted/20 p-4 pt-5">
            <legend className="sr-only">Duty {n}</legend>
            <span aria-hidden className="absolute -top-2.5 left-3 rounded-full border bg-card px-2 font-mono text-[11px] font-semibold tracking-wider text-primary uppercase">
              Duty {n}
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Duty" htmlFor={`duty-${i}-title`}>
                <Input id={`duty-${i}-title`} value={d.title} onChange={(e) => update(i, { title: e.target.value })} maxLength={150} required aria-label={`Duty ${n} title`} />
              </Field>
              <Field label="When" htmlFor={`duty-${i}-freq`}>
                <NativeSelect
                  id={`duty-${i}-freq`}
                  value={d.frequency}
                  aria-label={`Duty ${n} frequency`}
                  onChange={(e) => {
                    const frequency = e.target.value as DutyFrequency;
                    update(i, { frequency, weekday: frequency === 'weekly' ? (d.weekday ?? 0) : null, monthDay: frequency === 'monthly' ? (d.monthDay ?? 1) : null });
                  }}
                >
                  {(Object.keys(DUTY_FREQUENCY_LABELS) as DutyFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {DUTY_FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {d.frequency === 'weekly' && (
                <Field label="Day" htmlFor={`duty-${i}-day`}>
                  <NativeSelect id={`duty-${i}-day`} value={d.weekday ?? 0} onChange={(e) => update(i, { weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((w, k) => (
                      <option key={w} value={k}>
                        {w}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              {d.frequency === 'monthly' && (
                <Field label="Date" htmlFor={`duty-${i}-date`}>
                  <Input id={`duty-${i}-date`} type="number" min={1} max={28} value={d.monthDay ?? 1} onChange={(e) => update(i, { monthDay: Number(e.target.value) })} />
                </Field>
              )}
            </div>
            <Field label="Steps (one per line, optional)" htmlFor={`duty-${i}-steps`}>
              <Textarea
                id={`duty-${i}-steps`}
                rows={2}
                value={d.steps.join('\n')}
                onChange={(e) => update(i, { steps: e.target.value.split('\n').map((s) => s.trimStart()).filter((s, k, all) => s || k < all.length - 1) })}
                onBlur={(e) => update(i, { steps: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
            <div>
              <Button type="button" variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => onChange(duties.filter((_, j) => j !== i))}>
                <Trash2 /> Remove duty
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...duties, { title: '', steps: [], frequency: 'daily' }])}>
        <Plus /> Add duty
      </Button>
    </section>
  );
}
