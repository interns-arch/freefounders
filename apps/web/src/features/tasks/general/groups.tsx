/** /tasks/groups — team workspaces (old pages/Groups.jsx). ?group=<id> opens one group. */
import { errorMessage, useAccess } from '@freefounders/core';
import { type Group, useAddGroupMembers, useArchiveGroup, useGroupDashboard, useGroups, useRemoveGroupMember, useSaveGroup, useSetTaskStatus, useTaskList, useTaskRoleOptions, useTeamPeople } from '@freefounders/core/tasks';
import { ArrowLeft, ArrowRight, Boxes, Lightbulb, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { MultiSelect } from '../shared/multi-select';
import { Chip, ErrorNote, Panel, Segmented, Tile, fmtWhen } from './parts';

export function GroupsPage() {
  const access = useAccess();
  const q = useGroups();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const canCreate = access.tasks.can('tasks.assign');

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <PageLoader />;
  const openId = Number(params.get('group')) || null;
  const open = q.data.find((g) => g.id === openId);
  if (open)
    return (
      <GroupDetail
        group={open}
        onBack={() => {
          params.delete('group');
          params.delete('tab');
          setParams(params);
        }}
      />
    );

  return (
    <div>
      <PageHeader
        title="Groups"
        description="Team workspaces: shared tasks, members and a dashboard."
        actions={
          canCreate && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> New group
            </Button>
          )
        }
      />
      {q.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="No groups yet"
            description={canCreate ? 'Create one to give a team its own workspace.' : 'You will see groups here once you are added to one.'}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setParams({ group: String(g.id) })}
              className={cn(
                'group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 text-left shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-px hover:border-primary/40 hover:shadow-[0_6px_18px_-8px_rgb(0_0_0/0.18)]',
                !g.active && 'opacity-60',
              )}
            >
              <div aria-hidden className="pointer-events-none absolute -top-10 -right-8 size-28 rounded-full bg-brand-2/12 blur-2xl transition group-hover:bg-brand-2/20" />
              <div className="relative flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Boxes className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{g.name}</span>
                    {!g.active && <Chip>Archived</Chip>}
                  </div>
                  {g.category && (
                    <Chip tone="primary" className="mt-1">
                      {g.category}
                    </Chip>
                  )}
                </div>
              </div>
              {g.description && <p className="relative mt-2 text-sm text-muted-foreground">{g.description}</p>}
              <p className="relative mt-3 text-xs text-muted-foreground">
                {g.member_count} member{g.member_count === 1 ? '' : 's'} · owner {g.owner_detail?.name || '—'}
              </p>
            </button>
          ))}
        </div>
      )}
      <GroupDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function GroupDialog({ open, initial, onClose }: { open: boolean; initial?: Group; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">{open && <GroupForm initial={initial} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function GroupForm({ initial, onClose }: { initial?: Group; onClose: () => void }) {
  const [f, setF] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', category: initial?.category ?? '' });
  // A group with nobody in it is not a group: pick the team here.
  const [members, setMembers] = useState<number[]>(initial ? initial.members_detail.map((m) => m.id) : []);
  const team = useTeamPeople().data ?? [];
  const save = useSaveGroup();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: initial?.id, ...f, members }, { onSuccess: onClose });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{initial ? `Edit ${initial.name}` : 'New group'}</DialogTitle>
        <DialogDescription>You are added automatically as the owner.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="g-name">Name *</Label>
        <Input id="g-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="g-desc">Description</Label>
        <Input id="g-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="g-cat">Category</Label>
        <Input id="g-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Sales, HR" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="g-members">Members</Label>
        <MultiSelect
          id="g-members"
          label="Members"
          options={team.map((p) => ({ id: p.id, name: p.name, department_name: p.department_name }))}
          selected={members}
          onChange={setMembers}
          placeholder="— search and pick people —"
        />
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.name.trim()} loading={save.isPending}>
          {initial ? 'Save' : 'Create group'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── one group ───────────────────────────────────────────────────────────

type GroupTab = 'dashboard' | 'tasks' | 'ideas' | 'links' | 'members';

function GroupDetail({ group, onBack }: { group: Group; onBack: () => void }) {
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const archive = useArchiveGroup();
  const confirm = useConfirm();
  // Ideas and Links are modules a company can switch off (PLAN.md §16.2).
  const tabs: Array<[GroupTab, string]> = [
    ['dashboard', 'Dashboard'],
    ['tasks', 'Tasks'],
    ...(access.tasks.module('ideas') ? ([['ideas', 'Ideas']] as Array<[GroupTab, string]>) : []),
    ...(access.tasks.module('links') ? ([['links', 'Links']] as Array<[GroupTab, string]>) : []),
    ['members', 'Members'],
  ];
  const tab = (tabs.find(([k]) => k === params.get('tab'))?.[0] ?? 'dashboard') as GroupTab;
  const setTab = (t: GroupTab) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };

  const doArchive = async () => {
    const ok = await confirm({ title: `Archive ${group.name}?`, description: 'It leaves the group pickers; its tasks keep their history.', confirmText: 'Archive' });
    if (ok.confirmed) archive.mutate(group.id, { onSuccess: onBack });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to groups">
              <ArrowLeft />
            </Button>
            {group.name}
            {!group.active && <Chip>Archived</Chip>}
          </span>
        }
        description={group.description || undefined}
        actions={
          group.can_manage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              {group.active && (
                <Button variant="outline" onClick={doArchive} loading={archive.isPending}>
                  Archive
                </Button>
              )}
            </>
          )
        }
      />
      {archive.error && <ErrorNote>{errorMessage(archive.error)}</ErrorNote>}
      <Segmented label="Group sections" value={tab} onChange={setTab} options={tabs} />
      {tab === 'dashboard' && <GroupDashboardView group={group} />}
      {tab === 'tasks' && <GroupTasks group={group} />}
      {tab === 'ideas' && (
        <ClassicCard icon={Lightbulb} href="/tasks/ideas?scope=group" title="Ideas" text={`Ideas for "${group.name}" are on the Idea board.`} />
      )}
      {tab === 'links' && <ClassicCard icon={Link2} href="/tasks/links" title="Links" text={`Links scoped to "${group.name}" are on the Links page.`} />}
      {tab === 'members' && <GroupMembers group={group} />}
      <GroupDialog open={editing} initial={group} onClose={() => setEditing(false)} />
    </div>
  );
}

