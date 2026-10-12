/** /tasks/notices — the notice board, and managing notices for notices.publish (old pages/Notices.jsx). */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import {
  NOTICE_AUDIENCE_LABELS,
  NOTICE_PRIORITY_LABELS,
  type Notice,
  type NoticeAudience,
  type NoticeInput,
  type NoticePriority,
  useGroups,
  useManagedNotices,
  useMarkNoticeRead,
  useNoticeAction,
  useNotices,
  useNoticeWhatsapp,
  useSaveNotice,
  useTaskDepartments,
  useTaskRoleOptions,
  useTeamDirectory,
} from '@freefounders/core/tasks';
import { Megaphone, Paperclip, Pin, Plus, Send, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toLocalInput } from '../shared/format';
import { Linkify } from '../shared/linkify';
import { MultiSelect } from '../shared/multi-select';
import { Chip, ErrorNote, OkNote, Segmented, fmtWhen } from './parts';

export function NoticesPage() {
  const access = useAccess();
  const isAdmin = access.tasks.can('notices.publish');
  const [mode, setMode] = useState<'feed' | 'manage'>('feed');
  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Notices"
        actions={
          isAdmin && (
            <Segmented
              label="Notices view"
              value={mode}
              onChange={setMode}
              options={[
                ['feed', 'Board'],
                ['manage', 'Manage'],
              ]}
            />
          )
        }
      />
      {mode === 'feed' || !isAdmin ? <NoticeFeed /> : <NoticeManage />}
    </div>
  );
}

const PRIORITY_ICON = { urgent: Megaphone, important: TriangleAlert, normal: Pin } as const;

