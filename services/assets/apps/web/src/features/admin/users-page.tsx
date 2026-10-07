import { userCreateSchema, userUpdateSchema } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, EyeOff, KeyRound, Plus, Search, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { EntityPicker } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, Badge, Card, Switch } from '@/components/ui/primitives';
import { api, errorMessage, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import type { Role, SavedPassword, UserRow } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { formatDateTime, relativeTime } from '@/lib/utils';

export default function UsersPage() {
  const { values: f, set } = useUrlFilters({ page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const q = useQuery({ queryKey: ['users', f], queryFn: () => api.get<Page<UserRow>>('/users', f) });

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
    { key: 'password', header: 'Password', cell: (u) => <SavedPasswordCell user={u} /> },
    { key: 'status', header: 'Access', cell: (u) => (u.isActive ? <Badge tone="green" dot>Active</Badge> : <Badge tone="neutral" dot>Disabled</Badge>) },
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
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" className="pl-8" />
          </div>
        </div>
        <DataTable columns={columns} rows={q.data?.items} rowKey={(u) => u.id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} onRowClick={(u) => setEditing(u)} keyboard empty={<EmptyState icon={UsersRound} title="No users" />} />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
      {editing && <UserSheet key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Shows a login's saved password on request; each look is recorded in the activity log. */
function SavedPasswordCell({ user }: { user: UserRow }) {
  const [shown, setShown] = useState<SavedPassword | null>(null);
  const [loading, setLoading] = useState(false);
  if (!user.hasSavedPassword) return <span className="text-xs text-muted-foreground" title="Set before passwords were saved — reset it to save one">Not saved</span>;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (shown?.password) {
    return (
      <span className="flex items-center gap-1" onClick={stop}>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all" title={shown.savedAt ? `Set ${formatDateTime(shown.savedAt)}${shown.savedByName ? ` by ${shown.savedByName}` : ''}` : undefined}>
          {shown.password}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Copy password"
          onClick={() => navigator.clipboard.writeText(shown.password!).then(() => toast.success('Password copied'), () => toast.error('Could not copy'))}
        >
          <Copy />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Hide password" onClick={() => setShown(null)}>
          <EyeOff />
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      loading={loading}
      onClick={async (e) => {
        stop(e);
        setLoading(true);
        try {
          const res = await api.get<SavedPassword>(`/users/${user.id}/password`);
          if (res.password) setShown(res);
          else toast.error('This password can no longer be read — reset it to save a new one.');
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <KeyRound /> Show
    </Button>
  );
}

function UserSheet({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(true);
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
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
  const save = useMutation({ mutationFn: (body: unknown) => (editing ? api.patch(`/users/${user!.id}`, body) : api.post('/users', body)) });
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) setTimeout(onClose, 200);
  };
  const self = user?.id === me?.user.id;

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(editing ? 'User updated' : 'User created');
      close(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={close} size="sm" title={editing ? `Edit ${user!.name}` : 'Add user'} onSubmit={submit} submitting={save.isPending}>
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
