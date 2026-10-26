/**
 * Shared pieces of the Visitors screens (PLAN.md §22): the gate photo (phone app camera through the bridge, a file input
 * with the camera elsewhere), private photos, status labels, the host picker and the visitor pass.
 */
import { errorMessage } from '@freefounders/core';
import { type PersonBrief, type Visit, type VisitStatus, formatMinutes, useHostSearch } from '@freefounders/core/visitors';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ImageIcon, Printer, RefreshCw, X } from '@/components/icons';
import { QRCode } from '@/components/common/codes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { compressImage, dataUrlToBlob } from '@/lib/compress-image';
import { AppRequestError, appRequest, isInApp, printPage } from '@/lib/native-bridge';
import { cn } from '@/lib/utils';

export const STATUS_TONE: Record<VisitStatus, BadgeTone> = {
  waiting: 'amber',
  waiting_host: 'blue',
  inside: 'green',
  out: 'neutral',
  denied: 'red',
  rejected: 'red',
};

export function StatusBadge({ visit }: { visit: Pick<Visit, 'status' | 'status_display' | 'overstay'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[visit.status]}>{visit.status_display}</Badge>
      {visit.overstay && visit.status === 'inside' && <Badge tone="red">Overstay</Badge>}
    </span>
  );
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
}: {
  host: PersonBrief | null;
  label: string;
  onChange: (v: { host: PersonBrief | null; label: string }) => void;
  error?: string;
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
        value={q || label}
        onChange={(e) => {
          setQ(e.target.value);
          onChange({ host: null, label: e.target.value });
        }}
        placeholder="Type a name, or Reception"
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
        {!q && (
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

/** The visitor pass: pass number + QR (scan it at the gate to check the visitor out). */
export function PassDialog({ visit, onClose }: { visit: Visit | null; onClose: () => void }) {
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
            <DialogFooter>
              <Button variant="outline" onClick={() => void printPage()}>
                <Printer /> Print
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
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
