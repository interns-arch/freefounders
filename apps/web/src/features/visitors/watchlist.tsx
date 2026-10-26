/**
 * Watchlist (PLAN.md §22.9): mobile numbers or names the gate is warned about. With "stop" (Settings) a listed number
 * cannot be checked in by a guard; a name match only warns (names are shared). Only admins with visitor settings edit
 * it; removing keeps the entry in the record.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { type VisitorConfig, type WatchEntry, useAddWatch, useRemoveWatch, useWatchlist } from '@kaampilot/core/visitors';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Plus, ShieldAlert, Trash2 } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { DataTable } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Switch } from '@/components/ui/primitives';
import { clock } from './parts';

export function WatchlistPage({ config }: { config: VisitorConfig }) {
  const canEdit = config.can.settings;
  const [all, setAll] = useState(false);
  const list = useWatchlist(all);
  const remove = useRemoveWatch();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const rows = list.data ?? [];
  const drop = async (e: WatchEntry) => {
    const r = await confirm({ title: `Remove ${e.name || e.mobile}?`, description: 'The gate is no longer warned. The entry stays in the record.', confirmText: 'Remove', destructive: true });
    if (!r.confirmed) return;
    try {
      await remove.mutateAsync(e.id);
      toast.success('Removed from the watchlist');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Watchlist"
        description={
          config.watch_action === 'stop'
            ? 'A listed mobile number cannot be checked in by a guard (an admin can, after confirming). A listed name only warns.'
            : 'The guard is warned when a listed mobile number or name comes to the gate, and decides with the security head.'
        }
        actions={
          canEdit && (
            <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
              <Plus /> Add to watchlist
            </Button>
          )
        }
      />
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <Switch checked={all} onCheckedChange={setAll} aria-label="Show removed entries" /> Show removed entries
      </label>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty="Nobody is on the watchlist."
        columns={[
          {
            key: 'who',
            header: 'Mobile / name',
            cell: (r) => (
              <span className="flex items-center gap-2">
                <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden />
                <span>
                  <span className="block font-mono font-medium">{r.mobile || '—'}</span>
                  {r.name && <span className="block text-[13px] text-muted-foreground">{r.name}</span>}
                </span>
              </span>
            ),
          },
          { key: 'reason', header: 'Why', cell: (r) => r.reason },
          { key: 'added', header: 'Added', cell: (r) => `${clock(r.added_at)}${r.added_by ? ` · ${r.added_by}` : ''}`, hideOnMobile: true },
          {
            key: 'state',
            header: 'Status',
            cell: (r) => (r.active ? <Badge tone="red">{r.mobile ? (config.watch_action === 'stop' ? 'Stop' : 'Warn') : 'Warn (name)'}</Badge> : <Badge tone="neutral">Removed {clock(r.removed_at)}</Badge>),
          },
          {
            key: 'act',
            header: <span className="sr-only">Actions</span>,
            cell: (r) =>
              canEdit && r.active ? (
                <Button size="sm" variant="ghost" onClick={() => void drop(r)} aria-label={`Remove ${r.name || r.mobile}`}>
                  <Trash2 /> Remove
                </Button>
              ) : null,
          },
        ]}
      />
      {adding && <AddWatchSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddWatchSheet({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ mobile: '', name: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAddWatch();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.mobile.replace(/\D/g, '') && f.name.trim().length < 3) local.mobile = 'Enter a mobile number (or at least a full name).';
    if (!f.reason.trim()) local.reason = 'Say why, so the guard knows.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await add.mutateAsync(f);
      toast.success('Added to the watchlist');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="Add to watchlist" description="The gate is warned when this person comes. Only admins see and change this list." onSubmit={submit} submitting={add.isPending} submitLabel="Add" errors={errors}>
      <div className="space-y-4">
        <Field label="Mobile number" error={errors.mobile} hint="The surest match">
          <Input type="tel" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} className="h-11 text-base sm:text-sm" name="mobile" />
        </Field>
        <Field label="Name" hint="Without a number, the full name is matched (a warning only)">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11 text-base sm:text-sm" name="name" />
        </Field>
        <Field label="Why" required error={errors.reason} hint="The guard sees this">
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} className="h-11 text-base sm:text-sm" name="reason" />
        </Field>
      </div>
    </FormSheet>
  );
}
