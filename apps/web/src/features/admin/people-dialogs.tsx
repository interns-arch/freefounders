import { ApiError, errorMessage } from '@freefounders/core';
import {
  APP_NAMES,
  type AppInfo,
  type ExitResult,
  type Person,
  type PlatformRole,
  PLATFORM_ROLE_LABELS,
  type Role,
  roleApps,
  SUPER_ADMIN_ROLE,
  PLATFORM_PASSWORD_MIN,
  useCreatePerson,
  useDeletePerson,
  useDepartments,
  usePeople,
  useResetLogin,
  useSetPersonRoles,
  useStartExit,
  useUpdatePerson,
} from '@freefounders/core/admin';
import { Check, Copy, Eye, EyeOff, Share2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Field, FormSection } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote, Pill } from './parts';

// ─── Add / edit a person ──────────────────────────────────────────────────

interface Created {
  person: Person;
  username: string | null;
  generatedPassword?: string;
}

interface SheetProps {
  open: boolean;
  person?: Person;
  myRole: PlatformRole;
  myId?: string;
  onClose: () => void;
  onCreated: (res: Created) => void;
}

/** Add person / Edit <name>: details, department, manager, joining date, and (when adding) a login. */
export function PersonSheet(props: SheetProps) {
  if (!props.open) return null;
  return <PersonForm key={props.person?.id ?? 'new'} {...props} />;
}