function ClassicCard({ icon: Icon, href, title, text }: { icon: React.ComponentType<{ className?: string }>; href: string; title: string; text: string }) {
  return (
    <Card>
      <EmptyState
        icon={Icon}
        title={title}
        description={text}
        action={
          <Button asChild variant="outline">
            <Link to={href}>
              Open {title} <ArrowRight />
            </Link>
          </Button>
        }
      />
    </Card>
  );
}

function GroupDashboardView({ group }: { group: Group }) {
  const q = useGroupDashboard(group.id);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48" />;
  const t = q.data.tiles;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Total tasks" value={t.total} />
        <Tile label="Pending" value={t.pending} />
        <Tile label="In progress" value={t.in_progress} />
        <Tile label="Completed" value={t.completed} />
        <Tile label="Overdue" value={t.overdue} alert={t.overdue > 0} />
        <Tile label="Members" value={t.members} />
      </div>
      <Panel title="Recent activity" className="max-w-3xl">
        {q.data.recent_activity.length === 0 && <p className="text-sm text-muted-foreground">No task activity in this group yet.</p>}
        <ul className="grid gap-3">
          {q.data.recent_activity.map((a, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              <div>
                <strong>{a.task_title}</strong> <span className="text-muted-foreground">{a.text}</span>
                <div className="text-xs text-muted-foreground">
                  {a.actor} · {fmtWhen(a.created_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function GroupTasks({ group }: { group: Group }) {
  const q = useTaskList({ group: group.id, page_size: 200 });
  const setStatus = useSetTaskStatus();
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Create group tasks from the <Link to="/tasks/tasks" className="text-primary hover:underline">Tasks page</Link> — pick “{group.name}” in the Group field.
      </p>
      {setStatus.error && <ErrorNote>{errorMessage(setStatus.error)}</ErrorNote>}
      {q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks in this group yet.</p>
      ) : (
        <Card className="divide-y">
          {q.data.map((t) => (
            <div key={t.id} className={cn('flex items-start gap-3 px-4 py-3', t.is_overdue && 'bg-destructive/5')}>
              <Checkbox
                className="mt-0.5"
                aria-label={`Done: ${t.title}`}
                checked={t.status === 'done'}
                onCheckedChange={(c) => setStatus.mutate({ id: t.id, status: c === true ? 'done' : 'open' })}
              />
              <div className="min-w-0">
                <Link to={`/tasks/tasks/${t.id}`} className={cn('text-sm font-medium hover:underline', t.status === 'done' && 'text-muted-foreground line-through')}>
                  {t.title}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {t.assigned_to_detail?.name}
                  {t.due_at && <span className={cn(t.is_overdue && 'text-destructive')}> · due {fmtWhen(t.due_at)}</span>}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function GroupMembers({ group }: { group: Group }) {
  const team = useTeamPeople().data ?? [];
  const roleLabel = Object.fromEntries((useTaskRoleOptions().data ?? []).map((r) => [r.value, r.label]));
  const [adding, setAdding] = useState<number[]>([]);
  const add = useAddGroupMembers();
  const remove = useRemoveGroupMember();
  const memberIds = group.members_detail.map((m) => m.id);
  // the whole team: a group owner can add any colleague, not just the people who report to them
  const available = team.filter((t) => !memberIds.includes(t.id));
  const error = add.error ?? remove.error;

  return (
    <div className="max-w-2xl space-y-3">
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {group.can_manage && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <MultiSelect
              label="People to add"
              options={available.map((p) => ({ id: p.id, name: p.name, department_name: p.department_name }))}
              selected={adding}
              onChange={setAdding}
              placeholder="— search and pick people to add —"
            />
          </div>
          <Button disabled={!adding.length} loading={add.isPending} onClick={() => add.mutate({ id: group.id, users: adding }, { onSuccess: () => setAdding([]) })}>
            {add.isPending ? 'Adding…' : `Add${adding.length ? ` ${adding.length}` : ''}`}
          </Button>
        </div>
      )}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Member</TH>
              <TH>Role</TH>
              {group.can_manage && <TH className="w-24" />}
            </TR>
          </THead>
          <TBody>
            {group.members_detail.map((m) => (
              <TR key={m.id}>
                <TD>
                  <strong>{m.name}</strong>
                  {m.id === group.owner_detail?.id && (
                    <Chip tone="primary" className="ml-2">
                      owner
                    </Chip>
                  )}
                </TD>
                <TD>{roleLabel[m.role] ?? m.role}</TD>
                {group.can_manage && (
                  <TD className="text-right">
                    {m.id !== group.owner_detail?.id && (
                      <Button size="xs" variant="outline" aria-label={`Remove ${m.name}`} onClick={() => remove.mutate({ id: group.id, user: m.id })}>
                        Remove
                      </Button>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
