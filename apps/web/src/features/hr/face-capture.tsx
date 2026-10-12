/**
 * Camera dialog for check-in/out and face enrolment (old FaceCapture.jsx).
 *   face:  read the face and pass its 128-number signature (never an image)
 *   photo: also take a picture (the company keeps a photo of every punch, PLAN.md §16.4)
 * Calls onCapture(descriptor | null, photo | null).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { isInApp } from '@/lib/native-bridge';
import { ErrorNote } from '../tasks/general/parts';
import { cameraSupported, describeFace, grabPhoto, loadFace } from './face';

export function FaceCapture({
  title = 'Face verification',
  action = 'Capture',
  hint,
  onCapture,
  onClose,
  face = true,
  photo = false,
}: {
  title?: string;
  action?: string;
  hint?: string;
  onCapture: (descriptor: number[] | null, photo: string | null) => void;
  onClose: () => void;
  face?: boolean;
  photo?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState('Starting camera…');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (face && isInApp()) {
        // No face matching in the phone app (founder, 2026-10-12; PLAN.md §19.17).
        setErr('Face check does not run in the FreeFounders phone app. Open FreeFounders in a browser to enrol or check a face.');
        return;
      }
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
        if (face) {
          setStatus('Loading face models…');
          await loadFace(setStatus);
        }
        if (cancelled) return;
        setReady(true);
        setStatus('Look straight at the camera');
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
  }, [stop, face]);

  const close = () => {
    stop();
    onClose();
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;
    setErr('');
    setBusy(true);
    setStatus(face ? 'Reading your face…' : 'Taking the photo…');
    try {
      const picture = photo ? grabPhoto(video) : null;
      const descriptor = face ? await describeFace(video) : null;
      stop();
      onCapture(descriptor, picture);
    } catch (ex) {
      setErr((ex as Error).message);
      setStatus('Try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" aria-describedby="face-note">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-xl bg-muted sm:aspect-[4/3] sm:max-w-none">
          <video ref={videoRef} playsInline muted autoPlay className="size-full -scale-x-100 object-cover" />
          <div aria-hidden className="pointer-events-none absolute inset-x-[22%] inset-y-[12%] rounded-[50%] border-2 border-dashed border-primary-foreground/80" />
        </div>
        {err ? <ErrorNote>{err}</ErrorNote> : <p className="text-sm text-muted-foreground" role="status">{status}</p>}
        <p id="face-note" className="text-xs text-muted-foreground">
          {photo
            ? 'A photo is saved with your attendance. Only you and the people who manage attendance can see it.'
            : 'Only a numeric face signature is sent — your photo never leaves this device.'}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button size="lg" disabled={!ready || busy} loading={busy} onClick={capture}>
            {busy ? 'Checking…' : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
