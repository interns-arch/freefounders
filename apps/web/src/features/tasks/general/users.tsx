/**
 * /tasks/users — "My team" (old pages/Users.jsx): a read-only directory with workloads for everyone, and the team
 * list for users.manage. People, roles, departments and "reports to" belong to the Platform's People directory
 * (PLAN.md §17.1, §26), so they are shown read-only here with a "Manage in People" link.
 */
import { errorMessage, useAccess } from '@kaampilot/core';
import { SearchField } from '@/components/common/search-field';
import { type ManagedUser, useManagedUsers, useMemberWorkload, useTaskPeople, useTaskRoleOptions, useTeamDirectory } from '@kaampilot/core/tasks';
import { ADMIN_SCREENS } from '@/features/admin/nav';
import { ManageInPeople } from '@/features/admin/manage-in-people';
import { BarChart3, UserPlus, UsersRound } from '@/components/icons';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fmtEffort } from '../shared/format';
import { Chip } from './parts';

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
  // A Manager-level role (no role names, PLAN.md §19.28): the API lists their direct reports.
  const isManager = access.tasks.me?.level === 2;
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
      {isManager && rows.length === 0 && <p className="text-sm text-muted-foreground">No one reports to you yet — ask Admin/HR to set "Reports to" on your team members in Admin → People.</p>}
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

/**
 * The whole team for users.manage: read-only (PLAN.md §26). Adding people, their name, email, mobile, department,
 * "reports to", role and switching them off or deleting them happen only in Admin → People ("Manage in People").
 */
function ManageTeam() {
  const access = useAccess();
  const q = useManagedUsers();
  const roleQ = useTaskRoleOptions();
  const roles = roleQ.data ?? [];
  const managerRoles = roles.filter((r) => r.is_manager).map((r) => r.value);
  const peopleIds = useTaskPeopleIds();
  const viewable = useMemo(() => new Set(peopleIds ?? []), [peopleIds]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [manager, setManager] = useState('');
  const [wl, setWl] = useState<number | null>(null);
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
        description="Who is on the team and their workload. People, roles, departments and “reports to” are managed in Admin → People."
        actions={
          ADMIN_SCREENS.people(access) ? (
            <Button asChild variant="outline">
              <Link to={PEOPLE}>
                <UserPlus /> Add person in People
              </Link>
            </Button>
          ) : undefined
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
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {u.is_active && (
                          <Button size="xs" variant="outline" aria-expanded={wl === u.id} aria-label={`Workload of ${fullName(u)}`} title="Open tasks & pending effort" onClick={() => setWl(wl === u.id ? null : u.id)}>
                            <BarChart3 /> {wl === u.id ? 'Hide' : 'Workload'}
                          </Button>
                        )}
                        <ManageInPeople personId={u.platform_person_id} query={u.email || fullName(u)} label={`Manage ${fullName(u)} in People`} />
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
    </div>
  );
}
