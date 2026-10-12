/**
 * The bridge to the FreeFounders phone app (PLAN.md §19.17). On Android the app is this web app inside a native shell
 * (apps/mobile, react-native-webview). The shell sets `window.FreeFoundersApp = { platform, version }` before the page
 * loads and answers requests sent with `window.ReactNativeWebView.postMessage`:
 *
 *   web → app   {"id": "r1", "type": "location" | "photo" | "download", ...payload}
 *   app → web   {"id": "r1", "ok": true, "data": …}   or   {"id": "r1", "ok": false, "error": "message for the person"}
 *
 * location → {latitude, longitude, accuracy}; photo {title, optional} → "data:image/jpeg;base64,…" (null = "punch without
 * a photo", only when optional; error "cancelled" when closed); download {filename, mime, base64} → {saved: true};
 * print {html} → {printed: true} (Android's print dialog, which can also save a PDF).
 * In a normal browser none of this is used and every caller keeps its browser behaviour.
 */

export interface AppInfo {
  platform: 'android' | 'ios';
  version: string;
}

export type AppRequestType = 'location' | 'photo' | 'download' | 'print' | 'open-settings';

interface Reply {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Why it failed, when the person can fix it: a permission the phone blocked (settings = only in the phone's Settings). */
  code?: 'permission';
  permission?: 'location' | 'camera';
  settings?: boolean;
}

declare global {
  interface Window {
    FreeFoundersApp?: AppInfo;
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/** Inside the phone app: the shell's info; in a browser: null. */
export function appInfo(): AppInfo | null {
  if (typeof window === 'undefined' || !window.FreeFoundersApp || !window.ReactNativeWebView) return null;
  return window.FreeFoundersApp;
}

export const isInApp = () => appInfo() !== null;

/** An answer from the app that says no (`code` is "cancelled", "timeout" or "failed"). */
export class AppRequestError extends Error {
  /** Set when the phone blocked a permission: which one, and whether only the phone's Settings can allow it again. */
  blocked?: { permission: 'location' | 'camera'; settings: boolean };
  constructor(
    message: string,
    readonly code: 'cancelled' | 'timeout' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'AppRequestError';
  }
}

const TIMEOUTS: Record<AppRequestType, number> = {
  location: 60_000, // includes the permission question the first time
  photo: 10 * 60_000, // the person is taking a selfie
  download: 60_000,
  print: 10 * 60_000,
  'open-settings': 30_000,
};

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let listening = false;
let seq = 0;

function onMessage(event: Event) {
  const raw = (event as MessageEvent).data;
  if (typeof raw !== 'string' || !raw.startsWith('{')) return;
  let reply: Reply;
  try {
    reply = JSON.parse(raw) as Reply;
  } catch {
    return;
  }
  const waiting = typeof reply.id === 'string' ? pending.get(reply.id) : undefined;
  if (!waiting) return;
  pending.delete(reply.id);
  clearTimeout(waiting.timer);
  if (reply.ok) waiting.resolve(reply.data ?? null);
  else {
    const msg = reply.error || 'The app could not do that.';
    const err = new AppRequestError(msg === 'cancelled' ? 'Cancelled.' : msg, msg === 'cancelled' ? 'cancelled' : 'failed');
    if (reply.code === 'permission' && reply.permission) err.blocked = { permission: reply.permission, settings: !!reply.settings };
    waiting.reject(err);
  }
}

/** Asks the phone app for something (see the protocol above). Rejects with AppRequestError. */
export function appRequest<T>(type: AppRequestType, payload: Record<string, unknown> = {}, timeoutMs = TIMEOUTS[type]): Promise<T> {
  const bridge = isInApp() ? window.ReactNativeWebView : undefined;
  if (!bridge) return Promise.reject(new AppRequestError('Not running inside the FreeFounders app.'));
  if (!listening) {
    // Android's WebView delivers the shell's answers on `document`, iOS on `window`.
    document.addEventListener('message', onMessage);
    window.addEventListener('message', onMessage);
    listening = true;
  }
  const id = `r${Date.now().toString(36)}-${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new AppRequestError('The app did not answer in time. Try again.', 'timeout'));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    try {
      bridge.postMessage(JSON.stringify({ ...payload, id, type }));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(new AppRequestError('The app could not be reached.'));
    }
  });
}

/** A Blob as plain base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Saves a file. In a browser: the usual <a download>. In the phone app (a WebView cannot save blobs): the file goes to
 * the app, which saves it and opens Android's share sheet (save to Files / Drive, send on WhatsApp…).
 */
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  if (isInApp()) {
    try {
      const base64 = await blobToBase64(blob);
      await appRequest('download', { filename, mime: blob.type || 'application/octet-stream', base64 });
    } catch (e) {
      // The app shows its own message when saving fails; nothing more to do here.
      if (!(e instanceof AppRequestError)) throw e;
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * In the phone app, links with a `download` attribute that point at a file on the server (e.g. Assets photos) are
 * fetched with the sign-in cookie and saved through the app. Installed once at start; does nothing in a browser.
 */
export function installAppDownloadLinks() {
  if (!isInApp()) return;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null;
      if (!a || !a.href) return;
      e.preventDefault();
      const name = a.getAttribute('download') || decodeURIComponent(a.pathname.split('/').pop() || 'download');
      void fetch(a.href, { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => saveFile(name, blob))
        .catch(() => window.alert('The file could not be downloaded. Check your connection and try again.'));
    },
    true,
  );
}

/**
 * Prints the page (ID cards, labels). In a browser: window.print(). In the phone app (a WebView cannot print): the
 * page's HTML, with a <base> so its styles and images load, goes to the app, which opens Android's print dialog.
 */
export async function printPage(): Promise<void> {
  if (!isInApp()) return window.print();
  // Scripts are left out: the printed copy is a still picture of the page, not a second copy of the app.
  const html = document.documentElement.outerHTML
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<head([^>]*)>/i, `<head$1><base href="${location.origin}/">`);
  try {
    await appRequest('print', { html });
  } catch (e) {
    if (!(e instanceof AppRequestError)) throw e;
  }
}

/** Phone app: opens this app's page in the phone's Settings (to allow a blocked permission). */
export async function openAppSettings(): Promise<void> {
  if (isInApp()) await appRequest('open-settings').catch(() => {});
}