function NoticeFeed() {
  const [filter, setFilter] = useState<'' | 'true' | 'false'>('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useNotices({ read: filter, search });
  const markRead = useMarkNoticeRead();

  const open = (n: Notice) => {
    setOpenId(openId === n.id ? null : n.id);
    if (!n.read) markRead.mutate(n.id);
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            ['', 'All'],
            ['false', 'Unread'],
            ['true', 'Read'],
          ]}
        />
        <SearchField className="relative min-w-48 flex-1" label="Search notices" placeholder="Search notices…" value={search} onChange={setSearch} />
      </div>
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-40" />}
      {q.data?.length === 0 && (
        <Card>
          <EmptyState icon={Megaphone} title="No notices here" description={search || filter ? 'Nothing matches this filter.' : 'Company announcements show up on this board.'} />
        </Card>
      )}
      <ul className="grid gap-2">
        {q.data?.map((n) => {
          const Icon = PRIORITY_ICON[n.priority] ?? Pin;
          const isOpen = openId === n.id;
          const bubble = n.priority === 'urgent' ? 'bg-destructive/10 text-destructive' : n.priority === 'important' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary';
          return (
            <li key={n.id}>
              <div
                className={cn(
                  'rounded-xl border bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition hover:border-primary/40 hover:shadow-sm',
                  !n.read && 'border-primary/30 bg-gradient-to-r from-primary/8 to-card',
                  n.priority === 'urgent' && 'border-l-4 border-l-destructive',
                  n.priority === 'important' && 'border-l-4 border-l-warning',
                  isOpen && 'border-primary/40',
                )}
              >
                <button type="button" aria-expanded={isOpen} onClick={() => open(n)} className="flex w-full cursor-pointer items-start gap-3 p-3 text-left sm:p-3.5">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', bubble)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className={cn('text-sm', !n.read && 'font-bold')}>{n.title}</strong>
                      {n.category && <Chip tone="primary">{n.category}</Chip>}
                      {n.priority !== 'normal' && <Chip tone={n.priority === 'urgent' ? 'danger' : 'warning'}>{n.priority_display}</Chip>}
                      {!n.read && <span className="size-2 rounded-full bg-primary ring-4 ring-primary/15" aria-label="Unread" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {n.author_detail?.name || '—'} · {fmtWhen(n.publish_at || n.created_at)}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="mx-3 mb-3 space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm whitespace-pre-line sm:ml-[3.75rem]">
                    {n.content ? <Linkify text={n.content} /> : '—'}
                    {n.attachment_url && (
                      <div>
                        <a href={n.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Paperclip className="size-3.5" /> Attachment
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_TONE = { draft: 'neutral', published: 'success', archived: 'warning' } as const;

function NoticeManage() {
  const q = useManagedNotices();
  const action = useNoticeAction();
  const wa = useNoticeWhatsapp();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');

  const run = (n: Notice, a: 'publish' | 'archive' | 'delete') => {
    setErr('');
    action.mutate({ id: n.id, action: a }, { onError: (e) => setErr(errorMessage(e)) });
  };
  const remove = async (n: Notice) => {
    const ok = await confirm({ title: `Delete the notice "${n.title}" for good?`, description: 'Everyone stops seeing it. This cannot be undone.', confirmText: 'Delete', destructive: true });
    if (ok.confirmed) run(n, 'delete');
  };
  // Preview who it reaches, confirm, then send: a broadcast cannot be unsent.
  const sendWhatsApp = async (n: Notice) => {
    setErr('');
    setSent('');
    try {
      const p = await wa.preview.mutateAsync(n.id);
      const ok = await confirm({
        title: `Send "${n.title}" on WhatsApp?`,
        description: (
          <div className="space-y-2">
            <p>
              It goes to {p.with_whatsapp} of {p.audience} people.
            </p>
            {p.without_whatsapp.length > 0 && (
              <p>
                No WhatsApp number on file (they will only see it in the app): {p.without_whatsapp.join(', ')}
              </p>
            )}
          </div>
        ),
        confirmText: 'Send on WhatsApp',
      });
      if (!ok.confirmed) return;
      const r = await wa.send.mutateAsync(n.id);
      setSent(`Sending "${n.title}" to ${r.queued} people on WhatsApp.`);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing('new')}>
        <Plus /> New notice
      </Button>
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{sent}</OkNote>
      {q.data.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="No notices created yet" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Audience</TH>
                <TH>Status</TH>
                <TH>Publish</TH>
                <TH>Expires</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {q.data.map((n) => (
                <TR key={n.id}>
                  <TD>
                    <strong>{n.title}</strong>
                    {n.category && <div className="text-xs text-muted-foreground">{n.category}</div>}
                  </TD>
                  <TD>{n.audience_display}</TD>
                  <TD>
                    <Chip tone={STATUS_TONE[n.status] ?? 'neutral'}>
                      {n.status_display}
                      {n.is_expired && n.status === 'published' ? ' (expired)' : ''}
                    </Chip>
                  </TD>
                  <TD className="whitespace-nowrap">{fmtWhen(n.publish_at)}</TD>
                  <TD className="whitespace-nowrap">{fmtWhen(n.expire_at)}</TD>
                  <TD>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="xs" variant="outline" aria-label={`Edit ${n.title}`} onClick={() => setEditing(n)}>
                        Edit
                      </Button>
                      {n.status !== 'published' && (
                        <Button size="xs" aria-label={`Publish ${n.title}`} onClick={() => run(n, 'publish')}>
                          Publish
                        </Button>
                      )}
                      {n.status === 'published' && !n.is_expired && (
                        <Button size="xs" variant="outline" title="Send this notice to everyone it is for on WhatsApp" aria-label={`Send ${n.title} on WhatsApp`} onClick={() => sendWhatsApp(n)}>
                          <Send /> WhatsApp
                        </Button>
                      )}
                      {n.status === 'published' && (
                        <Button size="xs" variant="outline" aria-label={`Archive ${n.title}`} onClick={() => run(n, 'archive')}>
                          Archive
                        </Button>
                      )}
                      <Button size="xs" variant="destructive" aria-label={`Delete ${n.title}`} onClick={() => remove(n)}>
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">{editing && <NoticeForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function NoticeForm({ initial, onClose }: { initial: Notice | null; onClose: () => void }) {
  const roles = useTaskRoleOptions().data ?? [];
  const depts = useTaskDepartments().data ?? [];
  const groups = useGroups().data ?? [];
  const team = useTeamDirectory().data ?? [];
  const save = useSaveNotice();
  const [f, setF] = useState(() => ({
    title: initial?.title ?? '',
    content: initial?.content ?? '',
    category: initial?.category ?? '',
    priority: (initial?.priority ?? 'normal') as NoticePriority,
    audience_type: (initial?.audience_type ?? 'everyone') as NoticeAudience,
    audience_value: (initial?.audience_value ?? {}) as NonNullable<Notice['audience_value']>,
    publish_at: toLocalInput(initial?.publish_at),
    expire_at: toLocalInput(initial?.expire_at),
  }));
  const setAudience = (v: NonNullable<Notice['audience_value']>) => setF((p) => ({ ...p, audience_value: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: NoticeInput & { id?: number } = {
      ...f,
      id: initial?.id,
      publish_at: f.publish_at ? new Date(f.publish_at).toISOString() : null,
      expire_at: f.expire_at ? new Date(f.expire_at).toISOString() : null,
    };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit notice' : 'New notice'}</DialogTitle>
        <DialogDescription>Everyone it is addressed to sees it on their Home.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="n-title">Title *</Label>
        <Input id="n-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="n-content">Content</Label>
        <Textarea id="n-content" rows={5} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="n-cat">Category</Label>
          <Input id="n-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. HR, Policy" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="n-prio">Priority</Label>
          <NativeSelect id="n-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as NoticePriority })}>
            {Object.entries(NOTICE_PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="n-aud">Audience</Label>
          <NativeSelect id="n-aud" value={f.audience_type} onChange={(e) => setF({ ...f, audience_type: e.target.value as NoticeAudience, audience_value: {} })}>
            {Object.entries(NOTICE_AUDIENCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          {f.audience_type === 'role' && (
            <>
              <Label htmlFor="n-role">Role</Label>
              <NativeSelect id="n-role" value={f.audience_value.role ?? ''} onChange={(e) => setAudience({ role: e.target.value })}>
                <option value="">Pick…</option>
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          {f.audience_type === 'department' && (
            <>
              <Label htmlFor="n-dept">Department</Label>
              <NativeSelect id="n-dept" value={f.audience_value.department ?? ''} onChange={(e) => setAudience({ department: e.target.value })}>
                <option value="">Pick…</option>
                {depts.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          {f.audience_type === 'group' && (
            <>
              <Label htmlFor="n-group">Group</Label>
              <NativeSelect id="n-group" value={f.audience_value.group ?? ''} onChange={(e) => setAudience({ group: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          {f.audience_type === 'users' && (
            <>
              <Label htmlFor="n-users">Users</Label>
              <MultiSelect id="n-users" label="Users" options={team.map((t) => ({ id: t.id, name: t.name, department_name: t.department_display }))} selected={f.audience_value.users ?? []} onChange={(users) => setAudience({ users })} />
            </>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="n-pub">Publish at (blank = on publish)</Label>
          <Input id="n-pub" type="datetime-local" value={f.publish_at} onChange={(e) => setF({ ...f, publish_at: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="n-exp">Expires (optional)</Label>
          <Input id="n-exp" type="datetime-local" value={f.expire_at} onChange={(e) => setF({ ...f, expire_at: e.target.value })} />
        </div>
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.title.trim()} loading={save.isPending}>
          {initial ? 'Save changes' : 'Save draft'}
        </Button>
      </DialogFooter>
    </form>
  );
}
