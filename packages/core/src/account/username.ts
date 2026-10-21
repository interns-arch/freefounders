/**
 * Account usernames (PLAN.md §21.5), the parts without React: the same shape rules and messages as the Platform
 * (services/platform/src/accounts/username.ts; the server always decides), and a suggestion from a person's name.
 */

export const USERNAME_MESSAGES = {
  taken: 'This username is already taken. Try another.',
  invalid: 'Use 3–30 letters, numbers, dots, - or _, starting with a letter.',
  reserved: 'This username is reserved.',
} as const;
export type UsernameProblem = keyof typeof USERNAME_MESSAGES;

/** GET auth/username-available. */
export interface UsernameAvailability {
  available: boolean;
  reason?: UsernameProblem;
  message: string;
  /** The stored form (lower-case) when available. */
  username?: string;
}

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,29}$/;

export const normaliseUsername = (raw: string) => raw.trim().toLowerCase();

/** 'invalid' when the shape is wrong (checked here, no server call needed), else null (the server checks the rest). */
export function usernameShapeProblem(raw: string): 'invalid' | null {
  return USERNAME_RE.test(normaliseUsername(raw)) ? null : 'invalid';
}

/**
 * A first suggestion from a name: "test" → "test", "Asha Rao" → "asha.rao", "Ravi K. Sharma" → "ravi.k.sharma".
 * Letters and digits of each word (accents dropped), joined by dots; starts with a letter; 3–30 characters (short
 * names get digits added). null when the name has no Latin letters.
 */
export function usernameFromName(fullName: string): string | null {
  const words = fullName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let base = words.join('.').replace(/^[^a-z]+/, '');
  if (!base) return null;
  if (base.length > 30) base = base.slice(0, 30).replace(/[._-]+$/, '');
  while (base.length < 3) base += '1';
  return base;
}

/** Further candidates when the first one is taken: asha.rao2 … asha.rao9, then a few random numbers. */
export function usernameVariants(base: string, count = 5, random: () => number = Math.random): string[] {
  const out: string[] = [];
  const room = (suffix: string) => `${base.slice(0, 30 - suffix.length).replace(/[._-]+$/, '')}${suffix}`;
  for (let n = 2; n <= 3; n++) out.push(room(String(n)));
  while (out.length < count) out.push(room(String(10 + Math.floor(random() * 990))));
  return [...new Set(out)];
}
