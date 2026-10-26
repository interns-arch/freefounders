/**
 * Shared pieces of the Visitors screens (PLAN.md §22): the gate photo (phone app camera through the bridge, a file input
 * with the camera elsewhere), private photos, status labels, the host picker, the visitor pass (V2: link on the visitor's
 * phone, printed badge) and the watchlist mark.
 */
import { errorMessage } from '@freefounders/core';
import { type BadgeFormat, type PersonBrief, type Visit, type VisitStatus, formatMinutes, useHostSearch, useSendPass, useVisitPhoto } from '@freefounders/core/visitors';
import QRCodeLib from 'qrcode';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Copy, ImageIcon, Printer, RefreshCw, Send, ShieldAlert, X } from '@/components/icons';
import { QRCode } from '@/components/common/codes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { compressImage, dataUrlToBlob } from '@/lib/compress-image';
import { AppRequestError, appRequest, isInApp } from '@/lib/native-bridge';
import { cn } from '@/lib/utils';

export const STATUS_TONE: Record<VisitStatus, BadgeTone> = {
  expected: 'blue',
  waiting: 'amber',
  waiting_host: 'blue',
  inside: 'green',
  out: 'neutral',
  denied: 'red',
  rejected: 'red',
  cancelled: 'neutral',
  no_show: 'neutral',
};

export function StatusBadge({ visit }: { visit: Pick<Visit, 'status' | 'status_display' | 'overstay'> & { watch_note?: string } }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[visit.status] ?? 'neutral'}>{visit.status_display}</Badge>
      {visit.overstay && visit.status === 'inside' && <Badge tone="red">Overstay</Badge>}
      {!!visit.watch_note && <Badge tone="red">Watchlist</Badge>}
    </span>
  );
}

/** The watchlist reason on a visit (the gate and the register see it; the visitor never does). */
export function WatchNote({ note, className }: { note: string; className?: string }) {
  if (!note) return null;
  return (
    <p role="note" className={cn('flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-1.5 text-[13px] font-medium text-destructive', className)}>
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {note}
    </p>
  );
}

/** The visitor's own pass page (sent by WhatsApp / email). */
export const passUrl = (v: Pick<Visit, 'pass_path'>) => `${window.location.origin}${v.pass_path}`;

export function copyText(value: string, done = 'Copied') {
  void navigator.clipboard?.writeText(value).then(
    () => toast.success(done),
    () => toast.error('Copy did not work on this device.'),
  );
}

/** Did WhatsApp / email actually take the pass (sent, or held for WhatsApp hours)? */
export const passWasSent = (v: Pick<Visit, 'pass_channels'>) => v.pass_channels.some((c) => c.status === 'sent' || c.status === 'deferred');

/** "Sent by WhatsApp", "Not sent: WhatsApp is not set up"… from what each channel answered. */
export function passSentNote(v: Pick<Visit, 'pass_sent_at' | 'pass_channels'>): string {
  if (!v.pass_sent_at) return 'Pass not sent yet';
  const label = { whatsapp: 'WhatsApp', email: 'email' } as const;
  const sent = v.pass_channels.filter((c) => c.status === 'sent' || c.status === 'deferred').map((c) => label[c.channel] ?? c.channel);
  if (sent.length) return `Pass sent by ${sent.join(' and ')}`;
  return 'Pass link ready (WhatsApp / email not set up: copy the link)';
}

/** "14:05" (today) or "26 Oct, 14:05". */
export function clock(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  const today = new Date();
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}

export const hostName = (v: Pick<Visit, 'host' | 'host_label'>) => v.host?.name || v.host_label || '—';
export { formatMinutes };

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('The photo could not be read.'));
    r.readAsDataURL(blob);
  });
}

/** A picked / taken image as a small JPEG data URL (≤ 720 px; the server re-encodes anyway). */
export async function toPhotoDataUrl(file: Blob): Promise<string> {
  const small = await compressImage(file, 'selfie');
  return readDataUrl(small);
}

