import { Camera, CameraOff, IdCard, Loader2, ScanLine, Search, Smartphone, Tag } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { resolveCode } from '@/lib/scan';
import { cn } from '@/lib/utils';

/** Camera-based QR / barcode reader. Returns a stop function. */
export async function startCameraScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
    if (result) onCode(result.getText());
  });
  return () => controls.stop();
}

export function CameraScanner({ onCode, className }: { onCode: (code: string) => void; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'on' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  const start = async () => {
    if (!video.current) return;
    setState('starting');
    try {
      stop.current = await startCameraScanner(video.current, (code) => {
        // Ignore repeats of the same code within 2.5s.
        if (last.current && last.current.code === code && Date.now() - last.current.at < 2500) return;
        last.current = { code, at: Date.now() };
        cb.current(code);
      });
      setState('on');
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera available on this device.');
      setState('error');
    }
  };
  const halt = () => {
    stop.current?.();
    stop.current = null;
    setState('idle');
  };
  useEffect(() => () => stop.current?.(), []);

  // Browsers only allow the camera on HTTPS (or localhost). Over plain http on Wi-Fi, the phone's
  // own camera app still works because every QR is a link.
  if (!window.isSecureContext) {
    return (
      <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center', className)}>
        <Smartphone className="size-8 text-primary" />
        <p className="text-sm font-medium">Scan with your phone’s camera</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Point the normal camera app at an ID card or asset label and tap the link — it opens here. (The in-page camera needs HTTPS.)
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative aspect-square overflow-hidden rounded-xl border bg-black sm:aspect-video">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {state !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-300">
            {state === 'starting' ? <Loader2 className="size-7 animate-spin" /> : <Camera className="size-8 opacity-70" />}
            {error && <p className="text-sm text-red-300">{error}</p>}
            <Button size="lg" variant="secondary" onClick={start} disabled={state === 'starting'}>
              {state === 'error' ? 'Try again' : 'Start camera'}
            </Button>
          </div>
        )}
        {state === 'on' && <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />}
      </div>
      {state === 'on' && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={halt}>
          <CameraOff /> Stop camera
        </Button>
      )}
    </div>
  );
}

export default function ScanPage() {
  const { code: routeCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      // Person ID cards encode /id/<token>; keep that hint when the page was opened from one.
      const r = await resolveCode(location.pathname.startsWith('/id/') && raw === routeCode ? `/id/${value}` : value);
      toast.success(r.kind === 'person' ? `Person: ${r.label}` : r.label);
      navigate(r.to, { replace: !!routeCode });
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Opened straight from a QR code URL: /scan/<token> (asset) or /id/<token> (person).
  useEffect(() => {
    if (routeCode) void lookup(routeCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCode]);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Scan" description="Scan a person’s ID card to see everything they hold, or an asset label to open the asset." />
      <Card>
        <CardContent className="space-y-5 pt-5">
          <CameraScanner onCode={(c) => void lookup(c)} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or type it <span className="h-px flex-1 bg-border" />
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup(code);
            }}
          >
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Employee ID, asset tag or serial"
                className="h-12 pl-9 font-mono text-base sm:h-11 sm:text-sm"
                autoCapitalize="characters"
                autoCorrect="off"
                enterKeyHint="search"
              />
            </div>
            <Button type="submit" className="h-12 sm:h-11" loading={busy}>
              <Search /> Find
            </Button>
          </form>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 rounded-lg border p-2.5">
              <IdCard className="size-4 shrink-0 text-primary" /> Person ID card → their assets
            </div>
            <div className="flex items-center gap-2 rounded-lg border p-2.5">
              <Tag className="size-4 shrink-0 text-primary" /> Asset label → the asset
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
