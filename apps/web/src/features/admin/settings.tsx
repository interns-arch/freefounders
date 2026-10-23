import { errorMessage } from '@freefounders/core';
import {
  APP_NAMES,
  APP_SETTINGS_LINKS,
  type CompanySettings,
  DEFAULT_BRAND_COLOUR,
  LOGO_MAX_BYTES,
  type SyncResult,
  useCompanySettings,
  useCreateDepartment,
  useDepartments,
  useRemoveLogo,
  useSetModule,
  useUpdateCompany,
  useUpdateDepartment,
  useUploadLogo,
} from '@freefounders/core/admin';
import { companyNameErrorOf, useCompanyNameCheck } from '@freefounders/core/account';
import { ChevronRight, ImageIcon, Palette } from '@/components/icons';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Field } from '@/components/common/form';
import { LiveCheckLine } from '@/components/common/live-check';
import { ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from '@/components/ui/primitives';
import { brandColours } from '@/lib/brand-colour';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote, Pill, SyncNote } from './parts';

/** Settings Center (PLAN.md §16): company name and look, module switches, departments, links to each app's own settings. */
export function SettingsPage() {
  const company = useCompanySettings();

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your company’s name and look, and which parts of each app are switched on." />
      {company.isLoading ? (
        <PageLoader />
      ) : company.error && !company.data ? (
        <Card>
          <ErrorState error={company.error} onRetry={() => void company.refetch()} />
        </Card>
      ) : company.data ? (
        <div className="grid gap-5">
          <ProfileCard key={company.data.id} company={company.data} />
          <ModulesCard company={company.data} />
          <DepartmentsCard />
          <Card role="region" aria-labelledby="app-settings">
            <CardHeader className="flex-col gap-1">
              <CardTitle id="app-settings" className="text-base">
                App settings
              </CardTitle>
              <CardDescription>Each app keeps its own detailed settings. These open in the app.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {company.data.apps.flatMap((app) =>
                APP_SETTINGS_LINKS[app].map((s) => (
                  <Link
                    key={s.href}
                    to={s.href}
                    className="group flex items-start gap-3 rounded-lg border bg-card p-4 shadow-card transition outline-none hover:border-primary/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <AppChip app={app} />
                      <p className="text-sm font-semibold">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.blurb}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                  </Link>
                )),
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

function ProfileCard({ company }: { company: CompanySettings }) {
  const [name, setName] = useState(company.name);
  const [shortName, setShortName] = useState(company.shortName ?? '');
  const [colour, setColour] = useState(company.colour ?? '');
  const brand = brandColours(/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sync, setSync] = useState<SyncResult>();
  const save = useUpdateCompany();
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = (err: unknown) => setError(errorMessage(err));
  // Unique across Kaampilot (PLAN.md §21.6): a new name is checked while typing; the current one never blocks Save.
  const check = useCompanyNameCheck(name, { rename: true, current: company.name });
  const [nameError, setNameError] = useState<string | null>(null);
  const nameProblem = nameError ?? (['taken', 'invalid', 'error'].includes(check.state) ? check.message : null);
  const changeName = (v: string) => {
    setName(v);
    setNameError(null);
    setMessage('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!check.ok) return document.getElementById('co-name')?.focus();
    save.mutate(
      { name: name.trim().replace(/\s+/g, ' '), shortName: shortName || null, colour: colour || null },
      {
        onSuccess: (res) => {
          setSync(res.sync);
          setMessage('Saved');
        },
        onError: (err) => {
          const taken = companyNameErrorOf(err);
          if (!taken) return fail(err);
          setNameError(taken);
          document.getElementById('co-name')?.focus();
        },
      },
    );
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > LOGO_MAX_BYTES) return setError('The logo must be at most 512 KB');
    let image: string;
    try {
      image = await readAsDataUrl(file);
    } catch (err) {
      return fail(err);
    }
    upload.mutate(image, { onSuccess: (res) => setSync(res.sync), onError: fail });
  };

  return (
    <Card role="region" aria-labelledby="company-profile">
      <CardHeader className="flex-col gap-1">
        <CardTitle id="company-profile" className="text-base">
          Company
        </CardTitle>
        <CardDescription>The name and look people see in every app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="co-name">
              <Input
                id="co-name"
                value={name}
                onChange={(e) => changeName(e.target.value)}
                required
                minLength={2}
                maxLength={Math.max(80, company.name.length)}
                aria-invalid={nameProblem ? true : undefined}
                aria-describedby="co-name-status"
              />
              <LiveCheckLine id="co-name-status" problem={nameProblem} state={check.state} />
            </Field>
            <Field label="Short name (menus and titles)" htmlFor="co-short">
              <Input id="co-short" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={40} placeholder={name} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label id="brand-colour-label">Brand colour</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  aria-labelledby="brand-colour-label"
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-sm border border-input bg-card p-1 max-sm:h-[2.75rem]"
                  value={colour || DEFAULT_BRAND_COLOUR}
                  onChange={(e) => setColour(e.target.value)}
                />
                <Input aria-label="Brand colour code" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Default" pattern="#[0-9a-fA-F]{6}" className="max-w-40 font-mono" />
                {colour && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setColour('')}>
                    Default
                  </Button>
                )}
              </div>
              {/* How the colour will look: buttons and highlights take it over (PLAN.md §16). */}
              <div className="mt-1 flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2" aria-hidden style={brand ? ({ '--primary': document.documentElement.classList.contains('dark') ? brand.dark : brand.light, '--brand-2': brand.raw, '--ring': brand.raw } as React.CSSProperties) : undefined}>
                <Palette className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Preview</span>
                <span className="ml-auto inline-flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-extrabold text-primary-foreground">
                    {(shortName || name).slice(0, 1).toUpperCase() || 'A'}
                  </span>
                  <span className="rounded-sm border border-primary/25 bg-primary/8 px-2 py-0.5 text-xs font-semibold text-primary">Label</span>
                  <span className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-xs">Button</span>
                </span>
              </div>
              {brand?.adjusted && (
                <p className="text-[13px] text-muted-foreground">Text and buttons use a slightly {brand.light !== brand.raw ? 'deeper' : 'lighter'} shade of this colour so they stay easy to read.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Logo</Label>
              <div className="flex flex-wrap items-center gap-2">
                {company.logoUrl ? (
                  <img className="h-10 max-w-32 rounded-md border bg-card object-contain p-1" src={company.logoUrl} alt="Company logo" />
                ) : (
                  <span className="flex h-10 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                    <ImageIcon className="size-4" aria-hidden /> No logo
                  </span>
                )}
                <Button type="button" variant="outline" size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                  {company.logoUrl ? 'Change' : 'Upload'}
                </Button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick(e)} hidden aria-label="Upload logo" />
                {company.logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    loading={remove.isPending}
                    onClick={() => {
                      setError('');
                      remove.mutate(undefined, { onSuccess: (res) => setSync(res.sync), onError: fail });
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 512 KB.</p>
            </div>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <SyncNote sync={sync} />
          <div className="flex items-center justify-end gap-3">
            {message && (
              <span role="status" className="text-sm text-success">
                {message}
              </span>
            )}
            <Button type="submit" loading={save.isPending} disabled={!!nameError || !check.ok}>
              Save company
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ModulesCard({ company }: { company: CompanySettings }) {
  const [error, setError] = useState('');
  const [sync, setSync] = useState<SyncResult>();
  const setModule = useSetModule();
  const busyKey = setModule.isPending && setModule.variables ? `${setModule.variables.app}.${setModule.variables.key}` : '';

  return (
    <Card role="region" aria-labelledby="modules">
      <CardHeader className="flex-col gap-1">
        <CardTitle id="modules" className="text-base">
          Modules
        </CardTitle>
        <CardDescription>Switch off what your company does not use: it leaves the menus and its reminders stop. Nothing is deleted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ErrorNote>{error}</ErrorNote>
        <SyncNote sync={sync} />
        {company.modules.length === 0 && <p className="text-sm text-muted-foreground">No app is connected.</p>}
        {company.modules.map((a) => (
          <div key={a.app} className="space-y-2">
            <div className="flex items-center gap-2">
              <AppChip app={a.app} />
              <span className="font-mono text-[11px] text-muted-foreground">
                {a.modules.filter((m) => m.on).length} of {a.modules.length} on
              </span>
            </div>
            <ul className="divide-y overflow-hidden rounded-lg border shadow-card">
              {a.modules.map((m) => {
                const label = `${APP_NAMES[a.app]}: ${m.label}`;
                return (
                  <li key={m.key} className={cn('flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/30', !m.on && 'bg-muted/20')}>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0">
                        <p className={cn('text-sm font-semibold', !m.on && 'text-muted-foreground')}>{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      </div>
                    </div>
                    <Switch
                      aria-label={label}
                      checked={m.on}
                      disabled={busyKey === `${a.app}.${m.key}`}
                      onCheckedChange={(on) => {
                        setError('');
                        setModule.mutate({ app: a.app, key: m.key, on }, { onSuccess: (res) => setSync(res.sync), onError: (err) => setError(errorMessage(err)) });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** One department list for every app (PLAN.md §17.1). Codes never change, so renaming is safe. */
function DepartmentsCard() {
  const list = useDepartments();
  const create = useCreateDepartment();
  const update = useUpdateDepartment();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const fail = (err: unknown) => setError(errorMessage(err));

  return (
    <Card role="region" aria-labelledby="departments">
      <CardHeader className="flex-col gap-1">
        <CardTitle id="departments" className="text-base">
          Departments
        </CardTitle>
        <CardDescription>Used by People, approvals and the Department scope of roles, in every app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote>{error || (list.error ? errorMessage(list.error) : '')}</ErrorNote>
        <ul className="divide-y overflow-hidden rounded-lg border shadow-card">
          {list.data?.length === 0 && <li className="px-6 py-6 text-center text-sm text-muted-foreground">No departments yet. Add the first one below.</li>}
          {list.isLoading && <li className="px-4 py-3 text-sm text-muted-foreground">Loading…</li>}
          {list.data?.map((d) => (
            <li key={d.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/30', !d.active && 'bg-muted/20')}>
              {editing?.id === d.id ? (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    update.mutate({ id: d.id, name: editing.name }, { onSuccess: () => setEditing(null), onError: fail });
                  }}
                >
                  <Input
                    aria-label={`New name for ${d.name}`}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
                    autoFocus
                    className="max-w-xs flex-1"
                  />
                  <Button type="submit" size="sm" loading={update.isPending}>
                    Save
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent font-mono text-[11px] font-bold text-primary" aria-hidden>
                      {d.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('flex items-center gap-2 text-sm font-semibold', !d.active && 'text-muted-foreground')}>
                        {d.name}
                        {!d.active && <Pill>Inactive</Pill>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{d.people}</span> {d.people === 1 ? 'person' : 'people'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="xs" aria-label={`Rename ${d.name}`} onClick={() => setEditing({ id: d.id, name: d.name })}>
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`${d.active ? 'Deactivate' : 'Activate'} ${d.name}`}
                      onClick={() => {
                        setError('');
                        update.mutate({ id: d.id, active: !d.active }, { onError: fail });
                      }}
                    >
                      {d.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            create.mutate(name.trim(), { onSuccess: () => setName(''), onError: fail });
          }}
        >
          <Input aria-label="New department" placeholder="New department" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="max-w-xs flex-1" />
          <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
            Add department
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
