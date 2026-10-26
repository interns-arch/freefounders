/**
 * Visitors → Settings (visitors.settings, PLAN.md §22): the rules, and the company's one visitor QR (founder,
 * 2026-10-26: one fixed QR per company, printed once; "Make a new QR" replaces it and the old one stops working).
 */
import { errorMessage } from '@freefounders/core';
import { type BadgeFormat, type PhotoRule, type VisitorSettings, type WatchAction, useChangeVisitorLink, useSaveVisitorSettings, useVisitorLink, useVisitorSettings } from '@freefounders/core/visitors';
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
      <QrCard />
      <SettingsForm initial={q.data} />
    </div>
  );
}

function SettingsForm({ initial }: { initial: VisitorSettings }) {
  const [f, setF] = useState(initial);
  const [purposes, setPurposes] = useState(initial.purposes.join('\n'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveVisitorSettings();
  useEffect(() => {
    setF(initial);
    setPurposes(initial.purposes.join('\n'));
  }, [initial]);
  const set = <K extends keyof VisitorSettings>(k: K, v: VisitorSettings[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async () => {
    try {
      await save.mutateAsync({ ...f, purposes: purposes.split('\n').map((p) => p.trim()).filter(Boolean) });
      setErrors({});
      toast.success('Visitor settings saved');
    } catch (e) {
      setErrors((e as { errors?: Record<string, string> }).errors ?? {});
      toast.error(errorMessage(e));
    }
  };
  const toggle = (k: 'host_approval' | 'photo_vehicle' | 'open_link' | 'send_pass', label: string, hint: string) => (
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
          {toggle('open_link', 'Visitor QR sign-in', 'Visitors scan the QR at the gate and fill in their details themselves; the guard checks them in.')}
          {toggle('photo_vehicle', 'Vehicle photo required', 'A photo of the vehicle / number plate at vehicle check-in.')}
          {toggle('send_pass', 'Send the visitor pass', 'The pass link (QR) goes to the visitor by WhatsApp, and by email when given: at check-in and with every invite.')}
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
        </div>
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

/** Draws the printable poster (company name, the QR, how to use it) as a PNG data URL. */
async function posterPng(url: string, company: string): Promise<string> {
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
  g.font = 'bold 72px sans-serif';
  g.fillText(company || 'Visitors', canvas.width / 2, 200);
  g.font = '600 56px sans-serif';
  g.fillText('Visitors: scan to sign in', canvas.width / 2, 310);
  g.drawImage(img, (canvas.width - 900) / 2, 400, 900, 900);
  g.font = '40px sans-serif';
  g.fillText('1. Scan with your phone camera   2. Fill in your details', canvas.width / 2, 1420);
  g.fillText('3. Show the code on your screen to the guard', canvas.width / 2, 1480);
  g.font = '28px sans-serif';
  g.fillText(url, canvas.width / 2, 1620);
  return canvas.toDataURL('image/png');
}

function QrCard() {
  const link = useVisitorLink();
  const change = useChangeVisitorLink();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const d = link.data;
  const url = d ? `${window.location.origin}${d.path}` : '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  const download = async () => {
    setBusy(true);
    try {
      await saveFile('visitor-qr-poster.png', dataUrlToBlob(await posterPng(url, d?.company ?? '')));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    // A clean page with only the poster: the browser's print dialog also saves it as a PDF.
    const png = await posterPng(url, d?.company ?? '');
    const w = window.open('', '_blank');
    if (!w) return void toast.error('Allow pop-ups to print the poster, or use Download.');
    w.document.title = 'Visitor QR poster';
    const im = w.document.createElement('img');
    im.src = png;
    im.style.width = '100%';
    im.onload = () => w.print();
    w.document.body.style.margin = '0';
    w.document.body.appendChild(im);
  };
  const regenerate = async () => {
    const r = await confirm({
      title: 'Make a new QR?',
      description: 'The QR printed now stops working at once. Print and put up the new one.',
      confirmText: 'Make a new QR',
      destructive: true,
    });
    if (!r.confirmed) return;
    try {
      await change.mutateAsync({ regenerate: true });
      toast.success('New visitor QR made. Print the new poster.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visitor QR</CardTitle>
        <CardDescription>One QR for your company. Print it once and put it up at the gate; it keeps working until you make a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        {link.error ? (
          <ErrorState error={link.error} onRetry={() => void link.refetch()} />
        ) : !d ? (
          <PageLoader />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            <QRCode value={url} size={168} className="shrink-0 self-center" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="font-mono text-[13px] break-all" data-testid="visitor-qr-url">
                {url}
              </p>
              {!d.enabled && <p className="text-[13px] font-medium text-warning">The QR sign-in is switched off: the link answers “not valid”.</p>}
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
              {d.rotated_at && <p className="text-[13px] text-muted-foreground">Last new QR: {new Date(d.rotated_at).toLocaleString('en-IN')}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
