/**
 * Deliveries (PLAN.md §22.9): parcels and couriers received at the gate. The person it is for is told at once (and
 * reminded if it waits too long); the gate hands it over to them or to someone collecting for them, or returns it.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { fileSlug } from '@kaampilot/core/export';
import {
  type Delivery,
  type DeliveryFilters,
  type DeliveryInput,
  type PersonBrief,
  type VisitorConfig,
  DELIVERY_STATUS_LABELS,
  useCollectDelivery,
  useDeliveries,
  useDeliveryPhoto,
  useReceiveDelivery,
  useReturnDelivery,
  visitorExports,
} from '@kaampilot/core/visitors';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Package, PackageCheck, Plus, Undo2 } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { Segmented } from '@/components/common/controls';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { HostPicker, PhotoField, PrivatePhoto, clock } from './parts';

type View = 'at_gate' | 'today' | 'history';
const COURIERS = ['Amazon', 'Flipkart', 'BlueDart', 'Delhivery', 'DTDC', 'Ekart', 'India Post', 'Professional Couriers', 'Shadowfax', 'XpressBees', 'Zomato / Swiggy', 'Hand delivery'];

const forWhom = (d: Delivery) => d.recipient?.name || d.recipient_label || '—';

export function DeliveriesPage({ config }: { config: VisitorConfig }) {
  const gate = config.can.gate;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('at_gate');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const filters: DeliveryFilters = view === 'history' ? { q, date_from: from, date_to: to } : { scope: view, q };
  const list = useDeliveries(filters, { live: view !== 'history', pageSize: 200 });
  const [adding, setAdding] = useState(params.get('new') === '1' && gate);
  const [handing, setHanding] = useState<Delivery | null>(null);
  const [open, setOpen] = useState<Delivery | null>(null);
  const back = useReturnDelivery();
  const confirm = useConfirm();
  const rows = list.data?.results ?? [];
  const views: Array<[View, string]> = [['at_gate', 'At the gate'], ['today', 'Today'], ...(config.can.view_all ? [['history', 'History'] as [View, string]] : [])];

  useEffect(() => {
    if (params.get('new')) setParams((p) => (p.delete('new'), p), { replace: true });
  }, [params, setParams]);

  const returnIt = async (d: Delivery) => {
    const r = await confirm({ title: 'Return to the courier?', description: `The parcel for ${forWhom(d)} goes back${d.courier ? ` to ${d.courier}` : ''}. This is recorded.`, confirmText: 'Returned', note: { label: 'Note (optional)' } });
    if (!r.confirmed) return;
    try {
      await back.mutateAsync({ id: d.id, notes: r.note });
      toast.success('Marked as returned');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Parcels"
        description="Couriers and deliveries at the gate. The person it is for is told at once."
        actions={
          <>
            <DownloadMenu filename={fileSlug('visitors-parcels', view, view === 'history' ? `${from}-${to}` : todayISO())} target={visitorExports.deliveries(filters)} empty={!rows.length} loading={list.isLoading} />
            {gate && (
              <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
                <Plus /> Receive parcel
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented options={views} value={view} onChange={setView} label="Which parcels" />
        <SearchField value={q} onChange={setQ} label="Search courier, tracking no. or person" className="w-full max-w-xs" />
        {view === 'history' && (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="w-auto" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="w-auto" />
          </>
        )}
      </div>

      {view === 'at_gate' ? (
        rows.length === 0 && !list.isLoading ? (
          <EmptyState icon={Package} title="No parcel is waiting" description="Parcels you receive show here until they are handed over." />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {rows.map((d) => (
              <ParcelCard key={d.id} delivery={d} onOpen={() => setOpen(d)}>
                {gate && (
                  <>
                    <Button size="lg" variant="success" onClick={() => setHanding(d)}>
                      <PackageCheck /> Hand over
                    </Button>
                    <Button size="lg" variant="outline" onClick={() => void returnIt(d)}>
                      <Undo2 /> Return
                    </Button>
                  </>
                )}
              </ParcelCard>
            ))}
          </div>
        )
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => String(r.id)}
          loading={list.isLoading}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={setOpen}
          empty="No parcels."
          columns={[
            { key: 'in', header: 'Received', cell: (r) => clock(r.received_at) },
            { key: 'for', header: 'For', cell: (r) => <span className="font-medium">{forWhom(r)}</span> },
            { key: 'courier', header: 'Courier', cell: (r) => [r.courier, r.tracking_no].filter(Boolean).join(' · ') || '—' },
            { key: 'n', header: 'Parcels', cell: (r) => r.parcels, hideOnMobile: true },
            { key: 'status', header: 'Status', cell: (r) => <DeliveryBadge d={r} /> },
            { key: 'to', header: 'Handed to', cell: (r) => (r.collected_by_name ? `${r.collected_by_name} · ${clock(r.closed_at)}` : '—'), hideOnMobile: true },
            { key: 'by', header: 'Received by', cell: (r) => r.received_by || '—', hideOnMobile: true },
          ]}
        />
      )}
      {adding && <ReceiveSheet config={config} onClose={() => setAdding(false)} />}
      <HandOverDialog delivery={handing} onClose={() => setHanding(null)} />
      <DeliveryDialog delivery={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function DeliveryBadge({ d }: { d: Delivery }) {
  return <Badge tone={d.status === 'at_gate' ? 'amber' : d.status === 'collected' ? 'green' : 'neutral'}>{DELIVERY_STATUS_LABELS[d.status]}</Badge>;
}

function ParcelCard({ delivery: d, onOpen, children }: { delivery: Delivery; onOpen: () => void; children?: React.ReactNode }) {
  const photo = useDeliveryPhoto(d.has_photo ? d.id : null);
  return (
    <Card data-testid={`parcel-${d.id}`}>
      <CardContent className="flex gap-3 pt-4">
        {d.has_photo ? <PrivatePhoto query={photo} alt="Parcel" className="size-16 shrink-0" /> : <Package className="mt-0.5 size-8 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="cursor-pointer truncate text-left font-semibold hover:text-primary" onClick={onOpen}>
              For {forWhom(d)}
            </button>
            <DeliveryBadge d={d} />
            {d.reminded && <Badge tone="outline">Reminded</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {[`${d.parcels} parcel${d.parcels > 1 ? 's' : ''}`, d.courier, d.tracking_no, d.description].filter(Boolean).join(' · ')}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Received {clock(d.received_at)}
            {d.received_by ? ` by ${d.received_by}` : ''}
            {d.location ? ` · ${d.location.name}` : ''}
          </p>
          {children && <div className="flex flex-wrap gap-2 pt-1 max-sm:[&>button]:flex-1">{children}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiveSheet({ config, onClose }: { config: VisitorConfig; onClose: () => void }) {
  const [f, setF] = useState<DeliveryInput & { who: PersonBrief | null }>({
    courier: '',
    tracking_no: '',
    who: null,
    recipient_label: '',
    parcels: 1,
    description: '',
    location: config.locations[0]?.id ?? null,
    photo: null,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useReceiveDelivery();
  const listId = useId();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.who && !f.recipient_label?.trim()) {
      setErrors({ recipient: 'For whom is it? Pick a person (or type a department).' });
      return;
    }
    setErrors({});
    const { who, ...body } = f;
    try {
      const d = await save.mutateAsync({ ...body, recipient: who?.id ?? null, recipient_label: who ? '' : body.recipient_label });
      toast.success(d.recipient ? `Parcel received · ${d.recipient.name} is told` : 'Parcel received');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="Receive parcel" onSubmit={submit} submitting={save.isPending} submitLabel="Received" errors={errors}>
      <div className="space-y-4">
        <Field label="For whom" required error={errors.recipient}>
          <HostPicker host={f.who} label={f.recipient_label ?? ''} onChange={({ host, label }) => setF((cur) => ({ ...cur, who: host, recipient_label: label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Courier" htmlFor={`${listId}-courier`}>
            <Input id={`${listId}-courier`} value={f.courier} onChange={(e) => set('courier', e.target.value)} list={listId} className="h-11 text-base sm:text-sm" name="courier" />
            <datalist id={listId}>
              {COURIERS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Tracking / AWB no.">
            <Input value={f.tracking_no} onChange={(e) => set('tracking_no', e.target.value)} className="h-11 font-mono" name="tracking_no" />
          </Field>
          <Field label="Parcels" error={errors.parcels}>
            <Input type="number" min={1} max={99} value={f.parcels} onChange={(e) => set('parcels', Number(e.target.value) || 1)} className="h-11" />
          </Field>
          {config.locations.length > 0 && (
            <Field label="Gate / site">
              <NativeSelect value={f.location ?? ''} onChange={(e) => set('location', e.target.value ? Number(e.target.value) : null)} className="h-11">
                <option value="">—</option>
                {config.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
        <Field label="What is it" hint="Optional: box, envelope, documents…">
          <Input value={f.description} onChange={(e) => set('description', e.target.value)} className="h-11" />
        </Field>
        <Field label="Photo of the parcel" hint="Optional" error={errors.photo}>
          <PhotoField label="Parcel photo" value={f.photo ?? null} onChange={(v) => set('photo', v)} testId="parcel-photo" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </FormSheet>
  );
}

function HandOverDialog({ delivery: d, onClose }: { delivery: Delivery | null; onClose: () => void }) {
  const [taker, setTaker] = useState('');
  const collect = useCollectDelivery();
  useEffect(() => setTaker(d?.recipient?.name ?? ''), [d]);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!d) return;
    try {
      await collect.mutateAsync({ id: d.id, collected_by_name: taker.trim() });
      toast.success(`Handed to ${taker.trim() || forWhom(d)}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {d && (
          <form onSubmit={go} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Hand over the parcel</DialogTitle>
              <DialogDescription>
                For {forWhom(d)}
                {d.courier ? ` · ${d.courier}` : ''}
                {d.tracking_no ? ` · ${d.tracking_no}` : ''}
              </DialogDescription>
            </DialogHeader>
            <Field label="Collected by" hint="The person, or whoever collects it for them" required>
              <Input value={taker} onChange={(e) => setTaker(e.target.value)} className="h-11 text-base sm:text-sm" name="collected_by_name" autoFocus />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="success" loading={collect.isPending} disabled={!taker.trim()}>
                <PackageCheck /> Handed over
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeliveryDialog({ delivery: d, onClose }: { delivery: Delivery | null; onClose: () => void }) {
  const photo = useDeliveryPhoto(d?.has_photo ? d.id : null);
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {d && (
          <>
            <DialogHeader>
              <DialogTitle>Parcel for {forWhom(d)}</DialogTitle>
              <DialogDescription>{[d.courier, d.tracking_no].filter(Boolean).join(' · ') || 'Parcel'}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-3">
              {d.has_photo && <PrivatePhoto query={photo} alt="Parcel" className="size-28 shrink-0" />}
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {[
                  ['Status', DELIVERY_STATUS_LABELS[d.status]],
                  ['Parcels', String(d.parcels)],
                  ['What', d.description],
                  ['Gate', d.location?.name],
                  ['Received', `${clock(d.received_at)}${d.received_by ? ` by ${d.received_by}` : ''}`],
                  ['Handed to', d.collected_by_name ? `${d.collected_by_name} · ${clock(d.closed_at)}${d.closed_by ? ` (by ${d.closed_by})` : ''}` : ''],
                  ['Returned', d.status === 'returned' ? `${clock(d.closed_at)}${d.closed_by ? ` by ${d.closed_by}` : ''}` : ''],
                  ['Notes', d.notes],
                ]
                  .filter(([, x]) => x)
                  .map(([k, x]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{x}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
