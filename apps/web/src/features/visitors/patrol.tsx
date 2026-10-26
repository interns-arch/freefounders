/**
 * Patrol rounds (PLAN.md §22.10): QR stickers at checkpoints; the guard scans each on the round (with a note when
 * something is wrong). A checkpoint not checked for N hours in the patrol hours alerts the security head. Admins add
 * checkpoints and print the stickers; the register sees every round and downloads it.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { fileSlug } from '@kaampilot/core/export';
import { type Checkpoint, type VisitorConfig, useCheckpoints, useGuards, usePatrolScan, usePatrolScans, useSaveCheckpoint, visitorExportsV3 } from '@kaampilot/core/visitors';
import QRCodeLib from 'qrcode';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, MapPin, Pencil, Plus, Printer, ScanLine } from '@/components/icons';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, CardContent, Switch } from '@/components/ui/primitives';
import { CameraScanner } from '@/features/assets/inventory/scan-page';
import { todayISO } from '@/lib/utils';
import { clock, printHtml } from './parts';

const hours = (a: number, b: number) => (a === b ? 'all day' : `${String(a).padStart(2, '0')}:00–${String(b).padStart(2, '0')}:00`);

export function PatrolPage({ config }: { config: VisitorConfig }) {
  const manage = config.can.settings;
  const [showOff, setShowOff] = useState(false);
  const list = useCheckpoints(manage && showOff);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<Checkpoint | 'new' | null>(null);
  const [printing, setPrinting] = useState(false);
  const d = list.data;
  const cps = d?.checkpoints ?? [];
  const overdue = cps.filter((c) => c.overdue && c.active).length;
  const printStickers = async () => {
    setPrinting(true);
    try {
      const cells = await Promise.all(
        cps
          .filter((c) => c.active && c.code)
          .map(async (c) => `<div class="s"><img src="${await QRCodeLib.toDataURL(c.code!, { margin: 1, width: 360 })}" alt=""><b>${c.name.replace(/</g, '&lt;')}</b><small>Patrol checkpoint · scan on every round</small></div>`),
      );
      await printHtml(
        `<!doctype html><html><head><meta charset="utf-8"><title>Patrol checkpoint stickers</title><style>@page{size:A4;margin:10mm}body{margin:0;font-family:sans-serif;color:black;background:white}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.s{border:1px dashed black;padding:4mm;text-align:center;break-inside:avoid}.s img{width:100%}.s b{display:block;font-size:14pt;margin-top:2mm}.s small{font-size:8pt}</style></head><body><div class="g">${cells.join('')}</div></body></html>`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Patrol"
        description={d ? `Scan every checkpoint at least every ${d.every_hours || '—'} h (patrol hours: ${hours(d.patrol_from, d.patrol_to)}). ${overdue ? `${overdue} not checked in time.` : 'All checked in time.'}` : 'Guard rounds with QR checkpoints.'}
        actions={
          <>
            {manage && (
              <>
                <Button variant="outline" size="lg" onClick={() => void printStickers()} loading={printing} disabled={!cps.some((c) => c.active)}>
                  <Printer /> Print stickers
                </Button>
                <Button variant="outline" size="lg" onClick={() => setEditing('new')}>
                  <Plus /> Add checkpoint
                </Button>
              </>
            )}
            {config.can.gate && (
              <Button variant="cta" size="lg" onClick={() => setScanning(true)}>
                <ScanLine /> Scan checkpoint
              </Button>
            )}
          </>
        }
      />
      {manage && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Switch checked={showOff} onCheckedChange={setShowOff} aria-label="Show switched-off checkpoints" /> Show switched-off checkpoints
        </label>
      )}
      {cps.length === 0 && !list.isLoading ? (
        <EmptyState icon={MapPin} title="No checkpoints yet" description={manage ? 'Add checkpoints (back gate, store room, parking…), print the QR stickers and put them up.' : 'An admin adds checkpoints and puts up their QR stickers.'} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cps.map((c) => (
            <Card key={c.id} data-testid={`checkpoint-${c.id}`}>
              <CardContent className="flex items-start justify-between gap-2 pt-4">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 font-semibold">
                    {c.overdue ? <AlertTriangle className="size-4 text-warning" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                    {c.name}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {c.last_scan_at ? `Last checked ${clock(c.last_scan_at)}` : 'Never checked'}
                    {c.location ? ` · ${c.location.name}` : ''}
                  </p>
                  <div className="flex gap-1">
                    {!c.active ? <Badge tone="neutral">Switched off</Badge> : c.overdue ? <Badge tone="amber">Due now</Badge> : <Badge tone="green">On time</Badge>}
                  </div>
                </div>
                {manage && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`Change ${c.name}`}>
                    <Pencil />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {config.can.view_all ? <RoundsLog /> : null}
      {scanning && <ScanCheckpointDialog onClose={() => setScanning(false)} />}
      {editing && <CheckpointSheet config={config} checkpoint={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ScanCheckpointDialog({ onClose }: { onClose: () => void }) {
  const scan = usePatrolScan();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState('');
  const send = async (value: string) => {
    if (!value.trim() || scan.isPending) return;
    if (problem && !note.trim()) return void toast.error('Say what is wrong.');
    let pos: GeolocationPosition | null = null;
    try {
      pos = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 4000, maximumAge: 60_000 });
      });
    } catch {
      pos = null;
    }
    try {
      const r = await scan.mutateAsync({ code: value.trim(), note: note.trim(), all_ok: !problem, latitude: pos?.coords.latitude ?? null, longitude: pos?.coords.longitude ?? null });
      toast.success(`${r.checkpoint.name} checked${problem ? ': the security head is told' : ''}`);
      setCode('');
      setNote('');
      setProblem(false);
    } catch (e) {
      toast.error(e instanceof ApiError && e.errors?.code ? e.errors.code : errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan checkpoint</DialogTitle>
          <DialogDescription>Scan the QR sticker at each checkpoint on your round. Keep this open for the next one.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={problem} onCheckedChange={setProblem} aria-label="Something is wrong here" /> Something is wrong here
        </label>
        {problem && <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong (lock broken, light off, water leak…)" aria-label="What is wrong" />}
        <CameraScanner onCode={(c) => void send(c)} />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(code);
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Sticker code" className="h-11 font-mono" aria-label="Sticker code" />
          <Button type="submit" size="lg" loading={scan.isPending}>
            Checked
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CheckpointSheet({ config, checkpoint, onClose }: { config: VisitorConfig; checkpoint: Checkpoint | null; onClose: () => void }) {
  const [f, setF] = useState({ name: checkpoint?.name ?? '', location: checkpoint?.location?.id ?? (null as number | null), order: checkpoint?.order ?? 0, active: checkpoint?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveCheckpoint();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErrors({ name: 'Name the checkpoint.' });
    try {
      await save.mutateAsync({ id: checkpoint?.id, ...f });
      toast.success(checkpoint ? 'Checkpoint saved' : 'Checkpoint added: print its sticker');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title={checkpoint ? `Change ${checkpoint.name}` : 'New checkpoint'} onSubmit={submit} submitting={save.isPending} errors={errors} size="sm">
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Back gate, Store room, Parking…" className="h-11" name="name" />
        </Field>
        {config.locations.length > 0 && (
          <Field label="Site">
            <NativeSelect value={f.location ?? ''} onChange={(e) => setF({ ...f, location: e.target.value ? Number(e.target.value) : null })} className="h-11">
              <option value="">—</option>
              {config.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Order on the round" hint="Lower first">
          <Input type="number" min={0} max={999} value={f.order} onChange={(e) => setF({ ...f, order: Number(e.target.value) || 0 })} className="h-11 w-28" />
        </Field>
        {checkpoint && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} aria-label="Checkpoint on" /> On (switched off: not on the round)
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void save.mutateAsync({ id: checkpoint.id, regenerate: true }).then(
                  () => toast.success('New sticker code: print and replace the sticker'),
                  (e) => toast.error(errorMessage(e)),
                )
              }
            >
              New sticker code
            </Button>
          </>
        )}
      </div>
    </FormSheet>
  );
}

function RoundsLog() {
  const [f, setF] = useState({ date_from: todayISO(-1), date_to: todayISO(), guard: '' as number | '' });
  const scans = usePatrolScans(f);
  const guards = useGuards();
  const rows = scans.data ?? [];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Rounds</h2>
        <DownloadMenu filename={fileSlug('visitors-patrol', f.date_from, f.date_to)} target={visitorExportsV3.patrol(f)} empty={!rows.length} loading={scans.isLoading} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <NativeSelect value={f.guard} onChange={(e) => setF({ ...f, guard: e.target.value ? Number(e.target.value) : '' })} aria-label="Guard" className="w-auto">
          <option value="">Every guard</option>
          {(guards.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} aria-label="From" className="w-auto" />
        <Input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} aria-label="To" className="w-auto" />
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={scans.isLoading}
        fetching={scans.isFetching}
        error={scans.error}
        onRetry={() => void scans.refetch()}
        empty="No rounds in this period."
        columns={[
          { key: 'at', header: 'When', cell: (r) => clock(r.at) },
          { key: 'cp', header: 'Checkpoint', cell: (r) => <span className="font-medium">{r.checkpoint.name}</span> },
          { key: 'guard', header: 'Guard', cell: (r) => r.guard?.name ?? '—' },
          { key: 'ok', header: 'Status', cell: (r) => (r.all_ok ? <Badge tone="green">All OK</Badge> : <Badge tone="red">Problem</Badge>) },
          { key: 'note', header: 'Note', cell: (r) => r.note || '—', hideOnMobile: true },
        ]}
      />
    </section>
  );
}
