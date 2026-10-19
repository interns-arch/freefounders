import { errorMessage, usePlatformMe } from '@freefounders/core';
import { LEVEL_LABELS, type Role, roleApps, roleLimits, useArchiveRole, useDuplicateRole, useRoleCatalogue, useRoles } from '@freefounders/core/admin';
import { Lock, Plus, ShieldCheck } from '@/components/icons';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AppChip, ErrorNote, Pill } from './parts';
import { RoleEditor } from './role-editor';

/** What each role can do in every app; a person can hold several roles (PLAN.md §15, duties §17.3). */
export function RolesPage() {
  const roles = useRoles();
  const catalogue = useRoleCatalogue();
  const duplicate = useDuplicateRole();
  const archive = useArchiveRole();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [error, setError] = useState('');
  const onError = (err: unknown) => setError(errorMessage(err));
  // Without being the owner: only roles within my own permissions and level can be changed or copied (R1).
  const limits = roleLimits(usePlatformMe().data, catalogue.data);
  const editingRole = editing && editing !== 'new' ? editing : null;

  const columns: Column<Role>[] = [
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <div className="flex min-w-48 items-start gap-3">
          <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg', r.system ? 'bg-app-admin/12 text-app-admin' : 'bg-accent text-primary')} aria-hidden>
            {r.system ? <Lock className="size-4" /> : <ShieldCheck className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">
              {r.name}
              {r.system && <Pill tone="admin">Built in</Pill>}
            </p>
            <p className="text-xs text-muted-foreground">
              {r.description || (
                <>
                  <span className="font-mono">{r.grants.length}</span> permission{r.grants.length === 1 ? '' : 's'}
                </>
              )}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'level', header: 'Level', cell: (r) => <Pill tone={r.level >= 3 ? 'admin' : r.level === 2 ? 'info' : 'neutral'}>{LEVEL_LABELS[r.level] ?? r.level}</Pill> },
    {
      key: 'apps',
      header: 'Apps',
      hideOnMobile: true,
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {roleApps(r).map((a) => (
            <AppChip key={a} app={a} />
          ))}
          {r.grants.length === 0 && <span className="text-muted-foreground">None</span>}
        </div>
      ),
    },
    { key: 'people', header: 'People', className: 'font-mono tabular', cell: (r) => <span className={cn(r.people === 0 && 'text-muted-foreground')}>{r.people}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => {
        const problem = limits.roleProblem(r, 'edit');
        const view = !!problem;
        return (
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            <Button variant="outline" size="xs" onClick={() => setEditing(r)} disabled={!catalogue.data} aria-label={`${view ? 'View' : 'Edit'} ${r.name}`}>
              {view ? 'View' : 'Edit'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Duplicate ${r.name}`}
              title={problem ?? undefined}
              disabled={duplicate.isPending || !!problem}
              onClick={() => {
                setError('');
                duplicate.mutate(r.id, { onError });
              }}
            >
              Duplicate
            </Button>
            {!view && !r.system && (
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                aria-label={`Archive ${r.name}`}
                onClick={async () => {
                  setError('');
                  const ok = await confirm({
                    title: `Archive "${r.name}"?`,
                    description: r.people ? `${r.people} people lose it (and any app only it gave them).` : undefined,
                    confirmText: 'Archive',
                    destructive: true,
                  });
                  if (ok.confirmed) archive.mutate(r.id, { onError });
                }}
              >
                Archive
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles"
        description="What each role can do in every app, the Admin workspace included. Admin and Member are built in: change what they can do, but they cannot be deleted. A person can have several roles; their permissions add up. The owner can always do everything."
        actions={
          <Button variant="cta" onClick={() => setEditing('new')} disabled={!catalogue.data}>
            <Plus /> New role
          </Button>
        }
      />
      <ErrorNote>{error || (catalogue.error ? errorMessage(catalogue.error) : '')}</ErrorNote>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={roles.data}
          rowKey={(r) => r.id}
          loading={roles.isLoading}
          fetching={roles.isFetching}
          error={roles.error}
          onRetry={() => void roles.refetch()}
          empty={<EmptyState icon={ShieldCheck} title="No roles yet" />}
        />
      </Card>
      {editing && catalogue.data && (
        <RoleEditor
          role={editingRole}
          catalogue={catalogue.data}
          roles={roles.data ?? []}
          limits={limits}
          lockedReason={editingRole ? limits.roleProblem(editingRole, 'edit') : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
