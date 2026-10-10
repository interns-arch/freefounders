/**
 * /tasks/links — shared company bookmarks in collections (old pages/Links.jsx). Everyone adds links and stars
 * favourites; tasks.assign creates collections and removes any link (others remove only their own).
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import {
  type Link as SharedLink,
  type LinkCollection,
  useAddLink,
  useAddLinkCollection,
  useDeleteLink,
  useGroups,
  useLinkCollections,
  useLinks,
  useToggleLinkFavorite,
} from '@freefounders/core/tasks';
import { ExternalLink, FolderPlus, Link2, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, Panel } from '../general/parts';

export function LinksPage() {
  const access = useAccess();
  const canManage = access.tasks.can('tasks.assign');
  const me = access.tasks.me?.id;
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState<number | ''>('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newColl, setNewColl] = useState('');
  const [err, setErr] = useState('');

  const collections = useLinkCollections();
  const links = useLinks({ search, collection, favorites: onlyFav });
  const addCollection = useAddLinkCollection();
  const favorite = useToggleLinkFavorite();
  const remove = useDeleteLink();
  const confirm = useConfirm();

  const createCollection = () => {
    const name = newColl.trim();
    if (!name) return;
    setErr('');
    addCollection.mutate(name, { onSuccess: () => setNewColl(''), onError: (e) => setErr(errorMessage(e)) });
  };
  const removeLink = async (l: SharedLink) => {
    const ok = await confirm({ title: `Remove the link "${l.title}"?`, description: 'It disappears for everyone who can see it.', confirmText: 'Remove', destructive: true });
    if (!ok.confirmed) return;
    setErr('');
    remove.mutate(l.id, { onError: (e) => setErr(errorMessage(e)) });
  };

  const error = collections.error ?? links.error;
  if (error) return <ErrorState error={error} onRetry={() => (collections.error ? collections.refetch() : links.refetch())} />;

  const all = collections.data;
  const rows = links.data;
  const filtering = !!search.trim() || onlyFav;
  const grouped = all?.filter((c) => !collection || c.id === collection).map((c) => [c, rows?.filter((l) => l.collection === c.id) ?? []] as const);

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Links"
        description="Company bookmarks, grouped in collections. Star the ones you use most."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add link
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField className="relative min-w-44 flex-1" label="Search links" placeholder="Search links…" value={search} onChange={setSearch} />
        <NativeSelect aria-label="Collection" className="w-auto min-w-40" value={collection} onChange={(e) => setCollection(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All collections</option>
          {all?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="button" variant={onlyFav ? 'default' : 'outline'} size="sm" aria-pressed={onlyFav} onClick={() => setOnlyFav((v) => !v)}>
          <Star className={cn(onlyFav && 'fill-current')} /> Favourites
        </Button>
        {canManage && (
          <form
            className="flex items-center gap-1.5 sm:ml-auto"
            aria-label="New collection"
            onSubmit={(e) => {
              e.preventDefault();
              createCollection();
            }}
          >
            <Input aria-label="New collection name" placeholder="New collection…" className="w-40" value={newColl} onChange={(e) => setNewColl(e.target.value)} />
            <Button type="submit" variant="outline" size="sm" disabled={!newColl.trim()} loading={addCollection.isPending}>
              <FolderPlus /> Add
            </Button>
          </form>
        )}
      </div>
      <ErrorNote>{err}</ErrorNote>
      {(!all || !rows) && <Skeleton className="h-40 max-w-2xl" />}
      {all && rows && rows.length === 0 && !filtering && (
        <Card className="max-w-2xl">
          <EmptyState
            icon={Link2}
            title="No links yet"
            description={all.length === 0 && !canManage ? 'A manager or admin creates the first collection, then anyone can add bookmarks.' : 'Add your first company bookmark.'}
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add link
              </Button>
            }
          />
        </Card>
      )}
      {all && rows && rows.length === 0 && filtering && <p className="text-sm text-muted-foreground">No links match.</p>}
      <div className="grid max-w-2xl gap-3">
        {grouped?.map(([c, ls]) =>
          ls.length === 0 && filtering ? null : (
            <Panel
              key={c.id}
              title={
                <>
                  {c.name} <span className="font-normal text-muted-foreground">({ls.length})</span>
                </>
              }
              bodyClassName="pt-1"
            >
              {ls.length === 0 && <p className="text-sm text-muted-foreground">Empty collection.</p>}
              <ul className="divide-y">
                {ls.map((l) => {
                  const mayRemove = canManage || (me != null && l.added_by_detail?.id === me);
                  return (
                    <li key={l.id} className="flex items-start gap-2 py-2.5">
                      <button
                        type="button"
                        aria-pressed={l.favorited}
                        aria-label={`${l.favorited ? 'Unfavourite' : 'Favourite'} ${l.title}`}
                        title={l.favorited ? 'Remove from favourites' : 'Add to favourites'}
                        onClick={() => favorite.mutate(l.id)}
                        className={cn('mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent', l.favorited ? 'text-warning' : 'text-muted-foreground')}
                      >
                        <Star className={cn('size-4', l.favorited && 'fill-current')} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                            {l.title} <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                          </a>
                          {l.group_name && <Chip tone="info">{l.group_name}</Chip>}
                        </div>
                        {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                        <p className="truncate text-xs text-muted-foreground/80">{l.url}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="hidden text-xs text-muted-foreground sm:inline">{l.added_by_detail?.name}</span>
                        {mayRemove && (
                          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${l.title}`} title="Remove link" onClick={() => removeLink(l)}>
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ),
        )}
      </div>
      <Dialog open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <DialogContent className="max-w-lg">{adding && <AddLinkForm collections={all ?? []} canManage={canManage} onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function AddLinkForm({ collections, canManage, onClose }: { collections: LinkCollection[]; canManage: boolean; onClose: () => void }) {
  const groups = useGroups().data ?? [];
  const add = useAddLink();
  const addCollection = useAddLinkCollection();
  const [f, setF] = useState({ collection: collections[0]?.id ?? ('' as number | ''), title: '', url: '', description: '', group: '' as number | '' });
  const [newColl, setNewColl] = useState('');
  const [err, setErr] = useState('');

  // Collections can arrive while the form is open: adopt the first one.
  useEffect(() => {
    if (!f.collection && collections[0]) setF((p) => ({ ...p, collection: collections[0].id }));
  }, [collections, f.collection]);

  const quickCreate = () => {
    const name = newColl.trim();
    if (!name) return;
    setErr('');
    addCollection.mutate(name, {
      onSuccess: (c) => {
        setF((p) => ({ ...p, collection: c.id }));
        setNewColl('');
      },
      onError: (e) => setErr(errorMessage(e)),
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!f.collection) {
      setErr('Create a collection first (ask a manager).');
      return;
    }
    add.mutate(
      { collection: Number(f.collection), title: f.title.trim(), url: f.url.trim(), description: f.description.trim(), group: f.group ? Number(f.group) : null },
      { onSuccess: onClose, onError: (ex) => setErr(errorMessage(ex)) },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add link</DialogTitle>
        <DialogDescription>A web address the team keeps coming back to.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="l-title">Title *</Label>
        <Input id="l-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="e.g. Google Drive" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="l-url">URL *</Label>
        <Input id="l-url" type="url" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="l-desc">Description</Label>
        <Input id="l-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="l-coll">Collection *</Label>
          {collections.length > 0 ? (
            <NativeSelect id="l-coll" value={f.collection} onChange={(e) => setF({ ...f, collection: Number(e.target.value) })}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          ) : canManage ? (
            <div className="flex gap-1.5">
              <Input
                id="l-coll"
                placeholder="e.g. Important tools"
                value={newColl}
                onChange={(e) => setNewColl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    quickCreate();
                  }
                }}
              />
              <Button type="button" variant="outline" disabled={!newColl.trim()} loading={addCollection.isPending} onClick={quickCreate}>
                Create
              </Button>
            </div>
          ) : (
            <p id="l-coll" className="text-sm text-muted-foreground">
              No collections yet — ask a manager or admin to create one first.
            </p>
          )}
          <p className="text-xs text-muted-foreground">The folder this link lives in.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="l-group">Visible to</Label>
          <NativeSelect id="l-group" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Everyone</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                Group: {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <ErrorNote>{err}</ErrorNote>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.title.trim() || !f.url.trim()} loading={add.isPending}>
          Add link
        </Button>
      </DialogFooter>
    </form>
  );
}
