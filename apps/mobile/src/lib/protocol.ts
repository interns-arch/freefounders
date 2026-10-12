/**
 * The bridge between the FreeFounders web app and this shell (PLAN.md §19.17). Pure functions only (no React Native), so
 * the unit tests can run them under plain Node. The web side is apps/web/src/lib/native-bridge.ts.
 *
 *   web → app (request)  {"id": "r1", "type": "location"}
 *                        {"id": "r2", "type": "photo", "title": "Check in", "optional": false}
 *                        {"id": "r3", "type": "download", "filename": "report.xlsx", "mime": "…", "base64": "…"}
 *                        {"id": "r4", "type": "print", "html": "<html>…"}
 *   web → app (event, from the injected script; no answer)
 *                        {"type": "scroll", "atTop": true}          pull-to-refresh only when the page is at the top
 *                        {"type": "camera-for-files"}               a file picker wants the camera option
 *   app → web            {"id": "r1", "ok": true, "data": {"latitude": …, "longitude": …, "accuracy": …}}
 *                        {"id": "r2", "ok": true, "data": "data:image/jpeg;base64,…"}   (data null = no photo, optional only)
 *                        {"id": "r2", "ok": false, "error": "cancelled"}
 *                        {"id": "r3", "ok": true, "data": {"saved": true}}
 */

export type AppRequest =
  | { id: string; type: 'location' }
  | { id: string; type: 'photo'; title: string; optional: boolean }
  | { id: string; type: 'download'; filename: string; mime: string; base64: string }
  | { id: string; type: 'print'; html: string };

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
    case 'photo':
      return {
        kind: 'request',
        request: { id, type: 'photo', title: str(m.title) && m.title.trim() ? m.title.trim().slice(0, 60) : 'Selfie', optional: m.optional === true },
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
    default:
      return { kind: 'invalid', id, error: `This app cannot do "${String(m.type)}". Update the FreeFounders app.` };
  }
}

export const replyOk = (id: string, data: unknown = null) => JSON.stringify({ id, ok: true, data });
export const replyError = (id: string, error: string) => JSON.stringify({ id, ok: false, error });

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
 * Where a link should open. Pages of the FreeFounders server stay in the app; other sites, phone numbers, e-mail and
 * WhatsApp open in the phone's own apps. Blank/blob/data loads (inside the page) stay.
 */
export function linkTarget(url: string, server: string): 'inside' | 'outside' {
  if (/^(about:|blob:|data:|javascript:)/i.test(url)) return 'inside';
  const o = originOf(url);
  return o && o === originOf(server) ? 'inside' : 'outside';
}

/**
 * A server address typed by a person → "http://host[:port]" (no path, no trailing slash), or null when it is not one.
 * "192.168.137.1:8080" → "http://192.168.137.1:8080"; "https://app.example.com/" → "https://app.example.com".
 */
export function normalizeServerUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^https?:\/\//i.test(t)) return null;
  return originOf(/^https?:\/\//i.test(t) ? t : `http://${t}`);
}
