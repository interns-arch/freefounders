/**
 * Selfie dialog for check-in / check-out: the company keeps a photo of every punch (PLAN.md §16.4). No face matching
 * (founder, 2026-10-12; PLAN.md §19.18). Calls onCapture(photo) with a JPEG data URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ErrorNote } from '../tasks/general/parts';
import { compressImage } from '@/lib/compress-image';
import { cameraSupported, grabPhoto } from './device';

export function SelfieCapture({
  title,
  action,
  hint,
  onCapture,
  onClose,
}: {
  title: string;
  action: string;
  hint?: string;
  onCapture: (photo: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState('Starting camera…');
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cameraSupported()) {
        setErr('This device or browser has no camera access. Use a phone or a laptop with a webcam, over HTTPS.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // The <video> mounts with the dialog; wait a frame if it is not there yet.
        for (let i = 0; i < 20 && !videoRef.current; i++) await new Promise((r) => setTimeout(r, 25));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (cancelled) return;
        setReady(true);
        setStatus('Look at the camera');
      } catch (ex) {
        const name = (ex as { name?: string })?.name ?? '';
        if (name === 'NotAllowedError') setErr('Camera permission was denied. Allow camera access in your browser settings and try again.');
        else if (name === 'NotFoundError') setErr('No camera found on this device.');
        else setErr((ex as Error)?.message || 'Could not start the camera.');
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  const close = () => {
    stop();
    onClose();
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const picture = grabPhoto(video);
    stop();
    // The selfie preset (≤ 720 px JPEG, PLAN.md §19.20); the original still if that is not smaller.
    void compressImage(picture, 'selfie').then(onCapture);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" aria-describedby="selfie-note">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-xl bg-muted sm:aspect-[4/3] sm:max-w-none">
          <video ref={videoRef} playsInline muted autoPlay className="size-full -scale-x-100 object-cover" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[22%] inset-y-[12%] rounded-[50%] border-2 border-dashed border-primary-foreground/80" />
        </div>
        {err ? <ErrorNote>{err}</ErrorNote> : <p className="text-sm text-muted-foreground" role="status">{status}</p>}
        <p id="selfie-note" className="text-xs text-muted-foreground">
          A photo is saved with your attendance. Only you and the people who manage attendance can see it.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button size="lg" disabled={!ready} onClick={capture}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
