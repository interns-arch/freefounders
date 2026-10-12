/** Files the web app hands to the phone (reports, CSV, labels, photos): pure helpers, tested under Node. */

const EXT: Record<string, string> = {
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
};

/** The usual extension for a MIME type ("" when unknown). */
export const extFor = (mime: string) => EXT[mime.split(';')[0].trim().toLowerCase()] ?? '';

/**
 * A file name that is safe to save on the phone: no folders, no characters Android refuses, at most 120 characters,
 * with an extension from the MIME type when it has none. "../a/b:c?.csv" → "c_.csv".
 */
export function safeFilename(name: string, mime = 'application/octet-stream'): string {
  let base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f<>:"|?*]+/g, '_').trim();
  base = base.replace(/^\.+/, '').replace(/\s+/g, ' ');
  if (!base) base = 'download';
  const ext = extFor(mime);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(base) && ext) base = `${base}.${ext}`;
  if (base.length > 120) {
    const dot = base.lastIndexOf('.');
    const tail = dot > 0 && base.length - dot <= 9 ? base.slice(dot) : '';
    base = base.slice(0, 120 - tail.length) + tail;
  }
  return base;
}

/** Plain base64 (a "data:…;base64," prefix and line breaks removed). */
export const stripDataUrl = (base64: string) => base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');

/** How many bytes a base64 text decodes to. */
export function base64Bytes(base64: string): number {
  const b = stripDataUrl(base64);
  const pad = b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b.length * 3) / 4) - pad);
}

/** True when the text is well-formed base64. */
export const isBase64 = (base64: string) => {
  const b = stripDataUrl(base64);
  return b.length > 0 && b.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b);
};
