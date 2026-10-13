import { errorMessage } from '@freefounders/core';
import { type VoiceDraft, useVoiceTaskDraft } from '@freefounders/core/tasks';
import { Mic, Square } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const MAX_SECONDS = 120; // a task, not a meeting

/** Whatever this browser records: Chrome/Android give webm, Safari/iOS mp4. */
function pickMime(): string | null {
  const R = typeof window !== 'undefined' ? window.MediaRecorder : undefined;
  if (!R) return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (R.isTypeSupported?.(m)) return m;
  return '';
}

/**
 * Speak a task instead of typing it. Records, sends the clip, and hands back what the server worked out. It creates
 * nothing: the caller fills the form and a person still presses Create.
 */
export function VoiceNote({ onDraft, disabled }: { onDraft: (d: VoiceDraft) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const draft = useVoiceTaskDraft();

  // never leave the microphone light on
  useEffect(
    () => () => {
      try {
        rec.current?.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* gone */
      }
      clearInterval(timer.current);
    },
    [],
  );

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  if (!supported) return null;

  async function start() {
    setErr('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr('No microphone access. Allow it in the browser, or type the task.');
      return;
    }
    const mime = pickMime();
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer.current);
      const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
      if (blob.size < 1200) {
        setState('idle');
        setSecs(0);
        setErr('That was too short — hold on and say the whole task.');
        return;
      }
      setState('working');
      draft.mutate(blob, {
        onSuccess: onDraft,
        onError: (e) => setErr(errorMessage(e)),
        onSettled: () => {
          setState('idle');
          setSecs(0);
        },
      });
    };
    rec.current = r;
    r.start();
    setState('recording');
    setSecs(0);
    timer.current = setInterval(
      () =>
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS) {
            try {
              r.stop();
            } catch {
              /* already stopped */
            }
          }
          return s + 1;
        }),
      1000,
    );
  }

  function stop() {
    setState('working');
    try {
      rec.current?.stop();
    } catch {
      setState('idle');
    }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span className="inline-flex flex-col gap-1">
      {state === 'recording' ? (
        <Button type="button" variant="destructive" size="sm" onClick={stop}>
          <Square /> Stop · {mmss}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={start} disabled={disabled} loading={state === 'working'} title="Say the task out loud — who it is for and when it is due">
          {state !== 'working' && <Mic />}
          {state === 'working' ? 'Listening…' : 'Speak the task'}
        </Button>
      )}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
