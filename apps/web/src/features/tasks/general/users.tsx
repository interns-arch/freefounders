/**
 * /tasks/users — "My team" (old pages/Users.jsx): a read-only directory with workloads for everyone, and the team
 * list for users.manage. FreeFounders: people, departments and "reports to" belong to the Platform's People directory
 * (PLAN.md §17.1), so they are shown read-only here with a link to People & access.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import {
  type ManagedUser,
  useManagedUsers,
  useMemberWorkload,
  usePurgeInfo,
  usePurgeManagedUser,
  useSetManagedUserActive,
  useTaskPeople,
  useTaskRoleOptions,
  useTeamDirectory,
  useUpdateManagedUser,
} from '@freefounders/core/tasks';
import { BarChart3, ExternalLink, UserPlus, UsersRound } from '@/components/icons';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fmtEffort } from '../shared/format';
import { Chip, ErrorNote } from './parts';

const PEOPLE = '/people';
const profileHref = (id: number) => `/tasks/tasks?tab=employees&user=${id}`;

export function UsersPage() {
  const access = useAccess();
  if (!access.tasks.me) return <PageLoader />;
  return access.tasks.can('users.manage') ? <ManageTeam /> : <Directory />;
}

/** Open tasks and pending effort of one person (fetched when opened). */
function WorkloadRow({ userId }: { userId: number }) {
  const q = useMemberWorkload(userId);
  if (q.error) return <p className="text-xs text-muted-foreground">{errorMessage(q.error)}</p>;
  const w = q.data;
  if (!w) return <Skeleton className="h-8" />;
  const pb = w.priority_breakdown || {};
  const hot = (['urgent', 'high'] as const)
    .filter((p) => pb[p])
    .map((p) => `${pb[p]} ${p}`)
    .join(', ');
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm', w.overloaded ? 'border-warning/45 bg-warning/10' : 'border-success/25 bg-success/8')}>
      <strong>{w.name}’s pipeline:</strong>{' '}
      {w.open_tasks === 0 ? (
        'no open tasks — free right now 🎉'
      ) : (
        <>
          {w.open_tasks} open{hot ? ` (${hot})` : ''}
          {w.overdue > 0 && (
            <>
              {' '}
              · <span className="text-destructive">{w.overdue} overdue</span>
            </>
          )}
          {' · '}
          {fmtEffort(w.pending_effort_minutes) || '0m'} of effort pending
          {w.tasks_without_effort > 0 && (
            <span className="text-muted-foreground">
              {' '}
              (+{w.tasks_without_effort} task{w.tasks_without_effort === 1 ? '' : 's'} with no effort value)
            </span>
          )}
        </>
      )}
      {w.overloaded && <div className="mt-0.5 text-warning">⚠ Heavy pipeline — you can still assign; this warning never blocks.</div>}
    </div>
  );
}

function NameCell({ id, name, sub, viewable }: { id: number; name: string; sub: string; viewable: Set<number> }) {
  return (
    <div className="min-w-40">
      {viewable.has(id) ? (
        <Link to={profileHref(id)} className="font-medium text-primary hover:underline" title="Open full task profile">
          {name}
        </Link>
      ) : (
        <strong>{name}</strong>
      )}
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SearchField className="relative min-w-48 flex-1 sm:max-w-xs" label="Search team member" placeholder="Search team member…" value={value} onChange={onChange} />
  );
}

// ─── read-only directory (every role) ────────────────────────────────────

function Directory() {
  const access = useAccess();
  const isManager = access.tasks.me?.role === 'sales_manager';
  const q = useTeamDirectory();
  const roles = useTaskRoleOptions().data ?? [];
  const peopleIds = useTaskPeopleIds();
  const viewable = useMemo(() => new Set(peopleIds ?? []), [peopleIds]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [wl, setWl] = useState<number | null>(null);
  const rows = q.data;

  const shown = useMemo(
    () =>
      (rows ?? []).filter((u) => {
        if (role && u.role !== role) return false;
        const term = search.trim().toLowerCase();
        return !term || `${u.name} ${u.username} ${u.email} ${u.mobile}`.toLowerCase().includes(term);
      }),
    [rows, search, role],
  );
  const more = useShowMore(shown, { reset: [search.trim(), role] });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!rows) return <PageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="My Team"
        description={`${isManager ? 'Reporting to you' : 'Your department'} · ${rows.length} member${rows.length === 1 ? '' : 's'}`}
      />
      {isManager && rows.length === 0 && <p className="text-sm text-muted-foreground">No one reports to you yet — ask Admin/HR to set "Reports to" on your team members in People &amp; access.</p>}
      <div className="flex flex-wrap gap-2">
        <SearchBox value={search} onChange={setSearch} />
        <NativeSelect aria-label="Role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Mobile</TH>
              <TH>Reports to</TH>
              <TH>Department</TH>
              <TH>Role</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {more.visible.map((u) => (
              <Fragment key={u.id}>
                <TR>
                  <TD>
                    <NameCell id={u.id} name={u.name} sub={u.email || `@${u.username}`} viewable={viewable} />
                  </TD>
                  <TD>{u.mobile || '—'}</TD>
                  <TD>{u.reports_to || 'NA'}</TD>
                  <TD>{u.department_display}</TD>
                  <TD>
                    <Chip tone="primary">{u.role_display}</Chip>
                  </TD>
                  <TD className="text-right">
                    <Button size="xs" variant="outline" aria-expanded={wl === u.id} aria-label={`Workload of ${u.name}`} title="Open tasks & pending effort" onClick={() => setWl(wl === u.id ? null : u.id)}>
                      <BarChart3 /> {wl === u.id ? 'Hide' : 'Workload'}
                    </Button>
                  </TD>
                </TR>
                {wl === u.id && (
                  <TR>
                    <TD colSpan={6} className="pt-0">
                      <WorkloadRow userId={u.id} />
                    </TD>
                  </TR>
                )}
              </Fragment>
            ))}
          </TBody>
        </Table>
        <ShowMore {...more.footer} noun="members" className="border-t" />
      </Card>
    </div>
  );
}