function PersonForm({ person, myRole, myId, onClose, onCreated }: SheetProps) {
  const [f, setF] = useState({
    fullName: person?.fullName ?? '',
    email: person?.email ?? '',
    employeeCode: person?.employeeCode ?? '',
    mobile: person?.mobile ?? '',
    platformRole: person?.platformRole ?? ('member' as PlatformRole),
    departmentId: person?.departmentId ?? '',
    designation: person?.designation ?? '',
    reportsTo: person?.reportsTo ?? '',
    joinDate: person?.joinDate ?? '',
    withLogin: true,
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const create = useCreatePerson();
  const update = useUpdatePerson();
  // People directory (PLAN.md §17.1): the company's departments, and who this person can report to.
  const depts = useDepartments();
  const everyone = usePeople('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.errors) setErrors(err.errors);
    setError(errorMessage(err));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.fullName.trim()) return setErrors({ fullName: 'Enter their full name' });
    setError('');
    setErrors({});
    const fields = {
      fullName: f.fullName,
      email: f.email,
      employeeCode: f.employeeCode,
      mobile: f.mobile,
      platformRole: f.platformRole,
      departmentId: f.departmentId || null,
      designation: f.designation || null,
      reportsTo: f.reportsTo || null,
      joinDate: f.joinDate || null,
    };
    if (person) {
      update.mutate({ id: person.id, ...fields }, { onSuccess: onClose, onError: fail });
    } else {
      create.mutate(
        { ...fields, ...(f.withLogin ? { login: { username: f.username || undefined, password: f.password || undefined } } : {}) },
        { onSuccess: (res) => onCreated({ person: res.person, username: f.username || null, generatedPassword: res.generatedPassword }), onError: fail },
      );
    }
  };

  const levels: PlatformRole[] = myRole === 'owner' ? ['member', 'admin', 'owner'] : ['member', 'admin'];
  const levelOptions = person?.platformRole === 'owner' && !levels.includes('owner') ? [...levels, 'owner' as const] : levels;
  const levelLocked = person?.id === myId || (person?.platformRole === 'owner' && myRole !== 'owner');

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={person ? `Edit ${person.fullName}` : 'Add person'}
      description={person ? undefined : 'They can sign in with their email, employee ID or username.'}
      onSubmit={submit}
      submitting={create.isPending || update.isPending}
    >
      <FormSection title="Who they are">
        <Field label="Full name" required htmlFor="pf-name" error={errors.fullName}>
          <Input id="pf-name" value={f.fullName} onChange={set('fullName')} required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="pf-email" error={errors.email}>
            <Input id="pf-email" type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Employee ID" htmlFor="pf-code" error={errors.employeeCode}>
            <Input id="pf-code" value={f.employeeCode} onChange={set('employeeCode')} />
          </Field>
          <Field label="Mobile" htmlFor="pf-mobile" error={errors.mobile}>
            <Input id="pf-mobile" value={f.mobile} onChange={set('mobile')} inputMode="tel" />
          </Field>
          <Field label="Access level" htmlFor="pf-level" error={errors.platformRole} hint={levelLocked ? undefined : 'Admins can manage people, roles and settings.'}>
            <NativeSelect id="pf-level" value={f.platformRole} onChange={set('platformRole')} disabled={levelLocked}>
              {levelOptions.map((l) => (
                <option key={l} value={l}>
                  {PLATFORM_ROLE_LABELS[l]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </FormSection>
      <FormSection title="At work" description="Department, manager and joining date reach every app.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" htmlFor="pf-dept" error={errors.departmentId}>
            <NativeSelect id="pf-dept" value={f.departmentId} onChange={set('departmentId')}>
              <option value="">—</option>
              {(depts.data ?? [])
                .filter((d) => d.active || d.id === f.departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Designation" htmlFor="pf-designation" error={errors.designation}>
            <Input id="pf-designation" value={f.designation} onChange={set('designation')} maxLength={80} placeholder="e.g. Sales Executive" />
          </Field>
          <Field label="Reports to" htmlFor="pf-manager" error={errors.reportsTo}>
            <NativeSelect id="pf-manager" value={f.reportsTo} onChange={set('reportsTo')}>
              <option value="">— nobody (approvals go to admins) —</option>
              {(everyone.data ?? [])
                .filter((p) => p.id !== person?.id && (p.status === 'active' || p.id === f.reportsTo))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Joining date" htmlFor="pf-join" error={errors.joinDate}>
            <Input id="pf-join" type="date" value={f.joinDate} onChange={set('joinDate')} />
          </Field>
        </div>
      </FormSection>
      <div className="grid gap-4">
        {!person && (
          <fieldset className="grid gap-4 rounded-lg border border-primary/20 bg-accent/30 p-4">
            <div className="flex items-center gap-2.5">
              <Checkbox id="pf-with-login" checked={f.withLogin} onCheckedChange={(v) => setF((p) => ({ ...p, withLogin: v === true }))} />
              <Label htmlFor="pf-with-login" className="text-sm font-bold">
                Create a login now
              </Label>
            </div>
            {f.withLogin && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username (optional)" htmlFor="pf-username" error={errors['login.username']}>
                  <Input id="pf-username" value={f.username} onChange={set('username')} autoComplete="off" />
                </Field>
                <Field label="Password (blank = generate one)" htmlFor="pf-password" error={errors['login.password']}>
                  <Input id="pf-password" type="text" value={f.password} onChange={set('password')} autoComplete="off" />
                </Field>
              </div>
            )}
            <p className="text-xs text-muted-foreground">They can sign in with their email, employee ID or username.</p>
          </fieldset>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </FormSheet>
  );
}

// ─── Change roles ─────────────────────────────────────────────────────────

export function PersonRolesDialog({
  person,
  roles,
  apps,
  myRole,
  onClose,
}: {
  person: Person;
  roles: Role[];
  apps: AppInfo[];
  myRole: PlatformRole;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(person.roleIds));
  const [error, setError] = useState('');
  const save = useSetPersonRoles();
  const inPlan = new Set(apps.map((a) => a.app));
  const reach = [...new Set(roles.filter((r) => chosen.has(r.id)).flatMap((r) => roleApps(r)))].filter((a) => inPlan.has(a));
  const first = person.fullName.split(' ')[0];

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Roles of {person.fullName}</DialogTitle>
          <DialogDescription>Pick one or more roles. Their permissions add up; the widest scope wins.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border scrollbar-thin">
          {roles.map((r) => {
            // Only an owner gives or takes Super Admin.
            const lockedForMe = r.code === SUPER_ADMIN_ROLE && myRole !== 'owner';
            const id = `role-pick-${r.id}`;
            return (
              <li key={r.id} className={cn('flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40', chosen.has(r.id) && 'bg-accent/40')}>
                <Checkbox id={id} checked={chosen.has(r.id)} disabled={lockedForMe} onCheckedChange={() => toggle(r.id)} />
                <Label htmlFor={id} className={cn('flex-1 cursor-pointer font-medium', chosen.has(r.id) && 'font-semibold')}>
                  {r.name}
                </Label>
                {r.system && <Pill tone="admin">Locked</Pill>}
                <span className="flex gap-1">
                  {roleApps(r).map((a) => (
                    <AppChip key={a} app={a} />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
        <p className={cn('rounded-md border px-3 py-2 text-xs', reach.length ? 'border-success/25 bg-success/8 text-success' : 'border-warning/30 bg-warning/8 text-warning')}>
          {reach.length ? `${first} will be able to open: ${reach.map((a) => APP_NAMES[a]).join(', ')}.` : `${first} will not be able to open any app.`} Losing an app signs them
          out.
        </p>
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setError('');
              save.mutate({ id: person.id, roleIds: [...chosen] }, { onSuccess: onClose, onError: (err) => setError(errorMessage(err)) });
            }}
          >
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Start exit ───────────────────────────────────────────────────────────

/** Start someone's exit (PLAN.md §17.4): Assets lists the assets to recover, Tasks makes the exit checklist. */
export function ExitDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [lastWorkingDate, setDate] = useState(person.lastWorkingDate ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExitResult | null>(null);
  const start = useStartExit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    start.mutate({ id: person.id, lastWorkingDate, reason: reason || null }, { onSuccess: setResult, onError: (err) => setError(errorMessage(err)) });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Exit: {person.fullName}</DialogTitle>
          {!result && <DialogDescription>Assets opens an exit case listing what they hold; Tasks gives their manager the exit checklist.</DialogDescription>}
        </DialogHeader>
        {result ? (
          <>
            <p className="rounded-md border border-success/25 bg-success/8 px-3 py-2 text-sm">
              <strong className="text-success">Exit started.</strong> Last working day <span className="font-mono font-semibold">{result.lastWorkingDate}</span>. They stay active until
              the exit is complete.
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {result.assets && (
                <li>
                  Assets:{' '}
                  {result.assets.error ? (
                    <span className="text-destructive">{result.assets.error}</span>
                  ) : (
                    <>
                      exit case {result.assets.caseNumber}
                      {result.assets.url && (
                        <>
                          {' '}
                          —{' '}
                          <a className="text-primary underline-offset-4 hover:underline" href={result.assets.url}>
                            open it
                          </a>
                        </>
                      )}
                      . Completing it (all assets back) switches them off everywhere.
                    </>
                  )}
                </li>
              )}
              {result.tasks && (
                <li>
                  Tasks: {result.tasks.error ? <span className="text-destructive">{result.tasks.error}</span> : <>exit checklist {result.tasks.code} for their manager.</>}
                </li>
              )}
              {!result.assets && !result.tasks && <li>They have neither Tasks nor Assets: deactivate them on their last day.</li>}
            </ul>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <Field label="Last working day" required htmlFor="exit-date">
              <Input id="exit-date" type="date" value={lastWorkingDate} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Reason (optional)" htmlFor="exit-reason">
              <Input id="exit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={start.isPending} disabled={!lastWorkingDate}>
                Start exit
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset password / create login ───────────────────────────────────────

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * "⋯ → Reset password" (or "Create login"): the admin types a password or has one generated (PLAN.md §19.12).
 * The password is shown once, right after saving; the Platform keeps only its hash.
 */
export function ResetPasswordDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const creating = !person.login;
  const [mode, setMode] = useState<'type' | 'generate'>('type');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [username, setUsername] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ username: string; password: string; mustChange: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const reset = useResetLogin();
  const longEnough = password.length >= PLATFORM_PASSWORD_MIN;
  const needsUsername = creating && !person.email && !person.employeeCode;
  const title = `${creating ? 'Create login' : 'Reset password'} — ${person.fullName}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'type' && !longEnough) return setError(`Use at least ${PLATFORM_PASSWORD_MIN} characters.`);
    const typed = mode === 'type' ? password : undefined;
    reset.mutate(
      { id: person.id, password: typed, mustChangePassword: mustChange, ...(creating && username.trim() ? { username: username.trim() } : {}) },
      {
        onSuccess: (res) => {
          setDone({ username: res.username ?? person.email ?? person.employeeCode ?? '', password: typed ?? res.generatedPassword ?? '', mustChange });
          setPassword('');
        },
        onError: (err) => setError(err instanceof ApiError && err.errors ? Object.values(err.errors)[0] : errorMessage(err)),
      },
    );
  };

  const copy = async () => {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.password);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the password and copy it yourself.');
    }
  };

  const share = done
    ? `https://wa.me/?text=${encodeURIComponent(`Your FreeFounders sign-in: username ${done.username} password ${done.password} ${window.location.origin}`)}`
    : '';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {done
              ? done.mustChange
                ? 'They will choose their own password the first time they sign in.'
                : 'They can keep using this password.'
              : 'They will be signed out everywhere.'}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <dl className="grid gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4 text-sm">
              <div className="grid gap-1">
                <dt className="font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">Sign in with</dt>
                <dd className="font-mono font-semibold break-all">{done.username}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">Password</dt>
                <dd>
                  <code data-testid="new-password" className="block rounded-md border bg-card px-3 py-2 font-mono text-xl font-semibold tracking-wide break-all select-all">
                    {done.password}
                  </code>
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()}>
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button asChild variant="outline">
                <a href={share} target="_blank" rel="noopener noreferrer">
                  <Share2 /> Share on WhatsApp
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" role="note">
              {"Copy it now — it can't be shown again. You can always set a new one."}
            </p>
            <ErrorNote>{error}</ErrorNote>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            {creating && (
              <Field
                label={needsUsername ? 'Username' : 'Username (optional)'}
                required={needsUsername}
                htmlFor="rp-username"
                hint={needsUsername ? undefined : 'Blank = they sign in with their email or employee ID'}
              >
                <Input id="rp-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required={needsUsername} maxLength={50} />
              </Field>
            )}
            <fieldset className="grid gap-2.5">
              <legend className="sr-only">Password</legend>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input type="radio" name="rp-mode" className="size-4 accent-primary" checked={mode === 'type'} onChange={() => setMode('type')} />
                Type a password
              </label>
              {mode === 'type' && (
                <div className="grid gap-1.5 pl-6.5">
                  <Label htmlFor="rp-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="rp-password"
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="pr-10 font-mono"
                      aria-describedby="rp-password-hint"
                      maxLength={200}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2"
                      aria-label="Show password"
                      aria-pressed={show}
                      onClick={() => setShow((s) => !s)}
                    >
                      {show ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <p id="rp-password-hint" aria-live="polite" className={cn('flex items-center gap-1 text-xs', longEnough ? 'font-medium text-success' : 'text-muted-foreground')}>
                    {longEnough && <Check className="size-3.5" aria-hidden />}
                    At least {PLATFORM_PASSWORD_MIN} characters
                  </p>
                </div>
              )}
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input type="radio" name="rp-mode" className="size-4 accent-primary" checked={mode === 'generate'} onChange={() => setMode('generate')} />
                Generate one
              </label>
            </fieldset>
            <div className="flex items-start gap-2.5">
              <Checkbox id="rp-must-change" checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)} className="mt-0.5" />
              <Label htmlFor="rp-must-change" className="text-sm leading-snug font-normal">
                Ask them to change it at next sign-in
              </Label>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={reset.isPending} disabled={(mode === 'type' && !longEnough) || (needsUsername && !username.trim())}>
                Save password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete permanently ───────────────────────────────────────────────────

/** "⋯ → Delete permanently": the person and every record about them in every app (PLAN.md §19.12). */
export function DeletePersonDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const remove = useDeletePerson();
  const matches = sameName(typed, person.fullName);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    remove.mutate(
      { id: person.id, confirm: typed },
      {
        onSuccess: () => {
          toast.success(`${person.fullName} deleted`);
          onClose();
        },
        onError: (err) => setError({ message: errorMessage(err), retry: err instanceof ApiError && err.status === 502 }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !remove.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {person.fullName} permanently?</DialogTitle>
          <DialogDescription>Everything about them is removed from every app:</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>their sign-in and roles</li>
            <li>their tasks, comments, attendance, leave, salary records, leads, mistakes, forms and ideas</li>
            <li>their requests, tickets and asset history</li>
            <li>assets they hold go back to stock</li>
          </ul>
          <p role="note" className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm font-medium text-destructive">
            This cannot be undone. Reports for past months will change.
          </p>
          <Field label="Type their full name to confirm" htmlFor="del-confirm" hint={person.fullName}>
            <Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={200} />
          </Field>
          {error && (
            <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              <p>{error.message}</p>
              {error.retry && <p className="mt-1 text-foreground">They stay deactivated; you can try again.</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={remove.isPending} disabled={!matches}>
              Delete permanently
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
