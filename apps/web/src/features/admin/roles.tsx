import { errorMessage } from '@freefounders/core';
import { LEVEL_LABELS, type Role, roleApps, useArchiveRole, useDuplicateRole, useRoleCatalogue, useRoles } from '@freefounders/core/admin';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
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

  const columns: Column<Role>[] = [
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <div className="min-w-44">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {r.name}
            {r.system && <Pill tone="admin">Locked</Pill>}
          </p>
          <p className="text-xs text-muted-foreground">{r.description || `${r.grants.length} permission${r.grants.length === 1 ? '' : 's'}`}</p>
        </div>
      ),
    },
    { key: 'level', header: 'Level', cell: (r) => LEVEL_LABELS[r.level] ?? r.level },
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
    { key: 'people', header: 'People', className: 'tabular', cell: (r) => r.people },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button variant="outline" size="xs" onClick={() => setEditing(r)} disabled={!catalogue.data} aria-label={`${r.system ? 'View' : 'Edit'} ${r.name}`}>
            {r.system ? 'View' : 'Edit'}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Duplicate ${r.name}`}
            disabled={duplicate.isPending}
            onClick={() => {
              setError('');
              duplicate.mutate(r.id, { onError });
            }}
          >
            Duplicate
          </Button>
          {!r.system && (
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
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles"
        description="What each role can do in every app. A person can have several roles; their permissions add up."
        actions={
          <Button onClick={() => setEditing('new')} disabled={!catalogue.data}>
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
      {editing && catalogue.data && <RoleEditor role={editing === 'new' ? null : editing} catalogue={catalogue.data} onClose={() => setEditing(null)} />}
    </div>
  );
}
