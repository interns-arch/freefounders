/**
 * Material gate pass (PLAN.md §22.10): goods going out (or coming in). An employee asks; their manager (or the security
 * head) approves; the guard checks the items at the gate. Returnable goods are expected back by a date; assets picked
 * from the Assets app get the movement in their history there.
 */
import { ApiError, errorMessage, useAccess } from '@freefounders/core';
import { usePickerAssets } from '@freefounders/core/assets';
import { fileSlug } from '@freefounders/core/export';
import {
  type MaterialInput,
  type MaterialItemInput,
  type MaterialPass,
  type MaterialScope,
  type VisitorConfig,
  MATERIAL_STATUS_LABELS,
  useCancelMaterial,
  useCreateMaterial,
  useDecideMaterial,
  useGateMaterial,
  useMaterialPass,
  useMaterialPasses,
  useReturnMaterial,
  visitorExportsV3,
} from '@freefounders/core/visitors';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, Boxes, Check, Plus, RotateCcw, Tag, Trash2, Truck, X } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { QRCode } from '@/components/common/codes';
import { Segmented } from '@/components/common/controls';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, type BadgeTone, Card, CardContent, Checkbox } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { clock } from './parts';

const TONE: Record<MaterialPass['status'], BadgeTone> = { pending: 'amber', approved: 'blue', rejected: 'red', passed: 'green', returned: 'neutral', cancelled: 'neutral' };
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

export function MaterialBadge({ m }: { m: MaterialPass }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={TONE[m.status]}>{MATERIAL_STATUS_LABELS[m.status]}</Badge>
      {m.overdue && <Badge tone="red">Not back</Badge>}
      {m.returnable && m.status !== 'returned' && !m.overdue && <Badge tone="outline">Returnable</Badge>}
    </span>
  );
}

