/**
 * The gate (PLAN.md §22, visitors.gate): QR sign-ins waiting at the gate, invited visitors expected today (V2: scan their
 * pass, take the photo, in), visitors waiting for their host, who is inside (check out with one tap or by scanning the
 * pass), who left today, and the check-in form (with the watchlist check).
 */
import { ApiError, errorMessage } from '@freefounders/core';
import {
  type CheckInInput,
  type PersonBrief,
  type Visit,
  type VisitorConfig,
  type ContractorPass,
  type MaterialPass,
  useAcceptVisit,
  useCheckInVisitor,
  useCheckOutVisit,
  useReadIdCard,
  useScanPass,
  useRejectVisit,
  useVisitorLookup,
  useVisitorPhoto,
  useVisitPhoto,
  useVisits,
} from '@freefounders/core/visitors';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { CalendarClock, IdCard, LogOut, Package, Plus, QrCode, ShieldAlert, UserCheck, UserRoundX } from '@/components/icons';
import { ContractorCard } from './contractors';
import { MaterialDialog } from './material';
import { useConfirm } from '@/components/common/confirm';
import { FormSheet } from '@/components/common/form-sheet';
import { Field } from '@/components/common/form';
import { EmptyState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { CameraScanner } from '@/features/assets/inventory/scan-page';
import { cn } from '@/lib/utils';
import { HostPicker, PassDialog, PhotoField, PrivatePhoto, StatusBadge, WatchNote, alertGuard, clock, formatMinutes, hostName, useBlobUrl } from './parts';

const GATE_KEY = 'ff-visitors-gate';
function lastGate(): number | null {
  try {
    const v = Number(localStorage.getItem(GATE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function rememberGate(id: number | null) {
  try {
    if (id) localStorage.setItem(GATE_KEY, String(id));
  } catch {
    /* private mode */
  }
}

export function GatePage({ config }: { config: VisitorConfig }) {
  const list = useVisits({ scope: 'today' }, { live: true, pageSize: 200 });
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ accept?: Visit } | null>(null);
  const [pass, setPass] = useState<Visit | null>(null);
  const [scan, setScan] = useState(false);
  const [scanned, setScanned] = useState<{ contractor?: ContractorPass; material?: MaterialPass } | null>(null);
  const checkOut = useCheckOutVisit();
  const reject = useRejectVisit();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const rows = list.data?.results ?? [];
  const term = q.trim().toLowerCase();
  const match = (v: Visit) =>
    !term || [v.name, v.mobile, v.company, v.pass_no, v.short_code, v.vehicle_no, hostName(v)].some((x) => x?.toLowerCase().includes(term));
  const waiting = rows.filter((v) => v.status === 'waiting' && match(v));
  const expected = rows.filter((v) => v.status === 'expected' && match(v));
  const waitingHost = rows.filter((v) => v.status === 'waiting_host' && match(v));
  const inside = rows.filter((v) => v.status === 'inside' && match(v));
  const done = rows.filter((v) => ['out', 'denied', 'rejected'].includes(v.status) && match(v));

  // Someone new signed in from the QR: a beep and a vibration (the list refreshes every few seconds).
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    const ids = new Set(rows.filter((v) => v.status === 'waiting').map((v) => v.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) {
      alertGuard();
      toast.info('A visitor is waiting at the gate');
    }
    if (list.data) seen.current = ids;
  }, [rows, list.data]);

  const out = async (v: Visit) => {
    try {
      await checkOut.mutateAsync(v.id);
      toast.success(`${v.name} checked out · ${formatMinutes(v.minutes_inside)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const turnAway = async (v: Visit) => {
    const r = await confirm({ title: `Turn ${v.name} away?`, description: 'They are not let in. This is recorded.', confirmText: 'Turn away', destructive: true, note: { label: 'Reason (optional)' } });
    if (!r.confirmed) return;
    try {
      await reject.mutateAsync({ id: v.id, reason: r.note });
      toast.success(`${v.name} turned away`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gate"
        description={`${inside.length} inside · ${waiting.length + waitingHost.length} waiting · ${expected.length} expected · ${done.length} left today`}
        actions={
          <>
            <Button variant="outline" size="lg" onClick={() => navigate('/visitors/deliveries?new=1')}>
              <Package /> Parcel
            </Button>
            <Button variant="outline" size="lg" onClick={() => setScan(true)}>
              <QrCode /> Scan pass
            </Button>
            <Button variant="cta" size="lg" onClick={() => setForm({})}>
              <Plus /> Check in visitor
            </Button>
          </>
        }
      />
      <SearchField value={q} onChange={setQ} label="Search name, mobile, pass or vehicle" className="max-w-md" />

      {waiting.length > 0 && (
        <Section title="Waiting at the gate" note="Signed in from the visitor QR. Check their details, then let them in.">
          {waiting.map((v) => (
            <VisitCard key={v.id} visit={v}>
              <Button size="lg" variant="success" onClick={() => setForm({ accept: v })}>
                <UserCheck /> Check in
              </Button>
              <Button size="lg" variant="outline" onClick={() => void turnAway(v)}>
                <UserRoundX /> Turn away
              </Button>
            </VisitCard>
          ))}
        </Section>
      )}

      {expected.length > 0 && (
        <Section title={`Expected today (${expected.length})`} note="Invited in advance. Scan their pass (or tap Check in), take the photo, and they are in.">
          {expected.map((v) => (
            <VisitCard key={v.id} visit={v}>
              <Button size="lg" variant="success" onClick={() => setForm({ accept: v })}>
                <UserCheck /> Check in
              </Button>
              <Button size="lg" variant="outline" onClick={() => void turnAway(v)}>
                <UserRoundX /> Turn away
              </Button>
            </VisitCard>
          ))}
        </Section>
      )}

      {waitingHost.length > 0 && (
        <Section title="Waiting for the host" note="The host was asked to allow. The answer shows here on its own.">
          {waitingHost.map((v) => (
            <VisitCard key={v.id} visit={v}>
              <Button size="lg" variant="outline" onClick={() => void turnAway(v)}>
                <UserRoundX /> Turn away
              </Button>
            </VisitCard>
          ))}
        </Section>
      )}

      <Section title={`Inside (${inside.length})`}>
        {inside.length === 0 ? (
          <EmptyState title="Nobody is inside" description="Visitors you check in show here until they leave." />
        ) : (
          inside.map((v) => (
            <VisitCard key={v.id} visit={v} onOpen={() => setPass(v)}>
              <Button size="lg" onClick={() => void out(v)} loading={checkOut.isPending && checkOut.variables === v.id}>
                <LogOut /> Check out
              </Button>
            </VisitCard>
          ))
        )}
      </Section>

      {done.length > 0 && (
        <Section title={`Left today (${done.length})`}>
          {done.map((v) => (
            <VisitCard key={v.id} visit={v} compact />
          ))}
        </Section>
      )}

      {form && (
        <CheckInSheet
          config={config}
          accept={form.accept}
          onClose={() => setForm(null)}
          onDone={(v) => {
            setForm(null);
            setPass(v);
          }}
        />
      )}
      <PassDialog visit={pass} onClose={() => setPass(null)} badgeFormat={config.badge_format} />
      <ScanPassDialog
        open={scan}
        onClose={() => setScan(false)}
        onCheckIn={(v) => {
          setScan(false);
          setForm({ accept: v });
        }}
        onOther={(x) => {
          setScan(false);
          setScanned(x);
        }}
      />
      {scanned?.material && <MaterialDialog id={scanned.material.id} config={config} onClose={() => setScanned(null)} />}
      {scanned?.contractor && (
        <Dialog open onOpenChange={(o) => !o && setScanned(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Contractor pass {scanned.contractor.pass_no}</DialogTitle>
              <DialogDescription>{scanned.contractor.inside ? 'Inside now: tap Out when they leave.' : 'Tap In to let them in.'}</DialogDescription>
            </DialogHeader>
            <ContractorCard c={scanned.contractor} gate />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function VisitCard({ visit: v, children, onOpen, compact }: { visit: Visit; children?: React.ReactNode; onOpen?: () => void; compact?: boolean }) {
  const photo = useVisitPhoto(v.has_photo && !compact ? v.id : null);
  return (
    <Card data-testid={`visit-${v.id}`}>
      <CardContent className={cn('flex gap-3 pt-4', compact && 'py-3')}>
        {!compact && <PrivatePhoto query={photo} alt={v.name} className="size-16 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="cursor-pointer truncate text-left font-semibold hover:text-primary" onClick={onOpen} disabled={!onOpen}>
              {v.name}
            </button>
            <StatusBadge visit={v} />
            {v.returning && <Badge tone="outline">Returning</Badge>}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {[v.company, v.purpose, `to meet ${hostName(v)}`, v.people > 1 ? `${v.people} people` : null, v.vehicle_no || null].filter(Boolean).join(' · ')}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {v.status === 'expected' ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden /> {v.window} · <span className="font-mono">{v.pass_no}</span>
                {v.invited_by ? ` · invited by ${v.invited_by}` : ''}
              </span>
            ) : v.status === 'waiting' ? (
              <>
                Code <span className="font-mono font-semibold text-foreground">{v.short_code}</span> · {v.mobile} · {clock(v.created_at)}
              </>
            ) : (
              <>
                <span className="font-mono">{v.pass_no}</span> · in {clock(v.check_in_at ?? v.created_at)}
                {v.check_out_at ? ` · out ${clock(v.check_out_at)}` : ''} · {formatMinutes(v.minutes_inside)}
              </>
            )}
          </p>
          {!compact && <WatchNote note={v.watch_note} />}
          {children && <div className="flex flex-wrap gap-2 pt-1 max-sm:[&>button]:flex-1">{children}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

const blank = (accept?: Visit): CheckInInput & { hostBrief: PersonBrief | null } => ({
  mobile: accept?.mobile ?? '',
  name: accept?.name ?? '',
  company: accept?.company ?? '',
  purpose: accept?.purpose ?? '',
  host: accept?.host?.id ?? null,
  hostBrief: accept?.host ?? null,
  host_label: accept?.host_label ?? '',
  people: accept?.people ?? 1,
  location: accept?.location?.id ?? lastGate(),
  photo: null,
  reuse_photo: false,
  id_type: '',
  id_last4: '',
  vehicle_no: accept?.vehicle_no ?? '',
  items: '',
  notes: '',
});

/** Check-in (a walk-in) or accepting a QR sign-in: a returning visitor is filled in from their mobile number. */
export function CheckInSheet({ config, accept, onClose, onDone }: { config: VisitorConfig; accept?: Visit; onClose: () => void; onDone: (v: Visit) => void }) {
  const [f, setF] = useState(() => blank(accept));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const checkIn = useCheckInVisitor();
  const acceptVisit = useAcceptVisit();
  const lookup = useVisitorLookup(accept ? '' : f.mobile);
  const found = lookup.data?.found ? lookup.data : null;
  const watch = lookup.data?.watch ?? null;
  const [blocked, setBlocked] = useState('');
  const confirm = useConfirm();
  const readId = useReadIdCard();
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!idPhoto) return;
    readId.mutate(idPhoto, {
      onSuccess: (r) => {
        setIdPhoto(null);
        if (!r.found) return void toast.info('The card could not be read: type the details.');
        setF((cur) => ({ ...cur, name: cur.name || r.name, id_type: r.id_type || cur.id_type, id_last4: r.id_last4 || cur.id_last4 }));
        toast.success('ID card read: check the details');
      },
      onError: (e) => {
        setIdPhoto(null);
        toast.error(errorMessage(e));
      },
    });
  }, [idPhoto]);
  const onFile = useVisitorPhoto(found?.has_photo ? found.id : null);
  const onFileSrc = useBlobUrl(onFile.data);
  const visitPhoto = useVisitPhoto(accept?.has_photo ? accept.id : null);
  const visitPhotoSrc = useBlobUrl(visitPhoto.data);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));

  // Returning visitor: fill in what we know (only fields still empty), and keep their photo unless a new one is taken.
  const filled = useRef<number | null>(null);
  useEffect(() => {
    if (!found || filled.current === found.id) return;
    filled.current = found.id ?? null;
    setF((cur) => ({
      ...cur,
      name: cur.name || found.name || '',
      company: cur.company || found.company || '',
      purpose: cur.purpose || found.last_purpose || '',
      host: cur.host ?? found.last_host?.id ?? null,
      hostBrief: cur.hostBrief ?? found.last_host ?? null,
      host_label: cur.host_label || (found.last_host ? '' : found.last_host_label || ''),
      id_type: cur.id_type || found.id_type || '',
      id_last4: cur.id_last4 || found.id_last4 || '',
      reuse_photo: !!found.has_photo,
    }));
  }, [found]);

  const purposes = useMemo(() => (f.purpose && !config.purposes.includes(f.purpose) ? [...config.purposes, f.purpose] : config.purposes), [config.purposes, f.purpose]);
  const photoRequired = config.photo_visitor === 'required';
  const hasPhoto = !!f.photo || (f.reuse_photo && !!found?.has_photo) || !!accept?.has_photo;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!accept && f.mobile.replace(/\D/g, '').length < 10) local.mobile = 'Enter the 10-digit mobile number.';
    if (!f.name.trim()) local.name = "Enter the visitor's name.";
    if (!f.host && !f.host_label?.trim()) local.host = 'Pick whom they came to meet (or Reception).';
    if (photoRequired && !hasPhoto) local.photo = "Take the visitor's photo.";
    setErrors(local);
    if (Object.keys(local).length) return;
    const { hostBrief: _h, ...body } = f;
    rememberGate(f.location ?? null);
    setBlocked('');
    const send = async (watchOk: boolean): Promise<void> => {
      try {
        const input = { ...body, ...(watchOk ? { watch_ok: true } : {}) };
        const v = accept ? await acceptVisit.mutateAsync({ id: accept.id, ...input }) : await checkIn.mutateAsync(input);
        toast.success(v.status === 'waiting_host' ? `${v.name}: waiting for ${hostName(v)} to allow` : `${v.name} checked in · pass ${v.pass_no}`);
        onDone(v);
      } catch (err) {
        const errs = err instanceof ApiError ? err.errors : undefined;
        // The watchlist: a hard stop is shown in the form; a warning asks the guard to confirm, then sends again.
        if (errs?.watchlist) {
          setBlocked(errs.watchlist);
          return;
        }
        if (errs?.watchlist_warn && !watchOk) {
          const r = await confirm({ title: 'Watchlist', description: errs.watchlist_warn, confirmText: 'Let them in', destructive: true });
          if (r.confirmed) await send(true);
          return;
        }
        if (errs) setErrors(errs);
        toast.error(errorMessage(err));
      }
    };
    await send(false);
  };

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={accept ? `Check in ${accept.name}` : 'Check in visitor'}
      description={
        accept?.status === 'expected'
          ? `Invited${accept.invited_by ? ` by ${accept.invited_by}` : ''} · ${accept.window} · pass ${accept.pass_no}. Check the details and take the photo.`
          : accept
            ? `QR sign-in, code ${accept.short_code}. Check the details and their photo.`
            : undefined
      }
      onSubmit={submit}
      submitting={checkIn.isPending || acceptVisit.isPending}
      submitLabel="Check in"
      errors={errors}
    >
      <div className="space-y-4">
        {blocked && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive" data-testid="watch-blocked">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {blocked}
          </p>
        )}
        {accept?.watch_note && <WatchNote note={accept.watch_note} />}
        <Field label="Mobile number" required error={errors.mobile}>
          <Input
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            value={f.mobile}
            onChange={(e) => set('mobile', e.target.value)}
            disabled={!!accept}
            className="h-11 text-base sm:text-sm"
            name="mobile"
          />
        </Field>
        {watch && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] font-semibold text-destructive" data-testid="watch-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {watch.stop && !config.can.settings
              ? `On the watchlist: ${watch.reason}. Do not let them in; call your security head.`
              : `On the watchlist: ${watch.reason}. Check with your security head before letting them in.`}
          </p>
        )}
        {found && (
          <p role="status" className="rounded-md border border-success/30 bg-success/8 px-3 py-2 text-[13px] text-success">
            Returning visitor · {found.visits} visit{found.visits === 1 ? '' : 's'} · details filled in
          </p>
        )}
        <Field label="Name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} className="h-11 text-base sm:text-sm" name="name" />
        </Field>
        <Field label="Company / coming from">
          <Input value={f.company} onChange={(e) => set('company', e.target.value)} className="h-11 text-base sm:text-sm" name="company" />
        </Field>
        <Field label="Purpose">
          <NativeSelect value={f.purpose} onChange={(e) => set('purpose', e.target.value)} name="purpose" className="h-11">
            <option value="">Choose…</option>
            {purposes.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Whom to meet" required error={errors.host}>
          <HostPicker
            host={f.hostBrief}
            label={f.host_label ?? ''}
            onChange={({ host, label }) => setF((cur) => ({ ...cur, host: host?.id ?? null, hostBrief: host, host_label: label }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="People">
            <Input type="number" min={1} max={50} value={f.people} onChange={(e) => set('people', Number(e.target.value) || 1)} className="h-11" />
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
        {config.photo_visitor !== 'off' && (
          <Field label="Visitor photo" required={photoRequired} error={errors.photo}>
            <PhotoField
              label="Visitor photo"
              value={f.photo ?? null}
              onChange={(v) => setF((cur) => ({ ...cur, photo: v, reuse_photo: v ? false : cur.reuse_photo }))}
              required={photoRequired}
              testId="visitor-photo"
              existing={
                accept?.has_photo
                  ? { src: visitPhotoSrc, note: 'Selfie from the QR sign-in. Retake if it does not match.' }
                  : f.reuse_photo && found?.has_photo
                    ? { src: onFileSrc, note: 'Photo from the last visit. Retake if it does not match.' }
                    : undefined
              }
            />
          </Field>
        )}
        {config.id_scan && config.id_proof !== 'off' && (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
              <IdCard className="size-4" aria-hidden /> Read the ID card {readId.isPending && '· reading…'}
            </p>
            <PhotoField label="ID card" value={null} onChange={(v) => v && setIdPhoto(v)} testId="id-card-photo" />
            <p className="mt-1 text-[13px] text-muted-foreground">Fills the name, ID type and last 4 digits. The card photo is not kept.</p>
          </div>
        )}
        {config.id_proof !== 'off' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID type" required={config.id_proof === 'required'}>
              <NativeSelect value={f.id_type} onChange={(e) => set('id_type', e.target.value)} className="h-11">
                <option value="">—</option>
                {config.id_types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Last 4 digits" error={errors.id_last4} hint="Never the full number">
              <Input value={f.id_last4} maxLength={4} onChange={(e) => set('id_last4', e.target.value.replace(/\s/g, '').slice(0, 4))} className="h-11 font-mono" />
            </Field>
          </div>
        )}
        <Field label="Vehicle number" hint="Optional. Log the vehicle itself on the Vehicles tab." error={errors.vehicle_no}>
          <Input value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} className="h-11 font-mono" autoCapitalize="characters" />
        </Field>
        {more ? (
          <>
            <Field label="Items carried">
              <Input value={f.items} onChange={(e) => set('items', e.target.value)} className="h-11" placeholder="Laptop, samples…" />
            </Field>
            <Field label="Notes">
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
            </Field>
          </>
        ) : (
          <Button type="button" variant="link" className="px-0" onClick={() => setMore(true)}>
            + Items carried, notes
          </Button>
        )}
      </div>
    </FormSheet>
  );
}

/**
 * Scan a pass (camera) or type the pass number / sign-in code. Inside → checked out at once. Expected (invited) or
 * waiting at the gate → the check-in form opens. Anything else → what happened to that pass.
 */
function ScanPassDialog({
  open,
  onClose,
  onCheckIn,
  onOther,
}: {
  open: boolean;
  onClose: () => void;
  onCheckIn: (v: Visit) => void;
  onOther: (x: { contractor?: ContractorPass; material?: MaterialPass }) => void;
}) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const find = useScanPass();
  const out = useCheckOutVisit();
  const busy = find.isPending || out.isPending;
  const go = async (value: string) => {
    if (!value.trim() || busy) return;
    setNote('');
    try {
      const hit = await find.mutateAsync(value.trim());
      if (hit.kind !== 'visit') {
        setCode('');
        return onOther(hit.kind === 'contractor' ? { contractor: hit.data } : { material: hit.data });
      }
      const v = hit.data;
      if (v.status === 'inside') {
        const done = await out.mutateAsync(v.id);
        toast.success(`${done.name} checked out · ${formatMinutes(done.minutes_inside)}`);
        setCode('');
        onClose();
      } else if (v.status === 'expected' || v.status === 'waiting') {
        setCode('');
        onCheckIn(v);
      } else {
        setNote(`${v.name} · ${v.pass_no || v.short_code}: ${v.status_display}${v.window ? ` (${v.window})` : ''}.`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNote('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan pass</DialogTitle>
          <DialogDescription>Scan any pass (visitor, contractor, material) or type its number. A visitor coming in: the check-in opens; leaving: checked out.</DialogDescription>
        </DialogHeader>
        {open && <CameraScanner onCode={(c) => void go(c)} />}
        {note && (
          <p role="status" className="rounded-md border bg-muted px-3 py-2 text-sm">
            {note}
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void go(code);
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="V00012" className="h-11 font-mono" aria-label="Pass number" autoCapitalize="characters" />
          <Button type="submit" size="lg" loading={busy}>
            Go
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
