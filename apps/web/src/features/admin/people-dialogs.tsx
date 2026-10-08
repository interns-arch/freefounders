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
  useCreatePerson,
  useDepartments,
  usePeople,
  useSetPersonRoles,
  useStartExit,
  useUpdatePerson,
} from '@freefounders/core/admin';
import { type FormEvent, useState } from 'react';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
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
      <div className="grid gap-4">
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
          <Field label="Access level" htmlFor="pf-level" error={errors.platformRole}>
            <NativeSelect id="pf-level" value={f.platformRole} onChange={set('platformRole')} disabled={levelLocked}>
              {levelOptions.map((l) => (
                <option key={l} value={l}>
                  {PLATFORM_ROLE_LABELS[l]}
                </option>
              ))}
            </NativeSelect>
          </Field>
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
        {!person && (
          <fieldset className="grid gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Checkbox id="pf-with-login" checked={f.withLogin} onCheckedChange={(v) => setF((p) => ({ ...p, withLogin: v === true }))} />
              <Label htmlFor="pf-with-login">Create a login now</Label>
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
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
          {roles.map((r) => {
            // Only an owner gives or takes Super Admin.
            const lockedForMe = r.code === SUPER_ADMIN_ROLE && myRole !== 'owner';
            const id = `role-pick-${r.id}`;
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox id={id} checked={chosen.has(r.id)} disabled={lockedForMe} onCheckedChange={() => toggle(r.id)} />
                <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
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
        <p className="text-xs text-muted-foreground">
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
            <p className="text-sm">
              <strong>Exit started.</strong> Last working day {result.lastWorkingDate}. They stay active until the exit is complete.
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
