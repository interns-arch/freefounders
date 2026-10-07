import { randomBytes } from 'node:crypto';

// No 0/o, 1/l/i: tokens stay readable if someone types one from a printed label.
const QR_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function qrToken(length = 12): string {
  return Array.from(randomBytes(length), (b) => QR_ALPHABET[b % QR_ALPHABET.length]).join('');
}

/** Extracts the token from a scanned QR URL (…/scan/abc or …/id/abc), or returns the raw code. */
export function normaliseCode(raw: string): string {
  const code = raw.trim();
  const m = /\/(?:scan|id)\/([A-Za-z0-9_-]+)\/?$/.exec(code);
  return m ? m[1] : code;
}
