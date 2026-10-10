/**
 * /tasks/ideas — the Idea board (old pages/Ideas.jsx): shared, my and group ideas with votes and comments.
 * tasks.assign (managers/admins) reviews: changes the status and can remove any idea.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import {
  IDEA_PRIORITY_LABELS,
  IDEA_STATUS_LABELS,
  type Idea,
  type IdeaPriority,
  type IdeaScope,
  type IdeaStatus,
  useAddIdea,
  useAddIdeaComment,
  useDeleteIdea,
  useGroups,
  useIdeaComments,
  useIdeas,
  useSetIdeaStatus,
  useVoteIdea,
} from '@freefounders/core/tasks';
import { ChevronUp, Lightbulb, MessageSquare, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, Segmented, type Tone, fmtWhen } from '../general/parts';
import { Linkify } from '../shared/linkify';
import { ProofreadText } from '../shared/proofread-text';

const STATUS_TONE: Record<IdeaStatus, Tone> = { new: 'info', under_review: 'warning', approved: 'success', rejected: 'danger', implemented: 'primary' };
const STATUSES = Object.entries(IDEA_STATUS_LABELS) as Array<[IdeaStatus, string]>;

export function IdeasPage() {
  const access = useAccess();
  const canReview = access.tasks.can('tasks.assign');
  const me = access.tasks.me?.id;
  const [scope, setScope] = useState<IdeaScope>('shared');
  const [status, setStatus] = useState<IdeaStatus | ''>('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const q = useIdeas({ scope, status, search });
  const vote = useVoteIdea();
  const setIdeaStatus = useSetIdeaStatus();
  const remove = useDeleteIdea();
  const confirm = useConfirm();

  const changeStatus = (i: Idea, s: IdeaStatus) => {
    setErr('');
    setIdeaStatus.mutate({ id: i.id, status: s }, { onError: (e) => setErr(errorMessage(e)) });
  };
  const removeIdea = async (i: Idea) => {
    const ok = await confirm({ title: `Delete the idea "${i.title}"?`, description: 'Its votes and comments go with it. This cannot be undone.', confirmText: 'Delete', destructive: true });
    if (!ok.confirmed) return;
    setErr('');
    remove.mutate(i.id, { onError: (e) => setErr(errorMessage(e)) });
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Idea board"
        description="Share an idea, vote for the ones you like, and discuss them. Managers review and mark what gets done."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> New idea
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Board"
          value={scope}
          onChange={setScope}
          options={[
            ['shared', 'Shared'],
            ['my', 'My ideas'],
            ['group', 'Group ideas'],
          ]}
        />
        <NativeSelect aria-label="Status" className="w-auto min-w-36" value={status} onChange={(e) => setStatus(e.target.value as IdeaStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <SearchField className="relative min-w-44 flex-1" label="Search ideas" placeholder="Search ideas…" value={search} onChange={setSearch} />
      </div>
      <ErrorNote>{err}</ErrorNote>
      {!q.data && <Skeleton className="h-40 max-w-3xl" />}
      {q.data?.length === 0 && (
        <Card className="max-w-3xl">
          <EmptyState
            icon={Lightbulb}
            title="No ideas here yet"
            description="Share the first one."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus /> New idea
              </Button>
            }
          />
        </Card>
      )}
      <ul className="grid max-w-3xl gap-2">
        {q.data?.map((i) => {
          const isOpen = openId === i.id;
          const mine = me != null && i.author_detail?.id === me;
          return (
            <li key={i.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <button
                    type="button"
                    aria-pressed={i.voted}
                    aria-label={`Vote for ${i.title}`}
                    title={i.voted ? 'Remove my vote' : 'Vote'}
                    onClick={() => vote.mutate(i.id)}
                    className={cn(
                      'flex w-11 shrink-0 cursor-pointer flex-col items-center rounded-lg border py-1 font-mono text-xs font-semibold tabular-nums transition-colors',
                      i.voted ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <ChevronUp className="size-4" />
                    {i.vote_count}
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : i.id)} className="block w-full cursor-pointer text-left">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{i.title}</strong>
                        {i.category && <Chip tone="primary">{i.category}</Chip>}
                        {i.group_name && (
                          <Chip tone="info">
                            <Users className="size-3" /> {i.group_name}
                          </Chip>
                        )}
                        <Chip tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status_display}</Chip>
                        {i.priority === 'high' && <Chip tone="danger">High priority</Chip>}
                      </span>
                      {i.description && (
                        <span className="mt-1 block text-sm whitespace-pre-line text-muted-foreground">
                          <Linkify text={i.description} />
                        </span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {i.author_detail?.name || '—'} · {fmtWhen(i.created_at)} ·
                        <MessageSquare className="size-3" aria-hidden /> {i.comment_count} {i.comment_count === 1 ? 'comment' : 'comments'}
                      </span>
                    </button>
                  </div>
                  {/* Review controls: under the text on phones, beside it from sm up. */}
                  <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto">
                    {canReview && (
                      <NativeSelect aria-label={`Status of ${i.title}`} className="h-8 w-auto text-xs" value={i.status} onChange={(e) => changeStatus(i, e.target.value as IdeaStatus)}>
                        {STATUSES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                    {(mine || canReview) && (
                      <Button size="icon-xs" variant="ghost" aria-label={`Delete ${i.title}`} title="Delete idea" onClick={() => removeIdea(i)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
                {isOpen && <Comments idea={i} />}
              </Card>
            </li>
          );
        })}
      </ul>
      <Dialog open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <DialogContent className="max-w-lg">{adding && <NewIdeaForm onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function Comments({ idea }: { idea: Idea }) {
  const q = useIdeaComments(idea.id);
  const add = useAddIdeaComment();
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');

  const post = () => {
    const text = body.trim();
    if (!text) return;
    setErr('');
    add.mutate({ id: idea.id, body: text }, { onSuccess: () => setBody(''), onError: (e) => setErr(errorMessage(e)) });
  };

  return (
    <section aria-label={`Comments on ${idea.title}`} className="mt-3 space-y-2 border-t pt-3 sm:pl-14">
      {q.error && <ErrorNote>{errorMessage(q.error)}</ErrorNote>}
      {!q.data && !q.error && <p className="text-xs text-muted-foreground">Loading comments…</p>}
      {q.data?.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
      <ul className="grid gap-1.5">
        {q.data?.map((c) => (
          <li key={c.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <p className="whitespace-pre-line">
              <Linkify text={c.body} />
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {c.author?.name || '—'} · {fmtWhen(c.created_at)}
            </p>
          </li>
        ))}
      </ul>
      <div
        onKeyDown={(e) => {
          // Enter posts; Shift+Enter makes a new line (as the old board did).
          if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'TEXTAREA') {
            e.preventDefault();
            post();
          }
        }}
      >
        <ProofreadText id={`idea-comment-${idea.id}`} label="Add a comment" value={body} onChange={setBody} rows={2} placeholder="Add a comment… (Enter to post)" />
      </div>
      <ErrorNote>{err}</ErrorNote>
      <div className="flex justify-end">
        <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={post}>
          Post comment
        </Button>
      </div>
    </section>
  );
}

function NewIdeaForm({ onClose }: { onClose: () => void }) {
  const groups = useGroups().data ?? [];
  const add = useAddIdea();
  const [f, setF] = useState({ title: '', description: '', category: '', group: '' as number | '', priority: 'normal' as IdeaPriority });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate({ title: f.title.trim(), description: f.description.trim(), category: f.category.trim(), group: f.group ? Number(f.group) : null, priority: f.priority }, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New idea</DialogTitle>
        <DialogDescription>Share an improvement; the team can vote and comment on it.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="i-title">Title *</Label>
        <Input id="i-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
      </div>
      <ProofreadText id="i-desc" label="Description" value={f.description} onChange={(v) => setF({ ...f, description: v })} rows={3} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="i-cat">Category</Label>
          <Input id="i-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Process, Product" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="i-board">Board</Label>
          <NativeSelect id="i-board" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Shared (company-wide)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                Group: {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="i-prio">Priority</Label>
          <NativeSelect id="i-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as IdeaPriority })}>
            {Object.entries(IDEA_PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {add.error && <ErrorNote>{errorMessage(add.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.title.trim()} loading={add.isPending}>
          Post idea
        </Button>
      </DialogFooter>
    </form>
  );
}
