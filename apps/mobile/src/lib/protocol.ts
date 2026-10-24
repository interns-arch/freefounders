/**
 * The bridge between the Kaampilot web app and this shell (PLAN.md §19.17). Pure functions only (no React Native), so
 * the unit tests can run them under plain Node. The web side is apps/web/src/lib/native-bridge.ts.
 *
 *   web → app (request)  {"id": "r1", "type": "location"}
 *                        {"id": "r2", "type": "photo", "title": "Check in", "optional": false}
 *                        {"id": "r2", "type": "photo", "title": "Asset photo", "facing": "back"}   (back camera; default front)
 *                        {"id": "r3", "type": "download", "filename": "report.xlsx", "mime": "…", "base64": "…"}
 *                        {"id": "r4", "type": "print", "html": "<html>…"}
 *                        {"id": "r5", "type": "voice", "lang": "en-IN" | "hi-IN"}   the phone's speech recogniser (mic pop-up)
 *                        {"id": "r6", "type": "voice-stop"}                          "Done": stop listening, r5 gets the words
 *                        {"id": "r7", "type": "reminder-set", "settings": {"enabled": true, "time": "09:20", "days": [1,2,3,4,5,6],
 *                                     "mode": "vibrate" | "ring" | "ring-vibrate", "followUpMinutes": 10, "count": 3}}   punch-in reminder (§19.32; count: 1.2.2+, §19.39)
 *                        {"id": "r8", "type": "reminder-get"}          settings on this phone + notification permission
 *                        {"id": "r9", "type": "reminder-skip-today"}   checked in: no more reminders today, back tomorrow
 *                        {"id": "rA", "type": "reminder-off"}
 *                        {"id": "rB", "type": "reminder-test", "mode": "ring-vibrate"}   one reminder in 5 seconds
 *   web → app (event, from the injected script; no answer)
 *                        {"type": "scroll", "atTop": true}          pull-to-refresh only when the page is at the top
 *                        {"type": "camera-for-files"}               a file picker wants the camera option
 *   app → web            {"id": "r1", "ok": true, "data": {"latitude": …, "longitude": …, "accuracy": …}}
 *                        {"id": "r2", "ok": true, "data": "data:image/jpeg;base64,…"}   (data null = no photo, optional only)
 *                        {"id": "r2", "ok": false, "error": "cancelled"}
 *                        {"id": "r3", "ok": true, "data": {"saved": true}}
 *                        {"id": "r5", "ok": true, "data": {"text": "Rahul ko kal 5 baje tak quotation bhejna hai"}}
 *                        {"id": "r5", "ok": false, "error": "…", "code": "permission", "permission": "microphone", "settings": true}
 *                        {"id": "r5", "ok": false, "error": "…", "code": "unavailable"}   (no speech service / Expo Go)
 *                        {"id": "r7", "ok": true, "data": {"settings": {…}, "permission": "granted", "next": "2026-10-23T09:20:00.000Z"}}
 *                        {"id": "r7", "ok": false, "error": "…", "code": "permission", "permission": "notifications", "settings": true}
 */

import { type ReminderMode, type ReminderSettings, parseReminderSettings, reminderMode } from './reminder-plan.ts';

export type AppRequest =
  | { id: string; type: 'location' }
  | { id: string; type: 'open-settings' }
  | { id: string; type: 'photo'; title: string; optional: boolean; facing: 'front' | 'back' }
  | { id: string; type: 'download'; filename: string; mime: string; base64: string }
  | { id: string; type: 'print'; html: string }
  | { id: string; type: 'voice'; lang: VoiceLang }
  | { id: string; type: 'voice-stop' }
  | { id: string; type: 'reminder-set'; settings: ReminderSettings }
  | { id: string; type: 'reminder-get' }
  | { id: string; type: 'reminder-skip-today' }
  | { id: string; type: 'reminder-off' }
  | { id: string; type: 'reminder-test'; mode: ReminderMode };

