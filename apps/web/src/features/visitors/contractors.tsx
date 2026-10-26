/**
 * Contractors, vendors and daily workers (PLAN.md §22.10): a pass valid for several days with a work permit, in and
 * out at the gate each day (scan the pass or tap In / Out). The supervisor is told when the crew comes in each day.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { fileSlug } from '@kaampilot/core/export';
import {
  type ContractorInput,
  type ContractorPass,
  type ContractorScope,
  type PersonBrief,
  type VisitorConfig,
  formatMinutes,
  useContractorEntries,
  useContractorIn,
  useContractorOut,
  useContractorPhoto,
  useContractors,
  useCreateContractor,
  useRevokeContractor,
  useSendContractorPass,
  useTaskOptions,
  visitorExportsV3,
} from '@kaampilot/core/visitors';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { CalendarRange, Copy, HardHat, LogIn, LogOut, Plus, Printer, Send, ShieldOff } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { QRCode } from '@/components/common/codes';
import { Segmented } from '@/components/common/controls';
import { DownloadMenu } from '@/components/common/download-menu';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EmptyState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, type BadgeTone, Card, CardContent, Checkbox } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { HostPicker, PhotoField, PrivatePhoto, clock, copyText, passSentNote, printBadgeData } from './parts';

const STATE: Record<ContractorPass['state'], [string, BadgeTone]> = {
  valid: ['Valid', 'green'],
  upcoming: ['Starts later', 'blue'],
  expired: ['Expired', 'neutral'],
  revoked: ['Revoked', 'red'],
};
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const contractorUrl = (c: Pick<ContractorPass, 'pass_path'>) => `${window.location.origin}${c.pass_path}`;

export function ContractorStateBadge({ c }: { c: ContractorPass }) {
  if (c.inside) return <Badge tone="green">Inside</Badge>;
  const [label, tone] = STATE[c.state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ContractorsPage({ config }: { config: VisitorConfig }) {
  const gate = config.can.gate;
  const wide = gate || config.can.view_all;
  const [scope, setScope] = useState<ContractorScope>(wide ? 'today' : 'mine');
  const [q, setQ] = useState('');
  const list = useContractors({ scope, q }, { live: scope === 'today' || scope === 'inside' });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ContractorPass | null>(null);
  const rows = list.data?.results ?? [];
  const scopes: Array<[ContractorScope, string]> = wide
    ? [['today', 'Valid today'], ['inside', 'Inside now'], ['upcoming', 'Starting later'], ['', 'All passes']]
    : [['mine', 'My passes'], ['upcoming', 'Starting later']];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Contractors"
        description="Contractors, vendors and daily workers: one pass for several days, in and out at the gate each day."
        actions={
          <>
            <DownloadMenu filename={fileSlug('visitors-contractors', scope || 'all', todayISO())} target={visitorExportsV3.contractors({ scope, q })} empty={!rows.length} loading={list.isLoading} />
            <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
              <Plus /> New contractor pass
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented options={scopes} value={scope} onChange={setScope} label="Which passes" />
        <SearchField value={q} onChange={setQ} label="Search name, company, pass or work" className="w-full max-w-xs" />
      </div>
      {rows.length === 0 && !list.isLoading ? (
        <EmptyState icon={HardHat} title="No contractor passes" description="Make a pass for a contractor or a crew: valid for the days of the work, scanned at the gate each day." />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((c) => (
            <ContractorCard key={c.id} c={c} gate={gate} onOpen={() => setOpen(c)} />
          ))}
        </div>
      )}
      {adding && <ContractorSheet config={config} onClose={() => setAdding(false)} onDone={(c) => (setAdding(false), setOpen(c))} />}
      <ContractorDialog c={open} config={config} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A contractor's card with In / Out for the gate (also used by the gate's scan). */
