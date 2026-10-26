/** Vehicles (PLAN.md §22): in with a photo of the vehicle / number plate, out (photo optional), time inside, history. */
import { ApiError, errorMessage } from '@kaampilot/core';
import { fileSlug } from '@kaampilot/core/export';
import {
  type VehicleEntry,
  type VehicleFilters,
  type VehicleInInput,
  type VisitorConfig,
  formatMinutes,
  useVehicleIn,
  useVehicleOut,
  useVehiclePhoto,
  useVehicles,
  useVisits,
  visitorExports,
} from '@kaampilot/core/visitors';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Car, LogOut, Plus } from '@/components/icons';
import { Segmented } from '@/components/common/controls';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { PhotoField, PrivatePhoto, clock } from './parts';

type View = 'inside' | 'today' | 'history';

export function VehiclesPage({ config }: { config: VisitorConfig }) {
  const gate = config.can.gate;
  const [view, setView] = useState<View>('inside');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO());
  const filters: VehicleFilters = view === 'history' ? { q, date_from: from, date_to: to } : { scope: view, q };
  const list = useVehicles(filters, { live: view !== 'history', pageSize: 200 });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<VehicleEntry | null>(null);
  const rows = list.data?.results ?? [];
  const views: Array<[View, string]> = [['inside', 'Inside now'], ['today', 'Today'], ...(config.can.view_all ? [['history', 'History'] as [View, string]] : [])];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vehicles"
        description="Which vehicle came in and went out, with the photo and the time inside."
        actions={
          <>
            <DownloadMenu filename={fileSlug('visitors-vehicles', view, view === 'history' ? `${from}-${to}` : todayISO())} target={visitorExports.vehicles(filters)} empty={!rows.length} loading={list.isLoading} />
            {gate && (
              <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
                <Plus /> Vehicle in
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented options={views} value={view} onChange={setView} label="Which vehicles" />
        <SearchField value={q} onChange={setQ} label="Search vehicle number or driver" className="w-full max-w-xs" />
        {view === 'history' && (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="w-auto" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="w-auto" />
          </>
        )}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={setOpen}
        empty={view === 'inside' ? 'No vehicle is inside.' : 'No vehicles.'}
        columns={[
          { key: 'number', header: 'Vehicle', cell: (r) => <span className="font-mono font-semibold">{r.number}</span> },
          { key: 'type', header: 'Type', cell: (r) => r.type_display },
          { key: 'driver', header: 'Driver', cell: (r) => [r.driver_name, r.driver_mobile].filter(Boolean).join(' · ') || '—' },
          { key: 'purpose', header: 'Purpose / from', cell: (r) => [r.purpose, r.company].filter(Boolean).join(' · ') || '—', hideOnMobile: true },
          { key: 'in', header: 'In', cell: (r) => clock(r.in_at) },
          { key: 'out', header: 'Out', cell: (r) => (r.out_at ? clock(r.out_at) : <Badge tone="green">Inside</Badge>) },
          { key: 'time', header: 'Time inside', cell: (r) => formatMinutes(r.minutes_inside) },
          {
            key: 'act',
            header: <span className="sr-only">Actions</span>,
            cell: (r) =>
              gate && r.inside ? (
                <Button size="sm" variant="outline" onClick={(e) => (e.stopPropagation(), setOpen(r))}>
                  <LogOut /> Out
                </Button>
              ) : null,
          },
        ]}
      />
      {adding && <VehicleInSheet config={config} onClose={() => setAdding(false)} />}
      <VehicleDialog entry={open} gate={gate} onClose={() => setOpen(null)} />
    </div>
  );
}

function VehicleInSheet({ config, onClose }: { config: VisitorConfig; onClose: () => void }) {
  const [f, setF] = useState<VehicleInInput>({ number: '', type: 'car', driver_name: '', driver_mobile: '', purpose: '', company: '', items: '', parking_slot: '', location: config.locations[0]?.id ?? null, visit: null, photo: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useVehicleIn();
  const visitors = useVisits({ scope: 'today' }, { pageSize: 100 });
  const set = <K extends keyof VehicleInInput>(k: K, v: VehicleInInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.number.replace(/[^A-Za-z0-9]/g, '').length < 4) local.number = 'Enter the vehicle number.';
    if (config.photo_vehicle && !f.photo) local.photo = 'Take a photo of the vehicle / number plate.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const v = await save.mutateAsync(f);
      toast.success(`${v.number} in`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="Vehicle in" onSubmit={submit} submitting={save.isPending} submitLabel="Vehicle in" errors={errors}>
      <div className="space-y-4">
        <Field label="Vehicle number" required error={errors.number}>
          <Input value={f.number} onChange={(e) => set('number', e.target.value.toUpperCase())} className="h-11 font-mono text-base sm:text-sm" placeholder="MH12AB1234" autoCapitalize="characters" name="number" />
        </Field>
        <Field label="Type">
          <NativeSelect value={f.type} onChange={(e) => set('type', e.target.value)} className="h-11" name="type">
            {config.vehicle_types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Photo of the vehicle / number plate" required={config.photo_vehicle} error={errors.photo}>
          <PhotoField label="Vehicle photo" value={f.photo ?? null} onChange={(v) => set('photo', v)} required={config.photo_vehicle} testId="vehicle-photo" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Driver name">
            <Input value={f.driver_name} onChange={(e) => set('driver_name', e.target.value)} className="h-11" name="driver_name" />
          </Field>
          <Field label="Driver mobile" error={errors.driver_mobile}>
            <Input type="tel" inputMode="numeric" value={f.driver_mobile} onChange={(e) => set('driver_mobile', e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field label="Purpose">
          <Input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="h-11" placeholder="Delivery, pickup, guest…" />
        </Field>
        <Field label="Company / from">
          <Input value={f.company} onChange={(e) => set('company', e.target.value)} className="h-11" />
        </Field>
        <Field label="Visitor in this vehicle" hint="Optional">
          <NativeSelect value={f.visit ?? ''} onChange={(e) => set('visit', e.target.value ? Number(e.target.value) : null)} className="h-11">
            <option value="">—</option>
            {(visitors.data?.results ?? [])
              .filter((v) => v.status === 'inside' || v.status === 'waiting' || v.status === 'waiting_host')
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.pass_no || v.short_code})
                </option>
              ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Parking slot">
            <Input value={f.parking_slot} onChange={(e) => set('parking_slot', e.target.value)} className="h-11" />
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
        <Field label="Items / material">
          <Textarea value={f.items} onChange={(e) => set('items', e.target.value)} rows={2} />
        </Field>
      </div>
    </FormSheet>
  );
}

function VehicleDialog({ entry, gate, onClose }: { entry: VehicleEntry | null; gate: boolean; onClose: () => void }) {
  const photoIn = useVehiclePhoto(entry?.has_photo_in ? entry.id : null, 'in');
  const photoOut = useVehiclePhoto(entry?.has_photo_out ? entry.id : null, 'out');
  const [photo, setPhoto] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const out = useVehicleOut();
  const close = () => {
    setPhoto(null);
    setNotes('');
    onClose();
  };
  const checkOut = async () => {
    if (!entry) return;
    try {
      const v = await out.mutateAsync({ id: entry.id, photo, notes });
      toast.success(`${v.number} out · ${formatMinutes(v.minutes_inside)} inside`);
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Car className="size-5" /> <span className="font-mono">{entry.number}</span>
              </DialogTitle>
              <DialogDescription>
                {entry.type_display} · in {clock(entry.in_at)} by {entry.in_by || '—'}
                {entry.out_at ? ` · out ${clock(entry.out_at)} by ${entry.out_by || '—'}` : ''} · {formatMinutes(entry.minutes_inside)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <figure>
                <PrivatePhoto query={photoIn} alt="Vehicle in" className="aspect-[4/3] w-full" />
                <figcaption className="mt-1 text-xs text-muted-foreground">In</figcaption>
              </figure>
              {entry.has_photo_out && (
                <figure>
                  <PrivatePhoto query={photoOut} alt="Vehicle out" className="aspect-[4/3] w-full" />
                  <figcaption className="mt-1 text-xs text-muted-foreground">Out</figcaption>
                </figure>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {[
                ['Driver', [entry.driver_name, entry.driver_mobile].filter(Boolean).join(' · ')],
                ['Purpose', entry.purpose],
                ['From', entry.company],
                ['Visitor', entry.visits.map((v) => v.name).join(', ')],
                ['Parking', entry.parking_slot],
                ['Items', entry.items],
                ['Notes', entry.notes],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {gate && entry.inside && (
              <div className="space-y-3 border-t pt-3">
                <PhotoField label="Photo when leaving (optional)" value={photo} onChange={setPhoto} />
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (material going out…)" aria-label="Note" className="h-11" />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              {gate && entry.inside && (
                <Button size="lg" onClick={() => void checkOut()} loading={out.isPending}>
                  <LogOut /> Vehicle out
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
