import { errorMessage, usePlatformMe } from '@freefounders/core';
import {
  PLATFORM_ROLE_LABELS,
  type Person,
  usePeople,
  usePlatformApps,
  useResetLogin,
  useRoles,
  useUpdatePerson,
} from '@freefounders/core/admin';
import { MoreHorizontal, Plus, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote, Pill } from './parts';
import { ExitDialog, PersonRolesDialog, PersonSheet } from './people-dialogs';

type Open =
  | { kind: 'add' }
  | { kind: 'edit'; person: Person }
  | { kind: 'roles'; person: Person }
  | { kind: 'exit'; person: Person }
  | { kind: 'password'; person: Person; username: string | null; password: string };

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
  const reset = useResetLogin();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState('');
  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
  const loadError = people.error ?? roles.error ?? apps.error;

  const resetPassword = async (p: Person) => {
    setError('');
    const ok = await confirm({
      title: p.login ? 'Reset password?' : 'Create login?',
      description: `Set a new password for ${p.fullName}? They will be signed out everywhere.`,
      confirmText: p.login ? 'Reset password' : 'Create login',
    });
    if (!ok.confirmed) return;
    reset.mutate(p.id, {
      onSuccess: (res) => setOpen({ kind: 'password', person: p, username: res.username, password: res.generatedPassword ?? '' }),
      onError: (err) => setError(errorMessage(err)),
    });
  };

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
        <div className={cn('min-w-40', p.status === 'inactive' && 'opacity-60')}>
          <p className="font-medium">{p.fullName}</p>
          <p className="text-xs text-muted-foreground">{[p.email, p.employeeCode].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{PLATFORM_ROLE_LABELS[p.platformRole]}</span>
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
            {p.login.username ?? <span className="text-muted-foreground">email / ID</span>}
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
            <Button variant="outline" size="xs" onClick={() => setOpen({ kind: 'roles', person: p })} disabled={p.status === 'inactive' || !roles.data}>
              Change roles
            </Button>
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
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="xs" onClick={() => setOpen({ kind: 'edit', person: p })}>
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${p.fullName}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void resetPassword(p)}>{p.login ? 'Reset password' : 'Create login'}</DropdownMenuItem>
                {!self && p.status === 'active' && (
                  <DropdownMenuItem onSelect={() => setOpen({ kind: 'exit', person: p })}>{p.lastWorkingDate ? 'Exit started' : 'Start exit'}</DropdownMenuItem>
                )}
                {!self && (
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
          <Button onClick={() => setOpen({ kind: 'add' })}>
            <Plus /> Add person
          </Button>
        }
      />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" className="pl-9" placeholder="Search name, email, employee ID or username" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={people.data}
          rowKey={(p) => p.id}
          loading={people.isLoading}
          fetching={people.isFetching}
          error={loadError}
          onRetry={() => void people.refetch()}
          empty={<EmptyState icon={Users} title="No one found." description={query ? 'Try another name, email or ID.' : undefined} />}
        />
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
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                <dt className="text-muted-foreground">Sign in with</dt>
                <dd className="font-medium break-all">{open.username ?? open.person.email ?? open.person.employeeCode}</dd>
                <dt className="text-muted-foreground">Password</dt>
                <dd>
                  <code className="rounded bg-card px-1.5 py-0.5 font-mono break-all">{open.password || '(the one you entered)'}</code>
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

