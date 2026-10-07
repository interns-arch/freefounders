import { ASSIGNABLE_HOLDERS, type Condition, CONDITIONS, type HolderType, humanize, LIFECYCLE, type LifecycleAction } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HolderLabel } from '@/components/common/badges';
import { Field } from '@/components/common/form';
import { PhotoPicker, uploadPhotos } from '@/components/common/photos';
import { HolderPicker } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Switch } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { invalidateAssetData } from '@/lib/queries';
import type { Allocation } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export interface ActionAsset {
  id: string;
  assetTag: string;
  name: string;
  trackingMode: 'INDIVIDUAL' | 'QUANTITY';
  availableQuantity?: number;
  holderType?: HolderType | null;
  holderName?: string | null;
  /** One-time item: "Give" instead of "Assign", nothing to return. */
  consumable?: boolean;
}

export type AssetDialog =
  | { kind: 'assign'; asset: ActionAsset; defaults?: { holderType?: HolderType; holderId?: string } }
  | { kind: 'transfer'; asset: ActionAsset; allocation?: Allocation }
  | { kind: 'return'; asset: ActionAsset; allocation?: Allocation }
  | { kind: 'lifecycle'; asset: ActionAsset; action: LifecycleAction };

/** Assign / transfer / return / lifecycle action dialog for one asset. */
export function AssetActionDialog({ dialog, onClose, onDone }: { dialog: AssetDialog | null; onClose: () => void; onDone?: () => void }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        {dialog?.kind === 'assign' && <AssignBody key={dialog.asset.id} dialog={dialog} onClose={onClose} onDone={onDone} />}
        {dialog?.kind === 'transfer' && <AssignBody key={dialog.asset.id} dialog={dialog} onClose={onClose} onDone={onDone} />}
        {dialog?.kind === 'return' && <ReturnBody key={dialog.asset.id} dialog={dialog} onClose={onClose} onDone={onDone} />}
        {dialog?.kind === 'lifecycle' && <LifecycleBody key={dialog.asset.id + dialog.action} dialog={dialog} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

interface ActionInput {
  path: string;
  body: unknown;
  photos?: { assetId: string; kind: 'HANDOVER' | 'RETURN'; files: File[] };
}

function useAction(onClose: () => void, onDone?: () => void) {
  return useMutation({
    mutationFn: async ({ path, body, photos }: ActionInput) => {
      const res = await api.post<{ id?: string; allocationId?: string }>(path, body);
      const allocationId = res?.allocationId ?? res?.id;
      if (photos?.files.length && allocationId) {
        // The assignment is already saved; a failed upload must not look like a failed handover.
        try {
          await uploadPhotos(photos.assetId, allocationId, photos.kind, photos.files);
        } catch (err) {
          toast.error(`Saved, but the photos did not upload: ${errorMessage(err)}`);
        }
      }
      return res;
    },
    onSuccess: async () => {
      await invalidateAssetData();
      onDone?.();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function AssignBody({ dialog, onClose, onDone }: { dialog: Extract<AssetDialog, { kind: 'assign' | 'transfer' }>; onClose: () => void; onDone?: () => void }) {
  const transfer = dialog.kind === 'transfer';
  const pooled = dialog.asset.trackingMode === 'QUANTITY';
  const defaults = dialog.kind === 'assign' ? dialog.defaults : undefined;
  const [holderType, setHolderType] = useState<HolderType>(defaults?.holderType ?? 'EMPLOYEE');
  const [holderId, setHolderId] = useState<string | null>(defaults?.holderId ?? null);
  const [quantity, setQuantity] = useState(1);
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const action = useAction(onClose, onDone);
  const give = !!dialog.asset.consumable;
  const allowed = give ? (['EMPLOYEE', 'DEPARTMENT'] as const) : pooled ? ASSIGNABLE_HOLDERS.filter((t) => t !== 'INVENTORY') : ASSIGNABLE_HOLDERS;
  const from = transfer ? (dialog.allocation?.holderName ?? dialog.asset.holderName) : null;

  const submit = () => {
    if (!holderId && holderType !== 'INVENTORY') return setError('Choose who receives it');
    action.mutate(
      {
        path: `/assets/${dialog.asset.id}/${transfer ? 'transfer' : 'assign'}`,
        body: { holderType, holderId, quantity, expectedReturnDate: expected || null, notes, allocationId: transfer ? dialog.allocation?.id : undefined },
        photos: { assetId: dialog.asset.id, kind: 'HANDOVER', files: photos },
      },
      { onSuccess: () => toast.success(transfer ? `${dialog.asset.assetTag} transferred` : give ? `${dialog.asset.name} given — no return needed` : `${dialog.asset.assetTag} assigned`) },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{transfer ? 'Transfer asset' : give ? `Give ${dialog.asset.name}` : 'Assign asset'}</DialogTitle>
        <DialogDescription>
          {dialog.asset.assetTag} · {dialog.asset.name}
          {from && <> — currently with <span className="font-medium text-foreground">{from}</span></>}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {give && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">One-time item — it’s theirs to keep. Stock goes down; nothing to return.</p>}
        <Field label={transfer ? 'Transfer to' : give ? 'Give to' : 'Assign to'} required error={error ?? undefined}>
          <HolderPicker
            holderType={holderType}
            holderId={holderId}
            allowed={allowed}
            invalid={!!error}
            onChange={(t, id) => {
              setHolderType(t);
              setHolderId(id);
              setError(null);
            }}
          />
        </Field>
        {pooled && !transfer && (
          <Field label="Quantity" hint={`${dialog.asset.availableQuantity ?? 0} available`}>
            <Input type="number" min={1} max={dialog.asset.availableQuantity} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        )}
        {holderType !== 'INVENTORY' && !give && (
          <Field label="Expected return" hint="Optional — for loans and temporary use">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        )}
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handover notes, accessories included…" />
        </Field>
        <Field label="Handover photos">
          <PhotoPicker files={photos} onChange={setPhotos} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} loading={action.isPending}>
          {transfer ? 'Transfer' : give ? 'Give' : 'Assign'}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReturnBody({ dialog, onClose, onDone }: { dialog: Extract<AssetDialog, { kind: 'return' }>; onClose: () => void; onDone?: () => void }) {
  const [condition, setCondition] = useState<Condition>('GOOD');
  const [makeAvailable, setMakeAvailable] = useState(true);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const action = useAction(onClose, onDone);
  const holder = dialog.allocation?.holderName ?? dialog.asset.holderName;
  useEffect(() => {
    if (condition === 'DAMAGED' || condition === 'POOR') setMakeAvailable(false);
  }, [condition]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Return asset</DialogTitle>
        <DialogDescription>
          {dialog.asset.assetTag} · {dialog.asset.name}
          {holder && (
            <>
              {' '}
              — from <span className="font-medium text-foreground">{holder}</span>
              {dialog.allocation?.quantity && dialog.allocation.quantity > 1 ? ` (${dialog.allocation.quantity} units)` : ''}
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Field label="Condition on return">
          <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-1">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`cursor-pointer rounded-md px-1 py-1.5 text-xs font-medium transition ${condition === c ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {humanize(c)}
              </button>
            ))}
          </div>
        </Field>
        {dialog.asset.trackingMode === 'INDIVIDUAL' && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">Ready to reuse</span>
              <span className="text-xs text-muted-foreground">{makeAvailable ? 'Goes straight back to Available.' : 'Stays Returned until inspected.'}</span>
            </span>
            <Switch checked={makeAvailable} onCheckedChange={setMakeAvailable} disabled={condition === 'DAMAGED'} />
          </label>
        )}
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Missing accessories, scratches…" />
        </Field>
        <Field label="Return photos">
          <PhotoPicker files={photos} onChange={setPhotos} hint="Optional · capture scratches or damage as proof" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={action.isPending}
          onClick={() =>
            action.mutate(
              { path: `/assets/${dialog.asset.id}/return`, body: { allocationId: dialog.allocation?.id, condition, makeAvailable, notes }, photos: { assetId: dialog.asset.id, kind: 'RETURN', files: photos } },
              { onSuccess: () => toast.success(`${dialog.asset.assetTag} returned`) },
            )
          }
        >
          Confirm return
        </Button>
      </DialogFooter>
    </>
  );
}

function LifecycleBody({ dialog, onClose, onDone }: { dialog: Extract<AssetDialog, { kind: 'lifecycle' }>; onClose: () => void; onDone?: () => void }) {
  const rule = LIFECYCLE[dialog.action];
  const [notes, setNotes] = useState('');
  const action = useAction(onClose, onDone);
  const danger = rule.tone === 'danger';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule.label}</DialogTitle>
        <DialogDescription>
          {dialog.asset.assetTag} · {dialog.asset.name} — {rule.description.toLowerCase()}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {dialog.asset.holderName && (dialog.action === 'mark_lost' || dialog.action === 'retire') && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Currently held by <HolderLabel type={dialog.asset.holderType ?? null} name={dialog.asset.holderName} className="font-medium" />. Their assignment will be closed.
          </p>
        )}
        <Field label={danger ? 'Reason' : 'Notes'}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={dialog.action === 'dispose' ? 'Sold / scrapped / e-waste certificate no.' : undefined} />
        </Field>
        {dialog.action === 'dispose' && <p className="text-xs text-muted-foreground">Disposal is final. The asset and its full history stay on record ({formatDate(new Date())}).</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'destructive' : 'default'}
          loading={action.isPending}
          onClick={() =>
            action.mutate(
              { path: `/assets/${dialog.asset.id}/lifecycle`, body: { action: dialog.action, notes } },
              { onSuccess: () => toast.success(`${rule.label}: ${dialog.asset.assetTag}`) },
            )
          }
        >
          {rule.label}
        </Button>
      </DialogFooter>
    </>
  );
}

