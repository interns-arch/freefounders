import { type Permission, PERMISSION_GROUPS, PERMISSIONS } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { Role } from '@/lib/types';

export default function RolesPage() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: (r: Role) => api.del(`/roles/${r.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Every API call — and any future AI assistant — is checked against these permissions."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New role
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(q.data ?? []).map((r) => (
          <Card key={r.id} className="flex flex-col">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" /> {r.name}
                  {r.isSystem && (
                    <Badge tone="gray">
                      <Lock /> Built-in
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="text-xs text-muted-foreground">
                {r.permissions.length} permissions · {r.userCount} user(s)
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.permissions.slice(0, 8).map((p) => (
                  <Badge key={p} tone="outline" className="font-mono text-[10px]">
                    {p}
                  </Badge>
                ))}
                {r.permissions.length > 8 && <Badge tone="neutral">+{r.permissions.length - 8}</Badge>}
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  {r.isSystem && r.name === 'Admin' ? 'View' : 'Edit'}
                </Button>
                {!r.isSystem && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete role"
                    onClick={async () => {
                      const res = await confirm({ title: `Delete role “${r.name}”?`, destructive: true, confirmText: 'Delete' });
                      if (res.confirmed) del.mutate(r);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && <RoleSheet key={editing === 'new' ? 'new' : editing.id} role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RoleSheet({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role?.permissions ?? ['request:create', 'ticket:create']));
  const locked = !!role?.isSystem && role.name === 'Admin';
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, permissions: [...perms] };
      return role ? api.patch(`/roles/${role.id}`, body) : api.post('/roles', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(role ? 'Role updated — members get it on their next request' : 'Role created');
      close(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) setTimeout(onClose, 200);
  };
  const toggle = (p: Permission) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <FormSheet
      open={open}
      onOpenChange={close}
      size="md"
      title={role ? `Role: ${role.name}` : 'New role'}
      description={locked ? 'The Admin role always has every permission.' : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked) save.mutate();
      }}
      submitting={save.isPending}
      submitLabel={locked ? 'Close' : 'Save role'}
    >
      <div className="grid gap-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={locked || role?.isSystem} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} />
        </Field>
      </div>
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.label} className="space-y-2">
          <h3 className="text-sm font-semibold">{g.label}</h3>
          <div className="divide-y rounded-lg border">
            {g.permissions.map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                <Checkbox checked={perms.has(p)} onCheckedChange={() => toggle(p)} disabled={locked} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{PERMISSIONS[p]}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </FormSheet>
  );
}
