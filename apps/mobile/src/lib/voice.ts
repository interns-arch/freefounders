/**
 * Voice draft in the app (original app ba5c94e, PLAN.md §19.30): the phone's own speech recogniser turns what was said
 * into words, after Android's "Allow FreeFounders to record audio?" pop-up. A WebView on the office's plain http://
 * address gets no microphone, so the web app asks the shell (bridge request `voice`). The words go back to the web app,
 * which sends them to the Tasks API (no AI key needed). Nothing is recorded or kept.
 *
 * The native module (expo-speech-recognition) is only in a built app (EAS APK); Expo Go has none, so it is loaded lazily
 * and its absence is an ordinary "not available" answer (the web app then offers the keyboard's mic).
 */
import type { ExpoSpeechRecognitionModule as Module } from 'expo-speech-recognition';
import { voiceLang } from './protocol';

export type VoiceResult =
  | { ok: true; text: string }
  | { ok: false; message: string; code?: 'permission' | 'unavailable' | 'cancelled' | 'no-speech'; settings?: boolean };

function speechModule(): typeof Module | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: typeof Module }).ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

let active: { stop: () => void } | null = null;

/** Ends the listening started by listen() (the web's "Done" button); its words are still returned. */
export function stopListening(): boolean {
  if (!active) return false;
  active.stop();
  return true;
}

/** Asks for the microphone (Android's pop-up the first time), then listens until the person stops talking or taps Done. */
export async function listen(lang: unknown, maxSeconds = 120): Promise<VoiceResult> {
  const SR = speechModule();
  if (!SR) return { ok: false, code: 'unavailable', message: 'Voice needs the latest FreeFounders app. Use the keyboard mic for now.' };
  if (active) return { ok: false, message: 'Already listening.' };
  let available = true;
  try {
    available = SR.isRecognitionAvailable();
  } catch {
    available = true;
  }
  if (!available) return { ok: false, code: 'unavailable', message: 'This phone has no speech service. Use the keyboard mic instead.' };

  let perm = await SR.getPermissionsAsync().catch(() => null);
  if (!perm?.granted && perm?.canAskAgain !== false) perm = await SR.requestPermissionsAsync().catch(() => perm);
  if (!perm?.granted) {
    // After "Don't allow" twice Android stops asking: only the phone's Settings can allow it again.
    return perm && !perm.canAskAgain
      ? { ok: false, code: 'permission', settings: true, message: 'The microphone is off for FreeFounders. Tap "Open settings" → Permissions → Microphone → Allow, then try again.' }
      : { ok: false, code: 'permission', message: 'FreeFounders needs the microphone to hear the task. Tap "Try again" and choose "Allow".' };
  }

  return new Promise<VoiceResult>((resolve) => {
    let finalText = '';
    let partial = '';
    let error: VoiceResult | null = null;
    const subs = [
      SR.addListener('result', (e) => {
        const t = e.results?.[0]?.transcript ?? '';
        if (e.isFinal) finalText = `${finalText} ${t}`.trim();
        else partial = t;
      }),
      SR.addListener('error', (e) => {
        if (e.error === 'not-allowed') error = { ok: false, code: 'permission', settings: true, message: 'The microphone is blocked for FreeFounders. Allow it in the phone’s Settings.' };
        else if (e.error === 'no-speech' || e.error === 'speech-timeout') error = { ok: false, code: 'no-speech', message: 'Did not catch anything. Try again a little closer to the phone.' };
        else if (e.error === 'aborted') error = { ok: false, code: 'cancelled', message: 'cancelled' };
        else if (e.error === 'network') error = { ok: false, message: 'Voice needs the internet on this phone. Try again, or type the task.' };
        else error = { ok: false, message: `Voice stopped (${e.error}). Try again, or type the task.` };
      }),
      SR.addListener('end', () => finish()),
    ];
    const timer = setTimeout(() => SR.stop(), maxSeconds * 1000);
    function finish() {
      clearTimeout(timer);
      subs.forEach((s) => s.remove());
      active = null;
      const text = (finalText || partial).trim();
      if (text) resolve({ ok: true, text });
      else resolve(error ?? { ok: false, code: 'no-speech', message: 'Did not catch anything. Try again a little closer to the phone.' });
    }
    active = { stop: () => SR.stop() };
    try {
      SR.start({ lang: voiceLang(lang), interimResults: true, maxAlternatives: 1, continuous: false, addsPunctuation: true });
    } catch (e) {
      subs.forEach((s) => s.remove());
      clearTimeout(timer);
      active = null;
      resolve({ ok: false, code: 'unavailable', message: `Voice is not available on this phone (${e instanceof Error ? e.message : String(e)}). Type the task instead.` });
    }
  });
}