/** Ids of the people whose task profile I may open. */
function useTaskPeopleIds() {
  return useTaskPeople().data?.map((p) => p.id);
}

// ─── users.manage ────────────────────────────────────────────────────────

const fullName = (u: ManagedUser) => `${u.first_name || u.username} ${u.last_name || ''}`.trim();

function ManageTeam() {
  const access = useAccess();
  const me = access.tasks.me;
  const q = useManagedUsers();
  const roleQ = useTaskRoleOptions();
  const roles = roleQ.data ?? [];
  const managerRoles = roles.filter((r) => r.is_manager).map((r) => r.value);
  const peopleIds = useTaskPeopleIds();
  const viewable = useMemo(() => new Set(peopleIds ?? []), [peopleIds]);
  const setActive = useSetManagedUserActive();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [manager, setManager] = useState('');
  const [wl, setWl] = useState<number | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [purging, setPurging] = useState<ManagedUser | null>(null);
  const rows = q.data ?? [];

  const managers = useMemo(() => rows.filter((u) => managerRoles.includes(u.role) && u.is_active), [rows, managerRoles]);
  const shown = useMemo(
    () =>
      rows.filter((u) => {
        if (role && u.role !== role) return false;
        if (manager && String(u.reporting_manager || '') !== manager) return false;
        const term = search.trim().toLowerCase();
        return !term || `${u.first_name} ${u.last_name} ${u.username} ${u.email} ${u.whatsapp_phone}`.toLowerCase().includes(term);
      }),
    [rows, search, role, manager],
  );
  const more = useShowMore(shown, { reset: [search.trim(), role, manager] });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="My Team"
        description="New people, departments and “reports to” are managed in People & access."
        actions={
          <Button asChild>
            <Link to={PEOPLE}>
              <UserPlus /> Add person in People &amp; access
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} />
        <NativeSelect aria-label="Role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Reporting manager" className="w-auto" value={manager} onChange={(e) => setManager(e.target.value)}>
          <option value="">Reporting manager…</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {fullName(m)} — {m.role_display}
            </option>
          ))}
        </NativeSelect>
        <span className="text-xs text-muted-foreground">
          {shown.length}/{rows.length} members
        </span>
      </div>
      {setActive.error && <ErrorNote>{errorMessage(setActive.error)}</ErrorNote>}
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={UsersRound} title="No team members yet" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Mobile</TH>
                <TH>Department</TH>
                <TH>Reports to</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {more.visible.map((u) => (
                <Fragment key={u.id}>
                  <TR className={cn(!u.is_active && 'opacity-60')}>
                    <TD>
                      <NameCell id={u.id} name={fullName(u)} sub={u.email || `@${u.username}`} viewable={viewable} />
                    </TD>
                    <TD>{u.whatsapp_phone || '—'}</TD>
                    <TD>{u.department_display || '—'}</TD>
                    <TD>{u.reporting_manager_name || 'NA'}</TD>
                    <TD>
                      <Chip tone="primary">{u.role_display}</Chip>
                    </TD>
                    <TD>{u.is_active ? <Chip tone="success">Active</Chip> : <Chip>Deactivated</Chip>}</TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {u.is_active && (
                          <Button size="xs" variant="outline" aria-expanded={wl === u.id} aria-label={`Workload of ${fullName(u)}`} title="Open tasks & pending effort" onClick={() => setWl(wl === u.id ? null : u.id)}>
                            <BarChart3 /> {wl === u.id ? 'Hide' : 'Workload'}
                          </Button>
                        )}
                        <Button size="xs" variant="outline" aria-label={`Edit ${fullName(u)}`} onClick={() => setEditing(u)}>
                          Edit
                        </Button>
                        {u.id !== me?.id && (
                          <Button size="xs" variant="outline" aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${fullName(u)}`} onClick={() => setActive.mutate({ id: u.id, active: !u.is_active })}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                        {!u.is_active && u.id !== me?.id && (
                          <Button size="xs" variant="destructive" aria-label={`Delete ${fullName(u)}`} onClick={() => setPurging(u)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                  {wl === u.id && (
                    <TR>
                      <TD colSpan={7} className="pt-0">
                        <WorkloadRow userId={u.id} />
                      </TD>
                    </TR>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
          <ShowMore {...more.footer} noun="members" className="border-t" />
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">{editing && <EditUser user={editing} roles={roles} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
      <Dialog open={!!purging} onOpenChange={(o) => !o && setPurging(null)}>
        <DialogContent className="max-w-md">{purging && <PurgeUser user={purging} onClose={() => setPurging(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function EditUser({ user, roles, onClose }: { user: ManagedUser; roles: Array<{ value: string; label: string }>; onClose: () => void }) {
  const save = useUpdateManagedUser();
  const [f, setF] = useState({ email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, whatsapp_phone: user.whatsapp_phone, password: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { password, ...rest } = f;
    save.mutate({ id: user.id, ...rest, ...(password ? { password } : {}) }, { onSuccess: onClose });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Edit {user.username}</DialogTitle>
        <DialogDescription>Task and approval mails go to the email below; WhatsApp alerts to the number.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="u-username">Username</Label>
          <Input id="u-username" value={user.username} disabled />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u-email">Email</Label>
          <Input id="u-email" type="email" value={f.email} onChange={set('email')} />
          <p className="text-xs text-muted-foreground">Leave blank if their mailbox does not exist yet — otherwise every mail bounces back.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u-first">First name</Label>
          <Input id="u-first" value={f.first_name} onChange={set('first_name')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u-last">Last name</Label>
          <Input id="u-last" value={f.last_name} onChange={set('last_name')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u-role">Role *</Label>
          <NativeSelect id="u-role" value={f.role} onChange={set('role')}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u-phone">WhatsApp / Mobile</Label>
          <Input id="u-phone" value={f.whatsapp_phone} onChange={set('whatsapp_phone')} placeholder="9876543210" />
          <p className="text-xs text-muted-foreground">No number means no WhatsApp alerts.</p>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Department</div>
            <div className="text-sm font-medium">{user.department_display || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Reports to</div>
            <div className="text-sm font-medium">{user.reporting_manager_name || 'NA'}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Department and “reports to” come from the company’s People directory. “Reports to” decides who approves this person’s change requests.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to={PEOPLE}>
            Edit in People &amp; access <ExternalLink />
          </Link>
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="u-pass">New Tasks password (blank = keep)</Label>
        <Input id="u-pass" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        <p className="text-xs text-muted-foreground">Only for signing in to a standalone Tasks install; FreeFounders sign-in passwords are reset in People &amp; access.</p>
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Permanent delete of a deactivated person: shows what goes with them and asks for their username. */
function PurgeUser({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const info = usePurgeInfo(user.id);
  const purge = usePurgeManagedUser();
  const [typed, setTyped] = useState('');
  const d = info.data;
  const error = info.error ?? purge.error;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete {fullName(user)} permanently?</DialogTitle>
        <DialogDescription>This removes the person and cannot be undone.</DialogDescription>
      </DialogHeader>
      {!d && !info.error && <Skeleton className="h-24" />}
      {d && (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <strong>{d.tasks_total}</strong> tasks assigned to them
              {d.tasks_total > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({d.tasks_open} open, {d.tasks_overdue} overdue, {d.tasks_done} done)
                </span>
              )}{' '}
              — deleted with their files and comments
            </li>
            {d.mistakes > 0 && (
              <li>
                <strong>{d.mistakes}</strong> mistake records — deleted
              </li>
            )}
            <li>Their notifications, requests and history — deleted</li>
            {d.tasks_given_to_others > 0 && (
              <li className="text-success">
                <strong>{d.tasks_given_to_others}</strong> tasks they gave to others — <strong>kept</strong>, just without “given by”
              </li>
            )}
            {d.reports > 0 && (
              <li className="text-success">
                <strong>{d.reports}</strong> people report to them — they’ll show no reporting manager
              </li>
            )}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor="purge-confirm">
              Type <code className="rounded bg-muted px-1">{d.username}</code> to confirm
            </Label>
            <Input id="purge-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        </>
      )}
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!d || typed.trim().toLowerCase() !== d.username.toLowerCase()}
          loading={purge.isPending}
          onClick={() => purge.mutate({ id: user.id, confirm: typed.trim() }, { onSuccess: onClose })}
        >
          Delete permanently
        </Button>
      </DialogFooter>
    </div>
  );
}
