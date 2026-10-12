import { errorMessage, useAccess, usePlatformMe } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import {
  PLATFORM_ROLE_LABELS,
  type Person,
  usePeople,
  usePlatformApps,
  useRoles,
  useUpdatePerson,
} from '@freefounders/core/admin';
import { MoreHorizontal, Plus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Avatar, Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote, Pill } from './parts';
import { DeletePersonDialog, ExitDialog, PersonRolesDialog, PersonSheet, ResetPasswordDialog } from './people-dialogs';

type Open =
  | { kind: 'add' }
  | { kind: 'edit'; person: Person }
  | { kind: 'roles'; person: Person }
  | { kind: 'exit'; person: Person }
  | { kind: 'reset'; person: Person }
  | { kind: 'delete'; person: Person }
  | { kind: 'password'; person: Person; username: string | null; password: string };

const EMPTY: Person[] = [];

/** Everyone at the company: their login, level, roles and the apps the roles open (PLAN.md §13, §15, §17). */
export function PeoplePage() {
  const me = usePlatformMe().data;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search]);

  const people = usePeople(query);
  const roles = useRoles();
  const apps = usePlatformApps();
  const update = useUpdatePerson();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState('');
  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
  const loadError = people.error ?? roles.error ?? apps.error;
  // The counts use everyone; the table draws the first 50 (weak phones), "Load more" adds the next.
  const more = useShowMore(people.data ?? EMPTY, { reset: query });

  const myRole = me?.person.role ?? 'member';
  // Each action is its own Admin permission (PLAN.md §19.19); a member with one acts on members only.
  const can = useAccess().admin.can;
  const reach = (p: Person) => myRole !== 'member' || p.platformRole === 'member';
  /** Never yourself, never the owner; only the owner deletes admins (PLAN.md §19.12). */
  const canDelete = (p: Person) =>
    can('people.delete') && reach(p) && p.id !== me?.person.id && p.platformRole !== 'owner' && (p.platformRole !== 'admin' || myRole === 'owner');

  const setStatus = async (p: Person, status: Person['status']) => {
    setError('');
    if (status === 'inactive') {
      const ok = await confirm({ title: `Deactivate ${p.fullName}?`, description: 'They will be signed out of every app.', confirmText: 'Deactivate', destructive: true });
      if (!ok.confirmed) return;
    }
    update.mutate({ id: p.id, status }, { onError: (err) => setError(errorMessage(err)) });
  };

  const columns: Column<Person>[] = [
    {
      key: 'person',
      header: 'Person',
      cell: (p) => (
        <div className={cn('flex min-w-44 items-center gap-3', p.status === 'inactive' && 'opacity-60')}>
          <Avatar name={p.fullName} className="size-9" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {p.email || <span>—</span>}
              {p.employeeCode && (
                <>
                  {p.email && ' · '}
                  <span className="font-mono">{p.employeeCode}</span>
                </>
              )}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={p.platformRole === 'owner' ? 'admin' : p.platformRole === 'admin' ? 'info' : 'neutral'}>{PLATFORM_ROLE_LABELS[p.platformRole]}</Pill>
          {p.status === 'inactive' && <Pill tone="warning">Inactive</Pill>}
          {p.status === 'active' && p.lastWorkingDate && <Pill tone="warning">Leaving {p.lastWorkingDate}</Pill>}
        </div>
      ),
    },
    {
      key: 'login',
      header: 'Sign-in',
      hideOnMobile: true,
      cell: (p) =>
        p.login ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.login.username ? <span className="font-mono text-[13px]">{p.login.username}</span> : <span className="text-muted-foreground">email / ID</span>}
            {p.login.locked && <Pill tone="warning">Locked</Pill>}
          </div>
        ) : (
          <span className="text-muted-foreground">No login</span>
        ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (p) => {
        const list = p.roleIds.map((id) => roleById.get(id)).filter((r) => !!r);
        return (
          <div className="flex min-w-44 flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-1" aria-label={`Roles of ${p.fullName}`}>
              {list.map((r) => (
                <Pill key={r.id} tone={r.system ? 'admin' : 'neutral'}>
                  {r.name}
                </Pill>
              ))}
              {p.roleIds.length === 0 && <span className="text-xs text-muted-foreground">No role</span>}
            </div>
            {can('roles.manage') && (
              <Button variant="outline" size="xs" onClick={() => setOpen({ kind: 'roles', person: p })} disabled={p.status === 'inactive' || !roles.data}>
                Change roles
              </Button>
            )}
          </div>
        );
      },
    },
    {
      key: 'apps',
      header: 'Apps',
      hideOnMobile: true,
      cell: (p) => (
        <div className="flex flex-wrap gap-1" aria-label={`Apps of ${p.fullName}`}>
          {p.apps.map((a) => (
            <AppChip key={a} app={a} />
          ))}
          {p.apps.length === 0 && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (p) => {
        const self = p.id === me?.person.id;
        const edits = can('people.manage') && reach(p);
        const resets = can('people.passwords') && (self || reach(p));
        const exits = can('people.exit') && reach(p) && !self && p.status === 'active';
        if (!edits && !resets && !exits && !canDelete(p)) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {edits && (
              <Button variant="outline" size="xs" onClick={() => setOpen({ kind: 'edit', person: p })}>
                Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${p.fullName}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {resets && <DropdownMenuItem onSelect={() => setOpen({ kind: 'reset', person: p })}>{p.login ? 'Reset password' : 'Create login'}</DropdownMenuItem>}
                {exits && (
                  <DropdownMenuItem onSelect={() => setOpen({ kind: 'exit', person: p })}>{p.lastWorkingDate ? 'Exit started' : 'Start exit'}</DropdownMenuItem>
                )}
                {!self && edits && (
                  <>
                    <DropdownMenuSeparator />
                    {p.status === 'active' ? (
                      <DropdownMenuItem destructive onSelect={() => void setStatus(p, 'inactive')}>
                        Deactivate
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => void setStatus(p, 'active')}>Activate</DropdownMenuItem>
                    )}
                  </>
                )}
                {canDelete(p) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setOpen({ kind: 'delete', person: p })}>
                      Delete permanently
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="People & access"
        description={`Everyone at ${me?.company.name ?? 'your company'}: their login and their roles. Roles decide which apps they can open.`}
        actions={
          can('people.manage') && (
            <Button onClick={() => setOpen({ kind: 'add' })}>
              <Plus /> Add person
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchField className="relative w-full max-w-md" label="Search people" placeholder="Search name, email, employee ID or username" value={search} onChange={setSearch} inputClassName="h-10" />
        {people.data && (
          <span className="rounded-full border bg-card px-3 py-1 font-mono text-xs text-muted-foreground shadow-card" aria-live="polite">
            <span className="font-semibold text-foreground">{people.data.filter((p) => p.status === 'active').length}</span> active · {people.data.length} total
          </span>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={people.data ? more.visible : undefined}
          rowKey={(p) => p.id}
          loading={people.isLoading}
          fetching={people.isFetching}
          error={loadError}
          onRetry={() => void people.refetch()}
          empty={<EmptyState icon={Users} title="No one found." description={query ? 'Try another name, email or ID.' : undefined} />}
        />
        {people.data && <ShowMore {...more.footer} noun="people" className="border-t" />}
      </Card>

      <PersonSheet
        open={open?.kind === 'add' || open?.kind === 'edit'}
        person={open?.kind === 'edit' ? open.person : undefined}
        myRole={me?.person.role ?? 'member'}
        myId={me?.person.id}
        onClose={() => setOpen(null)}
        onCreated={(res) =>
          setOpen(res.generatedPassword ? { kind: 'password', person: res.person, username: res.username, password: res.generatedPassword } : null)
        }
      />
      {open?.kind === 'roles' && roles.data && (
        <PersonRolesDialog person={open.person} roles={roles.data} apps={apps.data ?? []} myRole={me?.person.role ?? 'member'} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'exit' && <ExitDialog person={open.person} onClose={() => setOpen(null)} />}
      {open?.kind === 'reset' && <ResetPasswordDialog key={open.person.id} person={open.person} onClose={() => setOpen(null)} />}
      {open?.kind === 'delete' && <DeletePersonDialog key={open.person.id} person={open.person} onClose={() => setOpen(null)} />}
      <Dialog open={open?.kind === 'password'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-md">
          {open?.kind === 'password' && (
            <>
              <DialogHeader>
                <DialogTitle>Login ready</DialogTitle>
                <DialogDescription>
                  Give these to <strong className="text-foreground">{open.person.fullName}</strong>. They will choose their own password the first time they sign in.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-lg border border-primary/20 bg-accent/40 p-4 text-sm">
                <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Sign in with</dt>
                <dd className="font-mono font-semibold break-all">{open.username ?? open.person.email ?? open.person.employeeCode}</dd>
                <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Password</dt>
                <dd>
                  <code className="rounded-md border bg-card px-2 py-1 font-mono text-[15px] font-semibold tracking-wide break-all">{open.password || '(the one you entered)'}</code>
                </dd>
              </dl>
              <p className="text-xs text-muted-foreground">This password is shown only once and is never stored where anyone can read it.</p>
              <DialogFooter>
                <Button onClick={() => setOpen(null)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

