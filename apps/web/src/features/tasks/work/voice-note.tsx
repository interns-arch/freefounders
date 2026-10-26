import { errorMessage, isOlderVersion, useAppVersionInfo } from '@kaampilot/core';
import { type VoiceDraft, useVoiceTaskDraft } from '@kaampilot/core/tasks';
import { Cog, Keyboard, Mic, RotateCcw, Square } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { AppRequestError, appInfo, appRequest, isInApp, openAppSettings } from '@/lib/native-bridge';

/*
 * Voice draft (replaced the AI draft; original app d0a1bdf, ed023cf, ba5c94e): speak a task instead of typing it.
 *
 * The words are worked out on the device, so it costs nothing and needs no AI key:
 *   - the Kaampilot phone app (1.1.0+) → the phone's own speech recogniser, after Android's "Allow microphone?" pop-up
 *     (bridge request `voice`; a WebView on the office's http:// address gets no microphone itself);
 *   - Chrome / Edge / Safari on https or localhost → the browser's speech recognition (asks for the microphone first);
 *   - anything else (an older app, the http:// address, Firefox) → a box to speak into with the phone keyboard's mic.
 * The server then reads who it is for, by when and how long, and hands back a draft. It creates nothing: the form is
 * filled in and a person still presses Create, so a misheard name or date is seen first.
 */

const MAX_SECONDS = 120; // a task, not a meeting
const LANGS: Array<[string, string]> = [
  ['en-IN', 'English'],
  ['hi-IN', 'हिंदी'],
];
type Help = 'app-settings' | 'keyboard' | 'ios' | 'android' | 'desktop';
type State = 'idle' | 'asking' | 'listening' | 'dictating' | 'working';

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognizerClass = new () => Recognizer;

function browserSpeech(): RecognizerClass | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function device(): Help {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/* Ask the system for the microphone. The browser shows its own "Allow microphone?" the first time; after a "Block" it
   never asks again, so the answer is "blocked" and the person gets the steps to undo it. */
async function askForMic(): Promise<'granted' | 'blocked' | 'no-mic' | 'unsupported'> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const st = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
    if (st?.state === 'denied') return 'blocked';
  } catch {
    /* Safari / Firefox: just ask */
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // only asking — the recogniser listens
    return 'granted';
  } catch (e) {
    return (e as { name?: string })?.name === 'NotFoundError' ? 'no-mic' : 'blocked';
  }
}

function savedLang(): string {
  try {
    return localStorage.getItem('voice-lang') || 'en-IN';
  } catch {
    return 'en-IN';
  }
}