/** The languages the voice draft offers (Indian English, Hindi). */
export const VOICE_LANGS = ['en-IN', 'hi-IN'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
export const voiceLang = (v: unknown): VoiceLang => (VOICE_LANGS as readonly unknown[]).includes(v) ? (v as VoiceLang) : 'en-IN';

export type AppEvent = { type: 'scroll'; atTop: boolean } | { type: 'camera-for-files' };

export type Parsed = { kind: 'request'; request: AppRequest } | { kind: 'event'; event: AppEvent } | { kind: 'invalid'; id?: string; error: string };

/** The largest file the web may hand over (base64 text); bigger reports should be downloaded on a computer. */
export const MAX_BASE64 = 40 * 1024 * 1024;

const str = (v: unknown): v is string => typeof v === 'string';

export function parseMessage(raw: unknown): Parsed {
  if (!str(raw)) return { kind: 'invalid', error: 'Not a message.' };
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { kind: 'invalid', error: 'Not a message.' };
    m = v as Record<string, unknown>;
  } catch {
    return { kind: 'invalid', error: 'Not a message.' };
  }
  const id = str(m.id) && m.id.length > 0 && m.id.length <= 64 ? m.id : undefined;

  if (!id) {
    if (m.type === 'scroll') return { kind: 'event', event: { type: 'scroll', atTop: m.atTop === true } };
    if (m.type === 'camera-for-files') return { kind: 'event', event: { type: 'camera-for-files' } };
    return { kind: 'invalid', error: 'A request needs an id.' };
  }
  switch (m.type) {
    case 'location':
      return { kind: 'request', request: { id, type: 'location' } };
    case 'open-settings':
      return { kind: 'request', request: { id, type: 'open-settings' } };
    case 'photo':
      return {
        kind: 'request',
        request: {
          id,
          type: 'photo',
          title: str(m.title) && m.title.trim() ? m.title.trim().slice(0, 60) : 'Selfie',
          optional: m.optional === true,
          // Selfies (punch) use the front camera; photos of things (assets) the back one (PLAN.md §19.34).
          facing: m.facing === 'back' ? 'back' : 'front',
        },
      };
    case 'download': {
      if (!str(m.base64) || !m.base64) return { kind: 'invalid', id, error: 'The file is empty.' };
      if (m.base64.length > MAX_BASE64) return { kind: 'invalid', id, error: 'This file is too big for the phone. Download it on a computer.' };
      const mime = str(m.mime) && /^[\w.+-]+\/[\w.+-]+/.test(m.mime) ? m.mime.split(';')[0].trim() : 'application/octet-stream';
      return { kind: 'request', request: { id, type: 'download', filename: str(m.filename) ? m.filename : '', mime, base64: m.base64 } };
    }
    case 'print':
      if (!str(m.html) || !m.html) return { kind: 'invalid', id, error: 'Nothing to print.' };
      return { kind: 'request', request: { id, type: 'print', html: m.html } };
    case 'voice':
      return { kind: 'request', request: { id, type: 'voice', lang: voiceLang(m.lang) } };
    case 'voice-stop':
      return { kind: 'request', request: { id, type: 'voice-stop' } };
    case 'reminder-set': {
      const r = parseReminderSettings(m.settings);
      if (!r.ok) return { kind: 'invalid', id, error: r.error };
      return { kind: 'request', request: { id, type: 'reminder-set', settings: r.settings } };
    }
    case 'reminder-get':
    case 'reminder-skip-today':
    case 'reminder-off':
      return { kind: 'request', request: { id, type: m.type } };
    case 'reminder-test':
      return { kind: 'request', request: { id, type: 'reminder-test', mode: reminderMode(m.mode) } };
    default:
      return { kind: 'invalid', id, error: `This app cannot do "${String(m.type)}". Update the Kaampilot app.` };
  }
}

export const replyOk = (id: string, data: unknown = null) => JSON.stringify({ id, ok: true, data });
/** `extra` tells the web why (e.g. {code: 'permission', permission: 'location', settings: true}) so it can offer "Allow". */
export const replyError = (id: string, error: string, extra?: Record<string, unknown>) => JSON.stringify({ ...extra, id, ok: false, error });

/**
 * "scheme://host[:port]" of an http(s) address, lower-case, without a default port; null for anything else. Plain string
 * work on purpose (no URL object), so it behaves the same under Node and on the phone.
 */
