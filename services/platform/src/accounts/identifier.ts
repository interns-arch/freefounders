/**
 * An account identifier (PLAN.md §21): an email, or an Indian mobile number (10 digits starting 6-9, optionally written
 * with +91, 91 or 0 in front, spaces or dashes), normalised to `+91XXXXXXXXXX`.
 */
export interface Identifier {
  kind: 'email' | 'mobile';
  value: string;
  channel: 'email' | 'sms';
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function normaliseIdentifier(input: string | null | undefined): Identifier | null {
  const raw = (input ?? '').trim();
  if (!raw || raw.length > 200) return null;
  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    return EMAIL_RE.test(email) ? { kind: 'email', value: email, channel: 'email' } : null;
  }
  if (!/^[+0-9 ()-]+$/.test(raw)) return null;
  let digits = raw.replace(/[^0-9]/g, '');
  if (raw.startsWith('+')) {
    if (!digits.startsWith('91')) return null;
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? { kind: 'mobile', value: `+91${digits}`, channel: 'sms' } : null;
}

