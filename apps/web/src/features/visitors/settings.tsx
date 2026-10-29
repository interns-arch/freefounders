/**
 * Visitors → Settings (visitors.settings, PLAN.md §22): the rules, and the company's one visitor QR (founder,
 * 2026-10-26: one fixed QR per company, printed once; "Make a new QR" replaces it and the old one stops working).
 */
import { errorMessage } from '@kaampilot/core';
import { type BadgeFormat, type PhotoRule, type VisitorSettings, type WatchAction, useChangeVisitorLink, useSaveVisitorSettings, useVisitorLink, useVisitorSettings } from '@kaampilot/core/visitors';
import QRCodeLib from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Download, Printer, RefreshCw } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { QRCode } from '@/components/common/codes';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from '@/components/ui/primitives';
import { dataUrlToBlob } from '@/lib/compress-image';
import { saveFile } from '@/lib/native-bridge';

const MODES: Array<[PhotoRule, string]> = [
  ['off', 'Off'],
  ['optional', 'Optional'],
  ['required', 'Required'],
];

export function VisitorSettingsPage() {
  const q = useVisitorSettings();
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoader />;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Visitor settings" description="How the gate works for your company." />
      <QrCard kind="in" />
      <QrCard kind="out" />
      <SettingsForm initial={q.data} />
    </div>
  );
}