export function originOf(url: string): string | null {
  const m = /^(https?):\/\/(?:[^@/?#\s]*@)?(\[[0-9a-f:.]+\]|[^:/?#\s]+)(?::(\d{1,5}))?(?=[/?#]|$)/i.exec(url.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  const port = m[3] && !((scheme === 'http' && m[3] === '80') || (scheme === 'https' && m[3] === '443')) ? `:${Number(m[3])}` : '';
  return `${scheme}://${host}${port}`;
}

/**
 * Where a page load should go. Pages of the Kaampilot server stay in the app; other sites, phone numbers, e-mail and
 * WhatsApp open in the phone's own apps. `about:blank`, `javascript:` (runs in the same page) and the server's own
 * `blob:` addresses stay. Everything else is blocked: a `data:` page (it would get the app's powers) and, inside a frame,
 * any other site (a frame must never start another app on its own).
 *
 * Payments (PLAN.md §21.10): Cashfree's pages (https://*.cashfree.com) stay in the app, in a frame too; while a payment
 * is on (`paying`, see paymentStep) the bank's 3-D Secure pages stay as well, until the page is back on the server.
 * UPI app links (upi://, or an Android intent:// for a UPI app) open the UPI app even from Cashfree's page (see
 * outsideUrl): that is how "Pay with a UPI app" works.
 */
export function linkTarget(url: string, server: string, topFrame = true, paying = false): 'inside' | 'outside' | 'block' {
  const u = url.trim();
  if (/^about:(blank|srcdoc)$/i.test(u) || /^javascript:/i.test(u)) return 'inside';
  if (/^blob:/i.test(u)) return originOf(u.slice(5)) === originOf(server) ? 'inside' : 'block';
  if (/^data:/i.test(u)) return 'block';
  if (upiAppUrl(u)) return 'outside';
  const o = originOf(u);
  if (o && o === originOf(server)) return 'inside';
  if (isPaymentPage(u)) return 'inside';
  if (topFrame && paying && o?.startsWith('https://')) return 'inside';
  return topFrame ? 'outside' : 'block';
}

/** Cashfree's checkout and its pages: https on cashfree.com or one of its sub-domains (payments., sandbox., sdk.). */
export function isPaymentPage(url: string): boolean {
  const o = originOf(url);
  return !!o && /^https:\/\/([a-z0-9-]+\.)*cashfree\.com$/.test(o);
}

/**
 * A payment starts when a top-level page of Cashfree loads and ends when the page is back on the Kaampilot server
 * (Cashfree sends the person back to the return URL there). Other pages in between (the bank) keep the current state.
 */
export function paymentStep(url: string, server: string, paying: boolean): boolean {
  if (isPaymentPage(url)) return true;
  const o = originOf(url);
  if (o && o === originOf(server)) return false;
  return paying;
}

/** Schemes of UPI apps that Cashfree's "Pay with a UPI app" may open (upi:// is the standard one). */
const UPI_SCHEMES = ['upi', 'phonepe', 'tez', 'gpay', 'paytmmp', 'paytm', 'bhim', 'credpay', 'mobikwik', 'amazonpay'];

/**
 * The address to hand to Android for a UPI payment link, or null when it is not one:
 * "upi://pay?pa=…" stays; "intent://pay?pa=…#Intent;scheme=upi;package=com.phonepe.app;end" → "upi://pay?pa=…" (React
 * Native's Linking cannot open intent:// itself; Android then offers the UPI apps, or opens the named one).
 */
export function upiAppUrl(url: string): string | null {
  const u = url.trim();
  const direct = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (direct && UPI_SCHEMES.includes(direct[1].toLowerCase())) return u;
  const m = /^intent:\/\/([^#]*)#Intent;(.*)$/i.exec(u);
  if (!m) return null;
  const scheme = /(?:^|;)scheme=([a-z][a-z0-9+.-]*)(?:;|$)/i.exec(m[2])?.[1]?.toLowerCase();
  return scheme && UPI_SCHEMES.includes(scheme) ? `${scheme}://${m[1]}` : null;
}

/** What to open outside the app for a link: the UPI app address for a UPI link, else the link itself. */
export const outsideUrl = (url: string) => upiAppUrl(url) ?? url;

/** True when a bridge message comes from a page of the Kaampilot server (any other page is ignored). */
export function fromServer(pageUrl: string | undefined, server: string): boolean {
  return typeof pageUrl === 'string' && originOf(pageUrl) !== null && originOf(pageUrl) === originOf(server);
}

/** Office network or this phone/PC: the only places plain http:// is accepted (everything else needs https://). */
export function isLocalHost(origin: string): boolean {
  const host = origin.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local') || !host.includes('.')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * A server address typed by a person → "scheme://host[:port]" (no path, no trailing slash), or null when it is not one.
 * Without a scheme an office-network address gets http:// and anything else https://. Plain http:// is accepted only for
 * the office network (a password sent over http on the internet can be read on the way).
 * "192.168.137.1:8080" → "http://192.168.137.1:8080"; "app.example.com" → "https://app.example.com";
 * "http://app.example.com" → null.
 */
export function normalizeServerUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^https?:\/\//i.test(t)) return null;
  let origin: string | null;
  if (/^https?:\/\//i.test(t)) origin = originOf(t);
  else {
    const local = originOf(`http://${t}`);
    origin = local && isLocalHost(local) ? local : originOf(`https://${t}`);
  }
  if (!origin) return null;
  return origin.startsWith('https://') || isLocalHost(origin) ? origin : null;
}