export function MaterialPage({ config }: { config: VisitorConfig }) {
  const [params, setParams] = useSearchParams();
  const gate = config.can.gate;
  const scopes: Array<[MaterialScope, string]> = [
    ['approvals', 'For my approval'],
    ...(gate ? ([['gate', 'At the gate']] as Array<[MaterialScope, string]>) : []),
    ['mine', 'Asked by me'],
    ['out', 'Out, to come back'],
    ...(config.can.view_all ? ([['', 'All']] as Array<[MaterialScope, string]>) : []),
  ];
  const [scope, setScope] = useState<MaterialScope>(gate ? 'gate' : 'mine');
  const [q, setQ] = useState('');
  const list = useMaterialPasses({ scope, q }, { live: true });
  const approvals = useMaterialPasses({ scope: 'approvals' }, { live: true });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(Number(params.get('open')) || null);
  useEffect(() => {
    if (params.get('open')) setParams((p) => (p.delete('open'), p), { replace: true });
  }, [params, setParams]);
  const rows = list.data?.results ?? [];
  const waitingForMe = approvals.data?.count ?? 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Material gate pass"
        description="Goods going out (or coming in): asked by an employee, approved by their manager or the security head, checked at the gate."
        actions={
          <>
            <DownloadMenu filename={fileSlug('visitors-material', scope || 'all', todayISO())} target={visitorExportsV3.material({ scope, q })} empty={!rows.length} loading={list.isLoading} />
            <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
              <Plus /> Ask for a pass
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented options={scopes.map(([v, l]) => [v, v === 'approvals' && waitingForMe ? `${l} (${waitingForMe})` : l] as [MaterialScope, string])} value={scope} onChange={setScope} label="Which passes" />
        <SearchField value={q} onChange={setQ} label="Search pass, item, asset tag or purpose" className="w-full max-w-xs" />
      </div>
      {rows.length === 0 && !list.isLoading ? (
        <EmptyState icon={Boxes} title="No material passes here" description={scope === 'gate' ? 'Approved passes show here for the gate to check.' : 'Ask for a pass when goods or an asset leave the premises.'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((m) => (
            <Card key={m.id} data-testid={`material-${m.id}`}>
              <CardContent className="space-y-1 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="cursor-pointer font-mono font-semibold hover:text-primary" onClick={() => setOpenId(m.id)}>
                    {m.pass_no}
                  </button>
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium">
                    {m.direction === 'out' ? <ArrowRight className="size-3.5" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />} {m.direction_display}
                  </span>
                  <MaterialBadge m={m} />
                </div>
                <p className="text-sm">{m.summary}</p>
                <p className="text-[13px] text-muted-foreground">
                  {[m.purpose, m.requested_by ? `asked by ${m.requested_by.name}` : null, clock(m.requested_at), m.returnable ? `back by ${day(m.expected_return)}` : null].filter(Boolean).join(' · ')}
                </p>
                <div className="pt-1">
                  <Button size="sm" variant="outline" onClick={() => setOpenId(m.id)}>
                    Open
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {adding && <MaterialSheet config={config} onClose={() => setAdding(false)} onDone={(m) => (setAdding(false), setOpenId(m.id))} />}
      {openId != null && <MaterialDialog id={openId} config={config} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function AssetPick({ onPick }: { onPick: (a: { id: string; tag: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  const found = usePickerAssets(q, undefined, q.trim().length >= 2);
  return (
    <div className="space-y-1.5">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an asset tag or name (optional)" className="h-10" aria-label="Search assets" />
      {q.trim().length >= 2 && (
        <div className="flex flex-wrap gap-1.5">
          {(found.data?.items ?? []).slice(0, 6).map((a) => (
            <Button
              key={a.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onPick({ id: a.id, tag: a.assetTag, name: a.name });
                setQ('');
              }}
            >
              <Tag /> <span className="font-mono">{a.assetTag}</span> {a.name}
            </Button>
          ))}
          {found.data && !found.data.items?.length && <span className="text-[13px] text-muted-foreground">No asset found.</span>}
        </div>
      )}
    </div>
  );
}

const blankItem = (): MaterialItemInput => ({ description: '', quantity: 1, unit: 'nos', asset_id: '', asset_tag: '' });

function MaterialSheet({ config, onClose, onDone }: { config: VisitorConfig; onClose: () => void; onDone: (m: MaterialPass) => void }) {
  const access = useAccess();
  const canAssets = access.assets.on;
  const [f, setF] = useState<MaterialInput>({ direction: 'out', purpose: '', items: [blankItem()], returnable: false, expected_return: null, carrier_name: '', carrier_company: '', vehicle_no: '', location: null, notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useCreateMaterial();
  const set = <K extends keyof MaterialInput>(k: K, v: MaterialInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setItem = (i: number, patch: Partial<MaterialItemInput>) => setF((cur) => ({ ...cur, items: cur.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.purpose.trim()) local.purpose = 'Why is it going out (or coming in)?';
    f.items.forEach((it, i) => {
      if (!it.description.trim()) local[`items.${i}.description`] = 'What is it?';
      if (!(Number(it.quantity) > 0)) local[`items.${i}.quantity`] = 'Above 0';
    });
    if (f.returnable && !f.expected_return) local.expected_return = 'When will it come back?';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const m = await save.mutateAsync({ ...f, expected_return: f.returnable ? f.expected_return : null });
      toast.success(m.status === 'approved' ? `${m.pass_no} approved: the gate can let it through` : `${m.pass_no} sent for approval`);
      onDone(m);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="Ask for a material gate pass" description="Your manager (or the security head) approves it; the guard checks the items at the gate." onSubmit={submit} submitting={save.isPending} submitLabel="Ask for approval" errors={errors} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Direction">
            <NativeSelect value={f.direction} onChange={(e) => set('direction', e.target.value as 'out' | 'in')} className="h-11" name="direction">
              <option value="out">Going out</option>
              <option value="in">Coming in</option>
            </NativeSelect>
          </Field>
          {config.locations.length > 0 && (
            <Field label="Gate / site">
              <NativeSelect value={f.location ?? ''} onChange={(e) => set('location', e.target.value ? Number(e.target.value) : null)} className="h-11">
                <option value="">Any</option>
                {config.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
        <Field label="Purpose" required error={errors.purpose}>
          <Input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="h-11 text-base sm:text-sm" name="purpose" placeholder="Laptop repair at the vendor" />
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-[15px] font-semibold">Items ({f.items.length})</legend>
          {f.items.map((it, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3" data-testid={`material-item-${i}`}>
              <div className="grid grid-cols-[1fr_5.5rem_5rem] gap-2">
                <Field label="Item" required error={errors[`items.${i}.description`]}>
                  <Input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} className="h-11 text-base sm:text-sm" aria-label={`Item ${i + 1}`} />
                </Field>
                <Field label="Qty" error={errors[`items.${i}.quantity`]}>
                  <Input type="number" min={0} step="any" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} className="h-11" aria-label={`Item ${i + 1} quantity`} />
                </Field>
                <Field label="Unit">
                  <Input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} className="h-11" aria-label={`Item ${i + 1} unit`} />
                </Field>
              </div>
              {canAssets &&
                (it.asset_id ? (
                  <p className="flex items-center gap-2 text-[13px]">
                    <Tag className="size-3.5" aria-hidden /> Asset <span className="font-mono font-medium">{it.asset_tag}</span> (recorded in Assets)
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItem(i, { asset_id: '', asset_tag: '' })}>
                      Remove
                    </Button>
                  </p>
                ) : (
                  <AssetPick onPick={(a) => setItem(i, { asset_id: a.id, asset_tag: a.tag, description: it.description || a.name })} />
                ))}
              {f.items.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setF((cur) => ({ ...cur, items: cur.items.filter((_, j) => j !== i) }))}>
                  <Trash2 /> Remove item
                </Button>
              )}
            </div>
          ))}
          {errors.items && (
            <p role="alert" className="text-[13px] font-medium text-destructive">
              {errors.items}
            </p>
          )}
          {f.items.length < 50 && (
            <Button type="button" variant="outline" onClick={() => setF((cur) => ({ ...cur, items: [...cur.items, blankItem()] }))}>
              <Plus /> Add item
            </Button>
          )}
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox checked={!!f.returnable} onCheckedChange={(v) => set('returnable', v === true)} aria-label="Returnable" className="mt-0.5" />
          <span>
            <span className="block font-medium">Returnable: it comes back</span>
            <span className="block text-[13px] text-muted-foreground">The gate marks it back; if late, you and the security head are told.</span>
          </span>
        </label>
        {f.returnable && (
          <Field label="Expected back on" required error={errors.expected_return}>
            <Input type="date" min={todayISO()} value={f.expected_return ?? ''} onChange={(e) => set('expected_return', e.target.value || null)} className="h-11 w-48" name="expected_return" />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Carried by">
            <Input value={f.carrier_name} onChange={(e) => set('carrier_name', e.target.value)} className="h-11" name="carrier_name" />
          </Field>
          <Field label="Their company">
            <Input value={f.carrier_company} onChange={(e) => set('carrier_company', e.target.value)} className="h-11" name="carrier_company" />
          </Field>
          <Field label="Vehicle no." error={errors.vehicle_no}>
            <Input value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} className="h-11 font-mono" name="vehicle_no" />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </FormSheet>
  );
}

/** One pass: what is on it, the QR for the gate, and what this person can do now (approve, let through, mark back…). */
export function MaterialDialog({ id, config, onClose }: { id: number; config: VisitorConfig; onClose: () => void }) {
  const q = useMaterialPass(id);
  const decide = useDecideMaterial();
  const gateIt = useGateMaterial();
  const back = useReturnMaterial();
  const cancel = useCancelMaterial();
  const confirm = useConfirm();
  const m = q.data;
  const run = async (fn: () => Promise<MaterialPass>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reject = async () => {
    if (!m) return;
    const r = await confirm({ title: `Reject ${m.pass_no}?`, confirmText: 'Reject', destructive: true, note: { label: 'Why', required: true } });
    if (r.confirmed) await run(() => decide.mutateAsync({ id: m.id, decision: 'reject', note: r.note }), 'Rejected');
  };
  const pass = async () => {
    if (!m) return;
    const r = await confirm({ title: `Let ${m.pass_no} through?`, description: `Check the items: ${m.summary}.`, confirmText: m.direction === 'out' ? 'Checked, let it out' : 'Checked, let it in', note: { label: 'Note (optional)' } });
    if (r.confirmed) await run(() => gateIt.mutateAsync({ id: m.id, note: r.note }), `${m.pass_no} passed the gate`);
  };
  const mine = m && config.can.invite && m.requested_by != null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {!m ? (
          <DialogHeader>
            <DialogTitle>Material pass</DialogTitle>
            <DialogDescription>{q.error ? errorMessage(q.error) : 'Loading…'}</DialogDescription>
          </DialogHeader>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{m.pass_no}</span> <MaterialBadge m={m} />
              </DialogTitle>
              <DialogDescription>
                {m.direction_display} · {m.purpose}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-4">
              {['approved', 'passed'].includes(m.status) && (
                <div className="shrink-0 self-start rounded-lg border bg-white p-2">
                  <QRCode value={`KPM:${m.pass_token}`} size={104} />
                </div>
              )}
              <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-sm">
                {[
                  ['Asked by', m.requested_by ? `${m.requested_by.name} · ${clock(m.requested_at)}` : ''],
                  ['Decided', m.decided_at ? `${m.decided_by} · ${clock(m.decided_at)}${m.decision_note ? ` · ${m.decision_note}` : ''}` : ''],
                  ['Gate', m.gate_at ? `${m.gate_by} · ${clock(m.gate_at)}${m.gate_note ? ` · ${m.gate_note}` : ''}` : ''],
                  ['Back by', m.returnable ? day(m.expected_return) : ''],
                  ['Returned', m.returned_at ? `${clock(m.returned_at)} · ${m.returned_by}` : ''],
                  ['Carrier', [m.carrier_name, m.carrier_company, m.vehicle_no].filter(Boolean).join(' · ')],
                  ['Notes', m.notes],
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-muted-foreground">
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  {m.returnable && <th className="py-1 text-right font-medium">Back</th>}
                </tr>
              </thead>
              <tbody>
                {m.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-1.5">
                      {it.description}
                      {it.asset_tag && <span className="ml-1.5 font-mono text-[13px] text-muted-foreground">{it.asset_tag}</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      {it.quantity} {it.unit}
                    </td>
                    {m.returnable && <td className="py-1.5 text-right">{it.returned_qty}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2 [&>button]:flex-1">
              {m.can_decide && (
                <>
                  <Button variant="success" onClick={() => void run(() => decide.mutateAsync({ id: m.id, decision: 'approve' }), 'Approved')} loading={decide.isPending}>
                    <Check /> Approve
                  </Button>
                  <Button variant="outline" onClick={() => void reject()}>
                    <X /> Reject
                  </Button>
                </>
              )}
              {config.can.gate && m.status === 'approved' && (
                <Button variant="success" onClick={() => void pass()} loading={gateIt.isPending}>
                  <Truck /> Let it {m.direction === 'out' ? 'out' : 'in'}
                </Button>
              )}
              {config.can.gate && m.status === 'passed' && m.returnable && (
                <Button variant="outline" onClick={() => void run(() => back.mutateAsync({ id: m.id }), 'Marked as back')} loading={back.isPending}>
                  <RotateCcw /> Everything is back
                </Button>
              )}
              {mine && ['pending', 'approved'].includes(m.status) && (
                <Button variant="ghost" onClick={() => void run(() => cancel.mutateAsync(m.id), 'Cancelled')}>
                  Cancel pass
                </Button>
              )}
            </div>
            {config.can.gate && m.status === 'pending' && <p className="text-[13px] font-medium text-warning">Not approved yet: do not let it through.</p>}
            {config.can.gate && ['rejected', 'cancelled'].includes(m.status) && <p className="text-[13px] font-medium text-destructive">This pass is {m.status_display.toLowerCase()}: do not let it through.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