/** Where to switch the microphone back on, for the screen they are on. */
function AllowSteps({ where }: { where: Help }) {
  const steps: Record<Help, string[]> = {
    'app-settings': ['Tap “Open settings” below.', 'Permissions → Microphone → Allow.', 'Come back and tap “Try again”.'],
    keyboard: ['Phone Settings → Apps → Gboard (or Samsung Keyboard) → Permissions → Microphone → Allow.', 'Come back, tap the box below, then the mic on the keyboard.'],
    ios: ['Tap “aA” in the address bar → Website Settings → Microphone → Allow.', 'Or iPhone Settings → Safari → Microphone → Allow.', 'Come back and tap “Try again”.'],
    android: ['In Chrome tap ⋮ → Settings → Site settings → Microphone, find this site and set it to Allow.', 'If it still does not ask: phone Settings → Apps → Chrome → Permissions → Microphone → Allow.', 'Come back and tap “Try again”.'],
    desktop: ['Click the lock (or ⓘ) at the left of the address bar → Microphone → Allow.', 'On Windows also check Settings → Privacy & security → Microphone is on for your browser.', 'Come back and click “Try again”.'],
  };
  return (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 text-[13px] leading-relaxed text-muted-foreground">
      {steps[where].map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

const VOICE_APP_VERSION = '1.1.0';

export function VoiceNote({ onDraft, disabled }: { onDraft: (d: VoiceDraft) => void; disabled?: boolean }) {
  const [state, setState] = useState<State>('idle');
  const [lang, setLang] = useState(savedLang);
  const [secs, setSecs] = useState(0);
  const [heard, setHeard] = useState(''); // live words while speaking (browser)
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [help, setHelp] = useState<Help | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const words = useRef('');
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const draft = useVoiceTaskDraft();
  const inApp = isInApp();
  const versions = useAppVersionInfo(inApp).data;
  // Voice needs app 1.1.0 (it asks Android for the microphone), whatever the server's update prompt is set to.
  const oldApp = inApp && isOlderVersion(appInfo()?.version, VOICE_APP_VERSION);

  // never leave the microphone on
  useEffect(
    () => () => {
      try {
        rec.current?.abort();
      } catch {
        /* gone */
      }
      clearInterval(timer.current);
    },
    [],
  );

  const pickLang = (v: string) => {
    setLang(v);
    try {
      localStorage.setItem('voice-lang', v);
    } catch {
      /* private mode */
    }
  };

  const tick = (stopFn: () => void) => {
    setSecs(0);
    clearInterval(timer.current);
    timer.current = setInterval(
      () =>
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS) stopFn();
          return s + 1;
        }),
      1000,
    );
  };

  const sendWords = (text: string) => {
    clearInterval(timer.current);
    const said = text.trim();
    setHeard('');
    if (!said) {
      setState('idle');
      setErr('Did not catch anything — tap Voice draft and say the task again.');
      return;
    }
    setState('working');
    draft.mutate(said, {
      onSuccess: onDraft,
      onError: (e) => setErr(errorMessage(e)),
      onSettled: () => {
        setState('idle');
        setSecs(0);
      },
    });
  };

  const dictate = (why = '') => {
    setErr(why);
    setTyped('');
    setState('dictating');
  };

  // ---- the phone app: the phone's own recogniser --------------------------------
  async function startInApp() {
    setState('listening');
    tick(() => void appRequest('voice-stop').catch(() => {}));
    try {
      const res = await appRequest<{ text: string }>('voice', { lang });
      sendWords(res?.text ?? '');
    } catch (e) {
      clearInterval(timer.current);
      setState('idle');
      if (!(e instanceof AppRequestError)) return setErr(errorMessage(e));
      if (e.code === 'cancelled') return;
      if (e.blocked?.permission === 'microphone') {
        setErr(e.message);
        if (e.blocked.settings) setHelp('app-settings');
        return;
      }
      if (e.unavailable) return dictate(oldApp ? '' : e.message);
      setErr(e.message);
    }
  }

  // ---- Chrome / Edge / Safari ------------------------------------------------
  function startBrowser(Rec: RecognizerClass) {
    const r = new Rec();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    words.current = '';
    let finalText = '';
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += `${t} `;
        else interim += t;
      }
      words.current = (finalText + interim).trim();
      setHeard(words.current);
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setErr('The microphone is blocked for this site.');
        setHelp(device());
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setErr(`Voice stopped (${ev.error}). Try again, or type the task.`);
      }
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      if (words.current) sendWords(words.current);
      else {
        clearInterval(timer.current);
        setState('idle');
        setSecs(0);
        setHeard('');
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      setErr('Could not start the microphone.');
      return;
    }
    setState('listening');
    setHeard('');
    tick(() => {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    });
  }

  async function start() {
    setErr('');
    setHelp(null);
    if (inApp) {
      if (oldApp) return dictate();
      return startInApp();
    }
    const Rec = browserSpeech();
    if (!Rec) return dictate();
    // ask for the microphone first, so the browser's prompt appears now
    setState('asking');
    const got = await askForMic();
    setState('idle');
    if (got === 'blocked') {
      setErr('The microphone is blocked for this site. Allow it, then tap Try again.');
      setHelp(device());
      return;
    }
    if (got === 'no-mic') return dictate('No microphone found on this device. Use the box below instead.');
    startBrowser(Rec);
  }

  function stop() {
    setState('working');
    if (inApp) {
      void appRequest('voice-stop').catch(() => {});
      return;
    }
    try {
      rec.current?.stop();
    } catch {
      setState('idle');
    }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const panel = state === 'dictating' || heard || err || help;

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <NativeSelect aria-label="Voice language" title="Language you will speak in" className="h-8 w-auto text-[13px]" value={lang} disabled={state !== 'idle'} onChange={(e) => pickLang(e.target.value)}>
        {LANGS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
      {state === 'listening' ? (
        <Button type="button" variant="destructive" size="sm" onClick={stop}>
          <Square /> Done · {mmss}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={start}
          disabled={disabled || state === 'dictating'}
          loading={state === 'working' || state === 'asking'}
          title="Say the task out loud — who it is for, what to do and by when"
        >
          {state === 'idle' || state === 'dictating' ? <Mic /> : null}
          {state === 'working' ? 'Filling in…' : state === 'asking' ? 'Asking for the microphone…' : 'Voice draft'}
        </Button>
      )}
      {panel && (
        <div className="basis-full space-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {heard && (
            <p className="flex items-baseline gap-2">
              <Mic className="size-3.5 shrink-0 text-destructive" aria-hidden /> {heard}
            </p>
          )}
          {err && <p className="text-destructive">{err}</p>}
          {state === 'dictating' && (
            <>
              <p className="text-[13px] text-muted-foreground">
                Tap the <strong className="text-foreground">mic on your keyboard</strong> and say the task — who it is for, what to do and by when. Then press{' '}
                <strong className="text-foreground">Fill in the form</strong>.{' '}
                <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setHelp((h) => (h ? null : inApp || device() !== 'desktop' ? 'keyboard' : 'desktop'))}>
                  Keyboard mic not working?
                </Button>
              </p>
              {help && <AllowSteps where={help} />}
              {oldApp && versions?.apkUrl && (
                <p className="rounded-md border border-primary/30 bg-primary/8 px-2.5 py-1.5 text-[13px]">
                  <strong>Speak directly, with one tap to allow the mic:</strong> update the app once (you stay signed in).{' '}
                  <a href={versions.apkUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
                    Update now
                  </a>
                </p>
              )}
              {!inApp && typeof window !== 'undefined' && !window.isSecureContext && (
                <p className="text-xs text-muted-foreground">This http:// address is never given the microphone by the browser; the keyboard mic works, or use the phone app.</p>
              )}
              <Textarea rows={3} autoFocus aria-label="Say or type the task" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. Rahul ko kal 5 baje tak quotation bhejna hai" />
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={!typed.trim()} onClick={() => sendWords(typed)}>
                  <Keyboard /> Fill in the form
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => (setState('idle'), setTyped(''), setErr(''), setHelp(null))}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {help && state !== 'dictating' && (
            <>
              <AllowSteps where={help} />
              <div className="flex flex-wrap gap-2">
                {help === 'app-settings' && (
                  <Button type="button" size="sm" onClick={() => void openAppSettings()}>
                    <Cog /> Open settings
                  </Button>
                )}
                <Button type="button" size="sm" variant={help === 'app-settings' ? 'outline' : 'default'} onClick={start}>
                  <RotateCcw /> Try again
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => (setHelp(null), dictate())}>
                  <Keyboard /> Use the keyboard mic instead
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
