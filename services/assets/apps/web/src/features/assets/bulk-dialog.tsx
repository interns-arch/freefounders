import { type HolderType, LIFECYCLE, type LifecycleAction } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/common/form';
import { HolderPicker } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { invalidateAssetData } from '@/lib/queries';
import { plural } from '@/lib/utils';

export type BulkKind = 'assign' | 'lifecycle';

const BULK_LIFECYCLE: LifecycleAction[] = ['receive', 'make_available', 'move_to_inventory', 'retire', 'reinstate', 'mark_lost', 'mark_found', 'dispose'];

interface BulkResult {
  results: { id: string; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

/** One action applied to many assets; each asset succeeds or fails on its own. */
export function BulkDialog({ kind, ids, onClose, onDone }: { kind: BulkKind | null; ids: string[]; onClose: () => void; onDone: (failedIds: string[]) => void }) {
  const { can } = useAuth();
  const [holderType, setHolderType] = useState<HolderType>('EMPLOYEE');
  const [holderId, setHolderId] = useState<string | null>(null);
  const [action, setAction] = useState<LifecycleAction>('make_available');
  const [notes, setNotes] = useState('');

  const run = useMutation({
    mutationFn: () =>
      api.post<BulkResult>('/assets/bulk', {
        ids,
        action: kind,
        holderType: kind === 'assign' ? holderType : undefined,
        holderId: kind === 'assign' ? holderId : undefined,
        lifecycleAction: kind === 'lifecycle' ? action : undefined,
        notes,
      }),
    onSuccess: async (r) => {
      await invalidateAssetData();
      const failed = r.results.filter((x) => !x.ok);
      if (!failed.length) toast.success(`Done: ${plural(r.succeeded, 'asset')}`);
      else
        toast.warning(`${r.succeeded} done, ${failed.length} skipped`, {
          description: [...new Set(failed.map((f) => f.error))].slice(0, 3).join(' · '),
          duration: 9000,
        });
      onDone(failed.map((f) => f.id));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const ready = kind === 'assign' ? !!holderId || holderType === 'INVENTORY' : true;
  const title = kind === 'assign' ? 'Assign assets' : 'Change status';

  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{plural(ids.length, 'asset')} selected. Assets that can’t take this action are skipped and reported.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {kind === 'assign' && (
            <Field label="Assign to">
              <HolderPicker holderType={holderType} holderId={holderId} onChange={(t, id) => (setHolderType(t), setHolderId(id))} />
            </Field>
          )}
          {kind === 'lifecycle' && (
            <Field label="Action">
              <NativeSelect value={action} onChange={(e) => setAction(e.target.value as LifecycleAction)}>
                {BULK_LIFECYCLE.filter((a) => can(LIFECYCLE[a].permission)).map((a) => (
                  <option key={a} value={a}>
                    {LIFECYCLE[a].label} — {LIFECYCLE[a].description.toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={run.isPending} onClick={() => run.mutate()}>
            Apply to {ids.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