function SettingsForm({ initial }: { initial: VisitorSettings }) {
  const [f, setF] = useState(initial);
  const [purposes, setPurposes] = useState(initial.purposes.join('\n'));
  const [places, setPlaces] = useState(initial.waiting_places.join('\n'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveVisitorSettings();
  useEffect(() => {
    setF(initial);
    setPurposes(initial.purposes.join('\n'));
    setPlaces(initial.waiting_places.join('\n'));
  }, [initial]);
  const set = <K extends keyof VisitorSettings>(k: K, v: VisitorSettings[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async () => {
    try {
      await save.mutateAsync({
        ...f,
        purposes: purposes.split('\n').map((p) => p.trim()).filter(Boolean),
        waiting_places: places.split('\n').map((p) => p.trim()).filter(Boolean),
      });
      setErrors({});
      toast.success('Visitor settings saved');
    } catch (e) {
      setErrors((e as { errors?: Record<string, string> }).errors ?? {});
      toast.error(errorMessage(e));
    }
  };
  const toggle = (k: 'host_approval' | 'photo_vehicle' | 'open_link' | 'send_pass' | 'id_scan' | 'checkout_qr', label: string, hint: string) => (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={f[k]} onCheckedChange={(v) => set(k, v)} aria-label={label} />
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y">
          {toggle('host_approval', 'Host approves first', 'Off: the guard lets visitors in and the host is told. On: the host taps Allow or Deny and the guard sees the answer.')}
          {toggle('open_link', 'Visitor QR sign-in', 'Visitors scan the check-in QR and fill in their details; they get a 4-digit code and the guard approves it.')}
          {toggle('checkout_qr', 'Check-out QR', 'Visitors scan the check-out QR with the phone they checked in with, give feedback and get a 4-digit code; the guard approves it.')}
          {toggle('photo_vehicle', 'Vehicle photo required', 'A photo of the vehicle / number plate at vehicle check-in.')}
          {toggle('send_pass', 'Send the visitor pass', 'The pass link (QR) goes to the visitor by WhatsApp, and by email when given: at check-in and with every invite.')}
          {toggle('id_scan', 'Read ID cards with AI', "The guard photographs the ID card; the company's AI fills the name, ID type and last 4 digits. The card photo is sent to the AI provider once and never kept. Needs the company's AI set up.")}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Visitor photo (guard)">
            <NativeSelect value={f.photo_visitor} onChange={(e) => set('photo_visitor', e.target.value as PhotoRule)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Selfie on the QR sign-in">
            <NativeSelect value={f.public_photo} onChange={(e) => set('public_photo', e.target.value as PhotoRule)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="ID proof (last 4 digits only)">
            <NativeSelect value={f.id_proof} onChange={(e) => set('id_proof', e.target.value as PhotoRule)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Overstay alert after (hours)" hint="0 = no alert" error={errors.overstay_hours}>
            <Input type="number" min={0} max={72} value={f.overstay_hours} onChange={(e) => set('overstay_hours', Number(e.target.value))} />
          </Field>
          <Field label="Keep records for (days)" hint="Then photos and ID digits are deleted and names removed" error={errors.retention_days}>
            <Input type="number" min={30} max={3650} value={f.retention_days} onChange={(e) => set('retention_days', Number(e.target.value))} />
          </Field>
          <Field label="Watchlist number at the gate" hint="A name match always only warns">
            <NativeSelect value={f.watch_action} onChange={(e) => set('watch_action', e.target.value as WatchAction)}>
              <option value="stop">Stop: the guard cannot let them in</option>
              <option value="warn">Warn: the guard decides</option>
            </NativeSelect>
          </Field>
          <Field label="Printed badge">
            <NativeSelect value={f.badge_format} onChange={(e) => set('badge_format', e.target.value as BadgeFormat)}>
              <option value="card">A6 card (any printer)</option>
              <option value="label">62 mm label printer</option>
            </NativeSelect>
          </Field>
          <Field label="Parcel reminder after (hours)" hint="0 = no reminder" error={errors.delivery_reminder_hours}>
            <Input type="number" min={0} max={168} value={f.delivery_reminder_hours} onChange={(e) => set('delivery_reminder_hours', Number(e.target.value))} />
          </Field>
          <Field label="Patrol: alert if a checkpoint is not checked for (hours)" hint="0 = no alert" error={errors.patrol_every_hours}>
            <Input type="number" min={0} max={24} value={f.patrol_every_hours} onChange={(e) => set('patrol_every_hours', Number(e.target.value))} />
          </Field>
          <Field label="Patrol hours" hint="Same start and end = all day; 20 → 6 = nights" error={errors.patrol_from || errors.patrol_to}>
            <div className="flex items-center gap-2">
              <NativeSelect value={f.patrol_from} onChange={(e) => set('patrol_from', Number(e.target.value))} aria-label="Patrol from">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </NativeSelect>
              <span>to</span>
              <NativeSelect value={f.patrol_to} onChange={(e) => set('patrol_to', Number(e.target.value))} aria-label="Patrol to">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </NativeSelect>
            </div>
          </Field>
          <Field label="Contractor pass: at most (days)" error={errors.contractor_max_days}>
            <Input type="number" min={1} max={366} value={f.contractor_max_days} onChange={(e) => set('contractor_max_days', Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Whom to meet on the QR form" hint="Never shows emails or phone numbers">
            <NativeSelect value={f.public_host_list} onChange={(e) => set('public_host_list', e.target.value as VisitorSettings['public_host_list'])}>
              <option value="people">People: name + department</option>
              <option value="departments">Departments only</option>
              <option value="off">Typed by the visitor</option>
            </NativeSelect>
          </Field>
          <Field label="Codes work for (minutes)" hint="Check-in and check-out codes" error={errors.code_minutes}>
            <Input type="number" min={10} max={720} value={f.code_minutes} onChange={(e) => set('code_minutes', Number(e.target.value))} />
          </Field>
          <Field label="Host no answer after (minutes)" hint="The guard sees “No answer yet” + Call host" error={errors.host_answer_minutes}>
            <Input type="number" min={1} max={60} value={f.host_answer_minutes} onChange={(e) => set('host_answer_minutes', Number(e.target.value))} />
          </Field>
          <Field label="WhatsApp template for hosts" hint="Meta-approved name, e.g. visitor_waiting. Empty: app notice only." error={errors.host_wa_template}>
            <Input value={f.host_wa_template} onChange={(e) => set('host_wa_template', e.target.value.trim())} placeholder="visitor_waiting" className="font-mono" />
          </Field>
          <Field label="Template language" error={errors.host_wa_lang}>
            <Input value={f.host_wa_lang} onChange={(e) => set('host_wa_lang', e.target.value.trim())} placeholder="en" className="font-mono" />
          </Field>
        </div>
        <Field label="Waiting places" hint="One per line. The host picks one (or “I’m coming to the gate” / “Not available”)." error={errors.waiting_places}>
          <Textarea rows={4} value={places} onChange={(e) => setPlaces(e.target.value)} />
        </Field>
        <Field label="Purposes of visit" hint="One per line" error={errors.purposes}>
          <Textarea rows={6} value={purposes} onChange={(e) => setPurposes(e.target.value)} />
        </Field>
        <Field label="Consent text on the QR sign-in" error={errors.consent_text}>
          <Textarea rows={3} value={f.consent_text} onChange={(e) => set('consent_text', e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={() => void submit()} loading={save.isPending}>
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const KIND = {
  in: {
    caption: 'Visitors check-in',
    title: 'Visitor check-in QR',
    describe: 'One QR for your company. Print it once and put it up at the gate: visitors scan it, fill in their details and show the 4-digit code to the guard.',
    steps: ['1. Scan with your phone camera   2. Fill in your details', '3. Show the 4-digit code to the guard'],
    file: 'visitors-check-in',
    renew: 'Make a new check-in QR?',
  },
  out: {
    caption: 'Visitors check-out',
    title: 'Visitor check-out QR',
    describe: 'Put it up at the exit. Visitors scan it with the phone they checked in with, give feedback and show the 4-digit code; the guard approves.',
    steps: ['1. Scan with the phone you checked in with   2. Tap Check out', '3. Show the 4-digit code to the guard'],
    file: 'visitors-check-out',
    renew: 'Make a new check-out QR?',
  },
} as const;

/** Draws the printable poster as a PNG data URL: "Kaampilot · company" small above, the QR, and the caption
 * ("Visitors check-in" / "Visitors check-out") right below the QR, then the steps. Black on white for any printer. */
async function posterPng(url: string, company: string, kind: 'in' | 'out'): Promise<string> {
  const k = KIND[kind];
  const qr = await QRCodeLib.toDataURL(url, { margin: 1, width: 900, errorCorrectionLevel: 'M' });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The QR could not be drawn.'));
    img.src = qr;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754; // A4 at 150 dpi
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot draw the poster.');
  g.fillStyle = 'white';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'black';
  g.textAlign = 'center';
  g.font = '600 40px sans-serif';
  g.fillText(`Kaampilot · ${company || 'Visitors'}`, canvas.width / 2, 170, 1100);
  g.drawImage(img, (canvas.width - 900) / 2, 230, 900, 900);
  // The caption, right below the QR.
  g.font = 'bold 96px sans-serif';
  g.fillText(k.caption, canvas.width / 2, 1250, 1140);
  g.font = '40px sans-serif';
  g.fillText(k.steps[0], canvas.width / 2, 1380, 1140);
  g.fillText(k.steps[1], canvas.width / 2, 1440, 1140);
  g.font = '26px sans-serif';
  g.fillText(url, canvas.width / 2, 1620, 1180);
  return canvas.toDataURL('image/png');
}

function QrCard({ kind }: { kind: 'in' | 'out' }) {
  const k = KIND[kind];
  const link = useVisitorLink();
  const change = useChangeVisitorLink();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const d = link.data;
  const path = d ? (kind === 'in' ? d.path : d.checkout_path) : '';
  const url = d ? `${window.location.origin}${path}` : '';
  const code = path.split('/')[2] ?? '';
  const enabled = d ? (kind === 'in' ? d.enabled : d.checkout_enabled) : true;
  const rotated = d ? (kind === 'in' ? d.rotated_at : d.checkout_rotated_at) : null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  const download = async () => {
    setBusy(true);
    try {
      await saveFile(`${k.file}-${code}.png`, dataUrlToBlob(await posterPng(url, d?.company ?? '', kind)));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    // A clean page with only the poster: the browser's print dialog also saves it as a PDF.
    const png = await posterPng(url, d?.company ?? '', kind);
    const w = window.open('', '_blank');
    if (!w) return void toast.error('Allow pop-ups to print the poster, or use Download.');
    w.document.title = `${k.file}-${code}`;
    const im = w.document.createElement('img');
    im.src = png;
    im.style.width = '100%';
    im.onload = () => w.print();
    w.document.body.style.margin = '0';
    w.document.body.appendChild(im);
  };
  const regenerate = async () => {
    const r = await confirm({
      title: k.renew,
      description: 'The QR printed now stops working at once. Print and put up the new one.',
      confirmText: 'Make a new QR',
      destructive: true,
    });
    if (!r.confirmed) return;
    try {
      await change.mutateAsync(kind === 'in' ? { regenerate: true } : { regenerate_checkout: true });
      toast.success('New QR made. Print the new poster.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{k.title}</CardTitle>
        <CardDescription>{k.describe} It keeps working until you make a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        {link.error ? (
          <ErrorState error={link.error} onRetry={() => void link.refetch()} />
        ) : !d ? (
          <PageLoader />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            <figure className="flex shrink-0 flex-col items-center gap-1 self-center">
              <QRCode value={url} size={168} />
              <figcaption className="text-center">
                <span className="block text-[15px] font-bold" data-testid={`qr-caption-${kind}`}>
                  {k.caption}
                </span>
                {d.company && <span className="block text-[13px] text-muted-foreground">Kaampilot · {d.company}</span>}
              </figcaption>
            </figure>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="font-mono text-[13px] break-all" data-testid={kind === 'in' ? 'visitor-qr-url' : 'visitor-checkout-qr-url'}>
                {url}
              </p>
              {!enabled && <p className="text-[13px] font-medium text-warning">This QR is switched off (Rules below): the link answers “not valid”.</p>}
              {local && <p className="text-[13px] text-muted-foreground">This is a local address: phones cannot open it. Print from the live site.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void download()} loading={busy}>
                  <Download /> Poster (PNG)
                </Button>
                <Button variant="outline" onClick={() => void print()}>
                  <Printer /> Print / PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => toast.error('Copy it from the text above'))}
                >
                  <Copy /> Copy link
                </Button>
                {d.can_change && (
                  <Button variant="outline" onClick={() => void regenerate()} loading={change.isPending}>
                    <RefreshCw /> Make a new QR
                  </Button>
                )}
              </div>
              {rotated && <p className="text-[13px] text-muted-foreground">Last new QR: {new Date(rotated).toLocaleString('en-IN')}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
