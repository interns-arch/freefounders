import { userCreateSchema, userUpdateSchema } from '@eam/shared';
import { SearchField } from '@/components/common/search-field';
import { Plus, UsersRound } from '@/components/icons';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { EntityPicker } from '@/features/assets/components/pickers';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, Badge, Card, Switch } from '@/components/ui/primitives';
import { errorMessage } from '@freefounders/core';
import { useAuth } from '@/features/assets/lib/auth';
import { useAssetsCache, useAssetsUsers, useRoles, useSaveAssetsUser } from '@freefounders/core/assets';
import type { UserRow } from '@freefounders/core/assets';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { relativeTime } from '@/lib/utils';

export default function UsersPage() {
  const { values: f, set } = useUrlFilters({ page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const q = useAssetsUsers(f);

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} />
          <div className="min-w-0">
            <div className="truncate font-medium">{u.name}</div>
            <div className="truncate text-xs text-muted-foreground">{[u.username, u.email, u.employeeCode].filter(Boolean).join(' · ') || '—'}</div>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (u) => <Badge tone="indigo">{u.roleName}</Badge> },
    { key: 'employee', header: 'Employee', hideOnMobile: true, cell: (u) => <span className="text-muted-foreground">{u.employeeName ? `${u.employeeName} (${u.employeeCode})` : '—'}</span> },
    { key: 'status', header: 'Access', cell: (u) => (u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Disabled</Badge>) },
    { key: 'last', header: 'Last sign-in', hideOnMobile: true, cell: (u) => <span className="text-muted-foreground">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Who can sign in, and with which role."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add user
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <SearchField className="relative max-w-md" label="Search users" placeholder="Search users…" value={search} onChange={setSearch} />
        </div>
        <DataTable columns={columns} rows={q.data?.items} rowKey={(u) => u.id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} onRowClick={(u) => setEditing(u)} keyboard empty={<EmptyState icon={UsersRound} title="No users" />} />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
      {editing && <UserSheet key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserSheet({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(true);
  const roles = useRoles({ fresh: true });
  const editing = !!user;
  const form = useZodForm(editing ? userUpdateSchema : userCreateSchema, {
    name: user?.name ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
    password: '',
    roleId: user?.roleId ?? '',
    employeeId: user?.employeeId ?? '',
    ...(editing ? {} : { employeeCode: '' }),
    isActive: user?.isActive ?? true,
  });
  const role = roles.data?.find((r) => r.id === form.watch('roleId'));
  // A new login for anyone but leadership also puts them on the employee list.
  const addsEmployee = !editing && !form.watch('employeeId') && !!role && !role.permissions.includes('insights:leadership');
  const e = (n: string) => errorOf(form, n);
  const save = useSaveAssetsUser();
  const cache = useAssetsCache();
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) setTimeout(onClose, 200);
  };
  const self = user?.id === me?.user.id;

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: user?.id ?? null, body: values });
      await cache.invalidate('users');
      toast.success(editing ? 'User updated' : 'User created');
      close(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet errors={form.formState.errors} open={open} onOpenChange={close} size="sm" title={editing ? `Edit ${user!.name}` : 'Add user'} onSubmit={submit} submitting={save.isPending}>
      <div className="grid gap-4">
        <Field label="Name" required error={e('name')}>
          <Input {...form.register('name')} />
        </Field>
        <Field label="Login ID" error={e('username')} hint="Optional · your choice, e.g. amit.kumar — letters, numbers, dot, dash">
          <Input autoComplete="off" autoCapitalize="none" placeholder={user?.employeeCode ?? 'amit.kumar'} {...form.register('username')} />
        </Field>
        <Field label="Email" error={e('email')} hint="Optional · can also be used to sign in">
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </Field>
        <Field label={editing ? 'New password' : 'Password'} required={!editing} error={e('password')} hint={editing ? 'Leave blank to keep the current password' : 'At least 8 characters — you choose it'}>
          <Input type="text" autoComplete="new-password" className="font-mono" {...form.register('password')} />
        </Field>
        <Field label="Role" required error={e('roleId')}>
          <NativeSelect {...form.register('roleId')} disabled={self}>
            <option value="">Select a role…</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Linked employee" error={e('employeeId')} hint="Lets them see “My assets” and raise requests">
          <EntityPicker kind="EMPLOYEE" value={(form.watch('employeeId') as string) || null} selectedLabel={user?.employeeName} onChange={(v) => form.setValue('employeeId', v ?? '')} />
        </Field>
        {addsEmployee && (
          <Field label="Employee ID" error={e('employeeCode')} hint="They are added to Employees with this ID. Leave blank to number it automatically (STAFF-001).">
            <Input autoComplete="off" className="font-mono uppercase" placeholder="STAFF-001" {...form.register('employeeCode' as 'name')} />
          </Field>
        )}
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Can sign in</span>
              <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={self} />
            </label>
          )}
        />
      </div>
    </FormSheet>
  );
}
