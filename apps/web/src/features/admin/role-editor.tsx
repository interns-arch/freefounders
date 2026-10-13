import { errorMessage } from '@freefounders/core';
import {
  type AppCatalogue,
  type CataloguePermission,
  type Duty,
  DUTY_FREQUENCY_LABELS,
  type DutyFrequency,
  type Grant,
  GRANT_APP_NAMES,
  type GrantApp,
  LEVEL_HINTS,
  LEVEL_LABELS,
  type Role,
  type Scope,
  SCOPE_LABELS,
  useSaveRole,
  WEEKDAYS,
} from '@freefounders/core/admin';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Field } from '@/components/common/form';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote } from './parts';

const key = (g: Pick<Grant, 'app' | 'permission'>) => `${g.app}:${g.permission}`;

const APP_HEADING: Record<string, string> = { tasks: 'text-app-tasks', assets: 'text-app-assets', platform: 'text-app-admin' };

const matches = (p: CataloguePermission, term: string) =>
  !term || `${p.label} ${p.description ?? ''} ${p.group} ${p.key}`.toLowerCase().includes(term);

/**
 * New role / Edit <role> / view the locked Owner role (PLAN.md §15, §19.19): name, level (with what it really does),
 * every permission of every app grouped like the menus (search, select all / clear per app and per group, a line
 * under each permission, a scope next to the scoped ones), and duties. A new role starts blank or as a copy of another.
 */