/**
 * A photo field for the gate: in the phone app the app's own camera (back camera for a visitor or a vehicle, front for
 * a selfie); in a browser a file input that opens the camera on a phone. Value = JPEG data URL or null.
 */
export function PhotoField({
  value,
  onChange,
  label,
  facing = 'back',
  required,
  existing,
  testId,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  facing?: 'back' | 'front';
  required?: boolean;
  /** A photo already on file (shown when no new one is taken). */
  existing?: { src: string | null; note: string };
  testId?: string;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const inApp = isInApp();
  const takeInApp = async () => {
    setBusy(true);
    try {
      const url = await appRequest<string | null>('photo', { title: label, optional: !required, facing });
      if (url) onChange(await toPhotoDataUrl(dataUrlToBlob(url)));
    } catch (e) {
      if (!(e instanceof AppRequestError && e.code === 'cancelled')) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = value ?? existing?.src ?? null;
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
        {shown ? <img src={shown} alt={label} className="size-full object-cover" /> : <ImageIcon className="size-7 text-muted-foreground" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {inApp ? (
          <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => void takeInApp()} loading={busy}>
            <Camera /> {value ? 'Retake photo' : 'Take photo'}
          </Button>
        ) : (
          <label
            htmlFor={inputId}
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-card px-4 text-[15px] font-medium shadow-xs hover:border-primary/40 hover:bg-accent sm:w-auto"
          >
            <Camera className="size-4" /> {value ? 'Retake photo' : 'Take photo'}
            <input
              id={inputId}
              data-testid={testId}
              type="file"
              accept="image/*"
              capture={facing === 'front' ? 'user' : 'environment'}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void toPhotoDataUrl(f).then(onChange, (err) => toast.error(errorMessage(err)));
              }}
            />
          </label>
        )}
        <p className="text-[13px] text-muted-foreground">
          {value ? 'New photo ready.' : existing?.src ? existing.note : required ? 'A photo is required.' : 'Optional.'}
          {value && (
            <button type="button" className="ml-2 inline-flex cursor-pointer items-center gap-1 text-primary hover:underline" onClick={() => onChange(null)}>
              <X className="size-3.5" /> Remove
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

/** A private photo loaded with the sign-in token (never a public link). */
export function PrivatePhoto({ query, alt, className }: { query: UseQueryResult<Blob, Error>; alt: string; className?: string }) {
  const src = useMemo(() => (query.data ? URL.createObjectURL(query.data) : null), [query.data]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  if (!src) return <div className={cn('grid place-items-center rounded-lg bg-muted', className)}>{query.isLoading ? null : <ImageIcon className="size-6 text-muted-foreground" aria-hidden />}</div>;
  return <img src={src} alt={alt} className={cn('rounded-lg object-cover', className)} />;
}

/** The object URL of a private photo (for the photo field's "on file" preview). */
export function useBlobUrl(blob: Blob | undefined) {
  const src = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  return src;
}

/** Whom the visitor came to meet: a person (search) or a place ("Reception", a department). */
export function HostPicker({
  host,
  label,
  onChange,
  error,
  people,
}: {
  host: PersonBrief | null;
  label: string;
  onChange: (v: { host: PersonBrief | null; label: string }) => void;
  error?: string;
  /** Only a person (no "Reception" or typed place). */
  people?: boolean;
}) {
  const [q, setQ] = useState('');
  const found = useHostSearch(q);
  const listId = useId();
  if (host)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{host.name}</span>
          {host.department && <span className="block text-[13px] text-muted-foreground">{host.department}</span>}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ host: null, label: '' })}>
          Change
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <Input
        value={q || (people ? '' : label)}
        onChange={(e) => {
          setQ(e.target.value);
          onChange({ host: null, label: people ? '' : e.target.value });
        }}
        placeholder={people ? 'Type a name' : 'Type a name, or Reception'}
        aria-label="Whom to meet"
        aria-controls={listId}
        aria-invalid={!!error}
        autoComplete="off"
        className="h-11 text-base sm:text-sm"
      />
      <div id={listId} className="flex flex-wrap gap-1.5">
        {(found.data ?? []).slice(0, 8).map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setQ('');
              onChange({ host: p, label: '' });
            }}
          >
            {p.name}
            {p.department && <span className="text-muted-foreground">· {p.department}</span>}
          </Button>
        ))}
        {!q && !people && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ host: null, label: 'Reception' })}>
            Reception
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The visitor pass: pass number + QR (scan it at the gate to check the visitor out); print a badge, send the link. */
export function PassDialog({ visit, onClose, badgeFormat = 'card' }: { visit: Visit | null; onClose: () => void; badgeFormat?: BadgeFormat }) {
  const photo = useVisitPhoto(visit?.has_photo ? visit.id : null);
  const send = useSendPass();
  const [printing, setPrinting] = useState(false);
  const print = async () => {
    if (!visit) return;
    setPrinting(true);
    try {
      await printBadge(visit, badgeFormat, photo.data ?? null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };
  const resend = async () => {
    if (!visit) return;
    try {
      const v = await send.mutateAsync(visit.id);
      toast.success(passSentNote(v));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open={!!visit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {visit && (
          <>
            <DialogHeader>
              <DialogTitle>Visitor pass {visit.pass_no}</DialogTitle>
              <DialogDescription>
                {visit.status === 'waiting_host' ? `Waiting for ${hostName(visit)} to allow.` : 'Show this at the gate when leaving.'}
              </DialogDescription>
            </DialogHeader>
            <div className="print-sheet flex flex-col items-center gap-3 rounded-lg border bg-white p-4 text-center text-black">
              <QRCode value={`KPV:${visit.pass_token}`} size={180} />
              <p className="font-mono text-2xl font-bold tracking-wider">{visit.pass_no}</p>
              <div className="text-sm">
                <p className="font-semibold">{visit.name}</p>
                {visit.company && <p>{visit.company}</p>}
                <p>To meet: {hostName(visit)}</p>
                <p>
                  In: {clock(visit.check_in_at ?? visit.created_at)}
                  {visit.people > 1 ? ` · ${visit.people} people` : ''}
                </p>
              </div>
            </div>
            {visit.watch_note && <WatchNote note={visit.watch_note} />}
            <p className="text-center text-[13px] text-muted-foreground">{passSentNote(visit)}</p>
            <div className="flex gap-2 [&>button]:flex-1">
              <Button variant="outline" size="sm" onClick={() => void print()} loading={printing}>
                <Printer /> Print badge
              </Button>
              {(visit.mobile || visit.email) && ['inside', 'waiting_host', 'expected'].includes(visit.status) && (
                <Button variant="outline" size="sm" onClick={() => void resend()} loading={send.isPending}>
                  <Send /> {passWasSent(visit) ? 'Send again' : 'Send pass'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => copyText(passUrl(visit), 'Pass link copied')}>
                <Copy /> Copy link
              </Button>
            </div>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A short beep + vibration when someone new waits at the gate (cheap: no sound files). */
export function alertGuard() {
  try {
    navigator.vibrate?.([180, 80, 180]);
  } catch {
    /* not supported */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    /* autoplay blocked until the guard has tapped the page once */
  }
}

export function RefreshNote({ fetching, onRefresh }: { fetching: boolean; onRefresh: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh">
      <RefreshCw className={cn(fetching && 'animate-spin')} /> Refresh
    </Button>
  );
}

// ─── printed visitor badge (V2) ───────────────────────────────────────────────

/** Paper sizes: an A6 card on any printer, or a 62 mm wide label (Brother QL-style label printers). */
const BADGE_PAGE: Record<BadgeFormat, { css: string; w: number; h: number }> = {
  card: { css: '105mm 148mm', w: 1050, h: 1480 },
  label: { css: '62mm 100mm', w: 620, h: 1000 },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The badge could not be drawn.'));
    img.src = src;
  });
}

function fitText(g: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 'bold'): void {
  let s = size;
  do {
    g.font = `${weight} ${s}px sans-serif`;
    s -= 2;
  } while (g.measureText(text).width > maxWidth && s > 12);
}

/** Draws the badge (photo, name, company, host, date, pass number + QR) as a PNG data URL, black on white. */
export async function badgePng(v: Visit, format: BadgeFormat, photo: Blob | null): Promise<string> {
  const { w, h } = BADGE_PAGE[format];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot draw the badge.');
  const pad = Math.round(w * 0.06);
  g.fillStyle = 'white';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'black';
  g.textAlign = 'center';
  g.fillRect(0, 0, w, Math.round(h * 0.09));
  g.fillStyle = 'white';
  fitText(g, 'VISITOR', w - pad * 2, Math.round(h * 0.06));
  g.fillText('VISITOR', w / 2, Math.round(h * 0.068));
  g.fillStyle = 'black';
  let y = Math.round(h * 0.13);
  const photoSize = Math.round(w * (format === 'label' ? 0.42 : 0.36));
  if (photo) {
    const url = URL.createObjectURL(photo);
    try {
      const img = await loadImage(url);
      const side = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, (w - photoSize) / 2, y, photoSize, photoSize);
      g.strokeRect((w - photoSize) / 2, y, photoSize, photoSize);
    } finally {
      URL.revokeObjectURL(url);
    }
    y += photoSize + Math.round(h * 0.05);
  } else {
    y += Math.round(h * 0.03);
  }
  fitText(g, v.name, w - pad * 2, Math.round(h * 0.05));
  g.fillText(v.name, w / 2, y);
  y += Math.round(h * 0.04);
  const lines = [v.company, `To meet: ${hostName(v)}`, `${clock(v.check_in_at ?? v.created_at)}${v.location ? ` · ${v.location.name}` : ''}`].filter(Boolean);
  for (const line of lines) {
    fitText(g, line, w - pad * 2, Math.round(h * 0.03), '500');
    g.fillText(line, w / 2, y);
    y += Math.round(h * 0.038);
  }
  const qrSize = Math.round(Math.min(w * 0.5, h - y - h * 0.12));
  const qr = await loadImage(await QRCodeLib.toDataURL(`KPV:${v.pass_token}`, { margin: 0, width: qrSize, errorCorrectionLevel: 'M' }));
  y += Math.round(h * 0.01);
  g.drawImage(qr, (w - qrSize) / 2, y, qrSize, qrSize);
  y += qrSize + Math.round(h * 0.055);
  fitText(g, v.pass_no, w - pad * 2, Math.round(h * 0.05));
  g.font = `bold ${Math.round(h * 0.045)}px monospace`;
  g.fillText(v.pass_no, w / 2, y);
  g.font = `${Math.round(h * 0.022)}px sans-serif`;
  g.fillText('Return this badge at the gate when you leave', w / 2, h - Math.round(h * 0.03));
  return canvas.toDataURL('image/png');
}

/** Prints the badge on its own page (the phone app prints through the bridge; a browser opens a print window). */
export async function printBadge(v: Visit, format: BadgeFormat, photo: Blob | null): Promise<void> {
  const png = await badgePng(v, format, photo);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Visitor badge ${v.pass_no}</title><style>@page{size:${BADGE_PAGE[format].css};margin:0}html,body{margin:0;padding:0;background:white}img{display:block;width:100%;height:auto}</style></head><body><img alt="Visitor badge" src="${png}"></body></html>`;
  if (isInApp()) {
    try {
      await appRequest('print', { html });
    } catch (e) {
      if (!(e instanceof AppRequestError && e.code === 'cancelled')) throw e;
    }
    return;
  }
  const w = window.open('', '_blank');
  if (!w) throw new Error('Allow pop-ups to print the badge.');
  w.document.open();
  w.document.write(html);
  w.document.close();
  const img = w.document.querySelector('img');
  const go = () => {
    w.focus();
    w.print();
  };
  if (img && !img.complete) img.onload = go;
  else go();
}