export function ContractorCard({ c, gate, onOpen }: { c: ContractorPass; gate: boolean; onOpen?: () => void }) {
  const photo = useContractorPhoto(c.has_photo ? c.id : null);
  return (
    <Card data-testid={`contractor-${c.id}`}>
      <CardContent className="flex gap-3 pt-4">
        <PrivatePhoto query={photo} alt={c.name} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="cursor-pointer truncate text-left font-semibold hover:text-primary" onClick={onOpen} disabled={!onOpen}>
              {c.name}
            </button>
            <ContractorStateBadge c={c} />
            {c.people > 1 && <Badge tone="outline">{c.people} people</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground">{[c.company, c.work, c.supervisor ? `supervisor ${c.supervisor.name}` : null].filter(Boolean).join(' · ')}</p>
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <CalendarRange className="size-3.5" aria-hidden /> {day(c.valid_from)} – {day(c.valid_to)} · <span className="font-mono">{c.pass_no}</span>
            {c.inside && c.since ? ` · in since ${clock(c.since)}` : ''}
          </p>
          {c.safety_note && <p className="text-[13px] font-medium text-warning">Safety: {c.safety_note}</p>}
          {gate && c.state === 'valid' && <InOutButtons c={c} />}
        </div>
      </CardContent>
    </Card>
  );
}

export function InOutButtons({ c, onDone }: { c: ContractorPass; onDone?: () => void }) {
  const goIn = useContractorIn();
  const goOut = useContractorOut();
  const confirm = useConfirm();
  const [photo, setPhoto] = useState<string | null>(null);
  const needPhoto = !c.has_photo;
  const enter = async (watchOk = false): Promise<void> => {
    try {
      await goIn.mutateAsync({ id: c.id, photo, ...(watchOk ? { watch_ok: true } : {}) });
      toast.success(`${c.name} in`);
      onDone?.();
    } catch (e) {
      const errs = e instanceof ApiError ? e.errors : undefined;
      if (errs?.watchlist_warn && !watchOk) {
        if ((await confirm({ title: 'Watchlist', description: errs.watchlist_warn, confirmText: 'Let them in', destructive: true })).confirmed) await enter(true);
        return;
      }
      toast.error(errs?.watchlist ?? errs?.photo ?? errorMessage(e));
    }
  };
  const leave = async () => {
    try {
      await goOut.mutateAsync(c.id);
      toast.success(`${c.name} out`);
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (c.inside)
    return (
      <div className="flex gap-2 pt-1 max-sm:[&>button]:flex-1">
        <Button size="lg" onClick={() => void leave()} loading={goOut.isPending}>
          <LogOut /> Out
        </Button>
      </div>
    );
  return (
    <div className="space-y-2 pt-1">
      {needPhoto && <PhotoField label="Contractor photo" value={photo} onChange={setPhoto} testId={`contractor-photo-${c.id}`} />}
      <div className="flex gap-2 max-sm:[&>button]:flex-1">
        <Button size="lg" variant="success" onClick={() => void enter()} loading={goIn.isPending}>
          <LogIn /> In
        </Button>
      </div>
    </div>
  );
}

function ContractorSheet({ config, onClose, onDone }: { config: VisitorConfig; onClose: () => void; onDone: (c: ContractorPass) => void }) {
  const onBehalf = config.can.gate || config.can.view_all;
  const [f, setF] = useState<ContractorInput & { sup: PersonBrief | null; taskLabel: string }>({
    name: '',
    mobile: '',
    company: '',
    people: 1,
    work: '',
    permit_no: '',
    safety_note: '',
    valid_from: todayISO(),
    valid_to: todayISO(),
    location: null,
    task: null,
    photo: null,
    id_type: '',
    id_last4: '',
    send: true,
    sup: null,
    taskLabel: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [taskQ, setTaskQ] = useState('');
  const tasks = useTaskOptions(taskQ, true);
  const save = useCreateContractor();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.name.trim()) local.name = "Enter the contractor's name.";
    if (f.mobile.replace(/\D/g, '').length < 10) local.mobile = 'Enter the 10-digit mobile number.';
    if (!f.work.trim()) local.work = 'What work are they here for?';
    if (f.valid_to < f.valid_from) local.valid_to = 'The last day is before the first.';
    setErrors(local);
    if (Object.keys(local).length) return;
    const { sup, taskLabel: _t, ...body } = f;
    try {
      const c = await save.mutateAsync({ ...body, supervisor: sup?.id ?? null });
      toast.success(`Pass ${c.pass_no} made for ${c.name}`);
      onDone(c);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="New contractor pass" description={`Valid for up to ${config.contractor_max_days} days. They show the QR at the gate each time.`} onSubmit={submit} submitting={save.isPending} submitLabel="Make pass" errors={errors} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} className="h-11 text-base sm:text-sm" name="name" />
          </Field>
          <Field label="Mobile (WhatsApp)" required error={errors.mobile}>
            <Input type="tel" inputMode="numeric" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} className="h-11 text-base sm:text-sm" name="mobile" />
          </Field>
          <Field label="Company / contractor firm">
            <Input value={f.company} onChange={(e) => set('company', e.target.value)} className="h-11 text-base sm:text-sm" name="company" />
          </Field>
          <Field label="People in the crew" error={errors.people}>
            <Input type="number" min={1} max={200} value={f.people} onChange={(e) => set('people', Number(e.target.value) || 1)} className="h-11" />
          </Field>
        </div>
        <Field label="Work" required error={errors.work} hint="What they are here to do">
          <Input value={f.work} onChange={(e) => set('work', e.target.value)} className="h-11 text-base sm:text-sm" name="work" placeholder="Rewiring the store room" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day" required error={errors.valid_from}>
            <Input type="date" min={todayISO()} value={f.valid_from} onChange={(e) => setF((cur) => ({ ...cur, valid_from: e.target.value, valid_to: cur.valid_to < e.target.value ? e.target.value : cur.valid_to }))} className="h-11" name="valid_from" />
          </Field>
          <Field label="Last day" required error={errors.valid_to}>
            <Input type="date" min={f.valid_from} value={f.valid_to} onChange={(e) => set('valid_to', e.target.value)} className="h-11" name="valid_to" />
          </Field>
          <Field label="Work permit no.">
            <Input value={f.permit_no} onChange={(e) => set('permit_no', e.target.value)} className="h-11 font-mono" name="permit_no" />
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
        <Field label="Safety note" hint="Helmets, gloves, hot work permit, height work…">
          <Input value={f.safety_note} onChange={(e) => set('safety_note', e.target.value)} className="h-11" name="safety_note" />
        </Field>
        {onBehalf && (
          <Field label="Supervisor" hint="Leave empty for yourself" error={errors.supervisor}>
            <HostPicker host={f.sup} label="" onChange={({ host }) => set('sup', host)} people />
          </Field>
        )}
        <Field label="Linked task (work order)" hint="Optional: one of your open tasks" error={errors.task}>
          {f.task ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
              <span className="truncate text-sm">{f.taskLabel}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setF((cur) => ({ ...cur, task: null, taskLabel: '' }))}>
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={taskQ} onChange={(e) => setTaskQ(e.target.value)} placeholder="Search your tasks" className="h-11" aria-label="Search tasks" />
              <div className="flex flex-wrap gap-1.5">
                {(tasks.data ?? []).slice(0, 6).map((t) => (
                  <Button key={t.id} type="button" variant="outline" size="sm" onClick={() => setF((cur) => ({ ...cur, task: t.id, taskLabel: `${t.code} ${t.title}` }))}>
                    <span className="font-mono">{t.code}</span> {t.title.slice(0, 40)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Field>
        <Field label="Photo" hint="Optional now: the guard takes it at the first entry">
          <PhotoField label="Contractor photo" value={f.photo ?? null} onChange={(v) => set('photo', v)} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox checked={f.send !== false} onCheckedChange={(v) => set('send', v === true)} aria-label="Send the pass" className="mt-0.5" />
          <span>
            <span className="block font-medium">Send the pass by WhatsApp</span>
            <span className="block text-[13px] text-muted-foreground">Off: copy the pass link and share it yourself.</span>
          </span>
        </label>
      </div>
    </FormSheet>
  );
}

export function ContractorDialog({ c, config, onClose }: { c: ContractorPass | null; config: VisitorConfig; onClose: () => void }) {
  const entries = useContractorEntries(c?.id);
  const photo = useContractorPhoto(c?.has_photo ? c.id : null);
  const revoke = useRevokeContractor();
  const send = useSendContractorPass();
  const confirm = useConfirm();
  const [printing, setPrinting] = useState(false);
  if (!c) return null;
  const doRevoke = async () => {
    const r = await confirm({ title: `Revoke ${c.name}'s pass?`, description: 'The pass stops working at the gate at once.', confirmText: 'Revoke', destructive: true, note: { label: 'Reason (optional)' } });
    if (!r.confirmed) return;
    try {
      await revoke.mutateAsync({ id: c.id, reason: r.note });
      toast.success('Pass revoked');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const print = async () => {
    setPrinting(true);
    try {
      await printBadgeData(
        {
          heading: 'CONTRACTOR',
          name: c.name,
          lines: [c.company, c.work, `${day(c.valid_from)} – ${day(c.valid_to)}${c.people > 1 ? ` · ${c.people} people` : ''}`, c.permit_no ? `Permit ${c.permit_no}` : ''].filter(Boolean),
          qr: `KPC:${c.pass_token}`,
          passNo: c.pass_no,
          footer: c.safety_note ? `Safety: ${c.safety_note}` : 'Show this pass at the gate, in and out',
        },
        config.badge_format,
        photo.data ?? null,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {c.name} <span className="font-mono text-base text-muted-foreground">{c.pass_no}</span>
          </DialogTitle>
          <DialogDescription>{[c.company, c.work].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <div className="shrink-0 rounded-lg border bg-white p-2">
            <QRCode value={`KPC:${c.pass_token}`} size={120} />
          </div>
          <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-sm">
            {[
              ['Status', <ContractorStateBadge key="s" c={c} />],
              ['Valid', `${day(c.valid_from)} – ${day(c.valid_to)}`],
              ['People', c.people > 1 ? String(c.people) : ''],
              ['Supervisor', c.supervisor?.name],
              ['Permit', c.permit_no],
              ['Safety', c.safety_note],
              ['Task', c.task ? `${c.task.code} ${c.task.title}` : ''],
              ['Mobile', c.mobile],
              ['Pass', passSentNote(c)],
            ]
              .filter(([, x]) => x)
              .map(([k, x]) => (
                <div key={String(k)} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{x}</dd>
                </div>
              ))}
          </dl>
        </div>
        {config.can.gate && c.state === 'valid' && <InOutButtons c={c} onDone={onClose} />}
        <div className="space-y-1 border-t pt-3 text-[13px]">
          <p className="font-semibold">In and out</p>
          {(entries.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">Not been in yet.</p>
          ) : (
            (entries.data ?? []).slice(0, 12).map((e) => (
              <p key={e.id} className="text-muted-foreground">
                {clock(e.in_at)} – {e.out_at ? clock(e.out_at) : 'inside'} · {formatMinutes(e.minutes_inside)}
                {e.people > 1 ? ` · ${e.people} people` : ''}
              </p>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-2 [&>button]:flex-1">
          <Button variant="outline" size="sm" onClick={() => void print()} loading={printing}>
            <Printer /> Print pass
          </Button>
          {c.state !== 'revoked' && c.state !== 'expired' && (
            <Button variant="outline" size="sm" onClick={() => void send.mutateAsync(c.id).then((x) => toast.success(passSentNote(x)), (e) => toast.error(errorMessage(e)))} loading={send.isPending}>
              <Send /> Send pass
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => copyText(contractorUrl(c), 'Pass link copied')}>
            <Copy /> Copy link
          </Button>
          {c.state !== 'revoked' && c.state !== 'expired' && (
            <Button variant="ghost" size="sm" onClick={() => void doRevoke()}>
              <ShieldOff /> Revoke
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