export function RoleEditor({ role, catalogue, roles = [], onClose }: { role: Role | null; catalogue: AppCatalogue[]; roles?: Role[]; onClose: () => void }) {
  const locked = !!role?.system;
  const [name, setName] = useState(role?.name ?? '');
  const [nameError, setNameError] = useState('');
  const [description, setDescription] = useState(role?.description ?? '');
  const [level, setLevel] = useState(role?.level ?? 1);
  const [grants, setGrants] = useState<Map<string, Grant>>(() => new Map((role?.grants ?? []).map((g) => [key(g), g])));
  const [duties, setDuties] = useState<Duty[]>(() => role?.duties ?? []);
  const [copiedFrom, setCopiedFrom] = useState('');
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const save = useSaveRole();
  const term = search.trim().toLowerCase();

  const apps = useMemo(
    () =>
      catalogue.map((c) => ({
        app: c.app,
        all: c.permissions,
        groups: [...new Set(c.permissions.map((p) => p.group))].map((g) => ({ name: g, permissions: c.permissions.filter((p) => p.group === g) })),
      })),
    [catalogue],
  );
  const known = useMemo(() => new Set(catalogue.flatMap((c) => c.permissions.map((p) => key({ app: c.app, permission: p.key })))), [catalogue]);

  const toggle = (app: GrantApp, p: CataloguePermission) =>
    setGrants((prev) => {
      const next = new Map(prev);
      const k = key({ app, permission: p.key });
      if (next.has(k)) next.delete(k);
      // A newly ticked permission starts at the narrowest scope; widen it on purpose.
      else next.set(k, { app, permission: p.key, scope: p.scopes ? p.scopes[0] : '' });
      return next;
    });
  /** Ticks (or clears) every listed permission; ones already ticked keep their scope. */
  const setMany = (app: GrantApp, list: CataloguePermission[], on: boolean) =>
    setGrants((prev) => {
      const next = new Map(prev);
      for (const p of list) {
        const k = key({ app, permission: p.key });
        if (!on) next.delete(k);
        else if (!next.has(k)) next.set(k, { app, permission: p.key, scope: p.scopes ? p.scopes[0] : '' });
      }
      return next;
    });
  const setScope = (app: GrantApp, permission: string, scope: Scope) => setGrants((prev) => new Map(prev).set(key({ app, permission }), { app, permission, scope }));
  const onCount = (app: GrantApp, list: CataloguePermission[]) => list.filter((p) => grants.has(key({ app, permission: p.key }))).length;
  const flip = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyFrom = (id: string) => {
    setCopiedFrom(id);
    const from = roles.find((r) => r.id === id);
    if (!from) {
      setGrants(new Map());
      setLevel(1);
      return;
    }
    setGrants(new Map(from.grants.map((g) => [key(g), g])));
    setLevel(from.system ? 3 : from.level);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    if (!name.trim()) {
      setNameError('Give the role a name');
      nameRef.current?.focus();
      return;
    }
    setError('');
    save.mutate(
      {
        id: role?.id,
        name: name.trim(),
        description: description.trim() || null,
        level,
        // Only what the apps offer today (an old, retired permission is dropped when the role is saved).
        grants: [...grants.values()].filter((g) => known.has(key(g))),
        duties: duties.map((d) => ({ ...d, steps: d.steps.map((st) => st.trim()).filter(Boolean) })),
      },
      { onSuccess: onClose, onError: (err) => setError(errorMessage(err)) },
    );
  };

  const total = grants.size;
  const copyable = roles.filter((r) => !r.archived);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl">
        <form className="flex h-full min-h-0 flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>{role ? (locked ? role.name : `Edit ${role.name}`) : 'New role'}</SheetTitle>
            <SheetDescription>
              {locked
                ? `${role?.description ?? ''} Duplicate it to make an editable copy.`
                : 'Tick what this role may do, and how far each permission reaches. Nothing is ticked until you choose.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-6">
            {!role && copyable.length > 0 && (
              <Field label="Start from" htmlFor="role-copy" hint="Copies that role's permissions and level; change anything before saving.">
                <NativeSelect id="role-copy" value={copiedFrom} onChange={(e) => copyFrom(e.target.value)}>
                  <option value="">Blank: nothing ticked</option>
                  {copyable.map((r) => (
                    <option key={r.id} value={r.id}>
                      Copy from {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="role-name" error={nameError}>
                <Input
                  id="role-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (e.target.value.trim()) setNameError('');
                  }}
                  disabled={locked}
                  maxLength={80}
                  aria-required
                />
              </Field>
              <Field label="Level" htmlFor="role-level" hint={LEVEL_HINTS[level]}>
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

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-bold">Permissions</h3>
                <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
                  {total} on
                </span>
                <SearchField className="relative ml-auto w-full sm:w-72" label="Search permissions" placeholder="Search permissions" value={search} onChange={setSearch} />
              </div>
              {apps.map((app) => {
                const shown = app.groups.map((g) => ({ ...g, permissions: g.permissions.filter((p) => matches(p, term)) })).filter((g) => g.permissions.length);
                if (term && !shown.length) return null;
                const appId = `app-${app.app}`;
                const open = !!term || !closed.has(appId);
                const appName = GRANT_APP_NAMES[app.app] ?? app.app;
                return (
                  <section key={app.app} aria-label={`${appName} permissions`} className="overflow-hidden rounded-lg border shadow-card">
                    <div className={cn('flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-sm font-bold sm:px-4', APP_HEADING[app.app])}>
                      <button
                        type="button"
                        className="-ml-1 flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-9"
                        aria-expanded={open}
                        aria-controls={`${appId}-body`}
                        onClick={() => flip(appId)}
                      >
                        <ChevronDown className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden />
                        <AppChip app={app.app} />
                        <span className="sr-only">{appName}</span>
                        <span className="ml-auto font-mono text-[11px] font-medium text-muted-foreground">
                          {onCount(app.app, app.all)} / {app.all.length} on
                        </span>
                      </button>
                      {!locked && (
                        <span className="flex gap-1">
                          <Button type="button" variant="ghost" size="xs" onClick={() => setMany(app.app, term ? shown.flatMap((g) => g.permissions) : app.all, true)} aria-label={`Select all ${appName} permissions`}>
                            Select all
                          </Button>
                          <Button type="button" variant="ghost" size="xs" onClick={() => setMany(app.app, term ? shown.flatMap((g) => g.permissions) : app.all, false)} aria-label={`Clear ${appName} permissions`}>
                            Clear
                          </Button>
                        </span>
                      )}
                    </div>
                    {open && (
                      <div id={`${appId}-body`} className="divide-y">
                        {shown.map((g) => {
                          const groupId = `${appId}-${g.name}`;
                          const groupOpen = !!term || !closed.has(groupId);
                          const all = app.groups.find((x) => x.name === g.name)!.permissions;
                          return (
                            <div key={g.name} className="px-3 py-2 sm:px-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="flex min-h-11 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-8"
                                  aria-expanded={groupOpen}
                                  onClick={() => flip(groupId)}
                                >
                                  <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !groupOpen && '-rotate-90')} aria-hidden />
                                  <h4 className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.name}</h4>
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {onCount(app.app, all)} / {all.length}
                                  </span>
                                </button>
                                {!locked && (
                                  <span className="flex gap-1">
                                    <Button type="button" variant="ghost" size="xs" onClick={() => setMany(app.app, g.permissions, true)} aria-label={`Select all in ${appName}: ${g.name}`}>
                                      All
                                    </Button>
                                    <Button type="button" variant="ghost" size="xs" onClick={() => setMany(app.app, g.permissions, false)} aria-label={`Clear ${appName}: ${g.name}`}>
                                      None
                                    </Button>
                                  </span>
                                )}
                              </div>
                              {groupOpen && (
                                <ul className="mt-1 space-y-0.5">
                                  {g.permissions.map((p) => (
                                    <PermissionRow
                                      key={p.key}
                                      app={app.app}
                                      appName={appName}
                                      p={p}
                                      grant={grants.get(key({ app: app.app, permission: p.key }))}
                                      locked={locked}
                                      onToggle={() => toggle(app.app, p)}
                                      onScope={(s) => setScope(app.app, p.key, s)}
                                    />
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              {term && apps.every((app) => !app.all.some((p) => matches(p, term))) && <p className="text-sm text-muted-foreground">No permission matches “{search.trim()}”.</p>}
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Own</span> = only my records · <span className="font-semibold text-foreground">Team</span> = mine and my direct reports ·{' '}
                <span className="font-semibold text-foreground">Department</span> = everyone in my department · <span className="font-semibold text-foreground">Company</span> = everyone.
              </p>
            </div>

            {!locked && <DutiesEditor duties={duties} onChange={setDuties} />}
            <ErrorNote>{error}</ErrorNote>
          </SheetBody>
          <SheetFooter className="sticky bottom-0 z-10 bg-card">
            {!locked && nameError && (
              <p className="mr-auto self-center text-[13px] font-medium text-destructive" aria-hidden>
                {nameError}
              </p>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {!locked && (
              <Button type="submit" loading={save.isPending}>
                Save role
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** One permission: tick box, label, its one-line description, and the scope picker when it has scopes and is ticked. */
function PermissionRow({
  app,
  appName,
  p,
  grant,
  locked,
  onToggle,
  onScope,
}: {
  app: GrantApp;
  appName: string;
  p: CataloguePermission;
  grant: Grant | undefined;
  locked: boolean;
  onToggle: () => void;
  onScope: (s: Scope) => void;
}) {
  const id = `perm-${app}-${p.key}`;
  return (
    <li className={cn('-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5 transition-colors', grant && 'bg-accent/40')}>
      <span className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 sm:min-h-0">
        <Checkbox id={id} className="mt-0.5" checked={!!grant} onCheckedChange={onToggle} disabled={locked} aria-label={`${appName}: ${p.label}`} aria-describedby={p.description ? `${id}-d` : undefined} />
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className={cn('block text-sm', grant && 'font-medium')}>{p.label}</span>
          {p.description && (
            <span id={`${id}-d`} className="block text-xs text-muted-foreground">
              {p.description}
            </span>
          )}
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
              onClick={() => onScope(s)}
              className={cn(
                'min-h-10 cursor-pointer rounded-full px-3 text-xs font-medium text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed sm:min-h-0 sm:px-2.5 sm:py-0.5',
                grant.scope === s && 'bg-primary font-semibold text-primary-foreground shadow-xs',
              )}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </li>
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
