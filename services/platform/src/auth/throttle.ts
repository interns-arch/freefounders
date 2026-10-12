import { Injectable } from '@nestjs/common';

/**
 * Failed-attempt counters kept in memory (one Platform process). They sit in front of the per-account lockout that
 * lives in the database (`logins.failed_logins` / `locked_until`, shared by every process):
 * - per IP address: stops password spraying (one password tried against many accounts from one place);
 * - per sign-in name that matches no account: answers exactly like a locked account after 5 tries, so the lockout
 *   message cannot be used to find out which names exist;
 * - per person for "change password": a stolen access token cannot be used to guess the current password.
 * With several Platform processes each keeps its own counters (the database lockout stays exact); see
 * docs/security/platform.md for moving them into Postgres if that is ever needed.
 */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
/** Same number as the account lockout. */
export const NAME_LIMIT = 5;
const MAX_KEYS = 50_000;

/** Failed sign-ins from one IP address in 15 minutes before it must wait (0 = off). Read on every call. */
export function ipLimit(): number {
  const raw = process.env.LOGIN_IP_LIMIT?.trim();
  const n = raw ? Number(raw) : 50;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

@Injectable()
export class Throttle {
  private readonly hits = new Map<string, number[]>();

  private recent(key: string, now = Date.now()): number[] {
    const list = this.hits.get(key);
    if (!list) return [];
    const fresh = list.filter((t) => now - t < THROTTLE_WINDOW_MS);
    if (fresh.length) this.hits.set(key, fresh);
    else this.hits.delete(key);
    return fresh;
  }

  /** How many failures `key` had in the window. */
  count(key: string): number {
    return this.recent(key).length;
  }

  blocked(key: string, limit: number): boolean {
    return limit > 0 && this.count(key) >= limit;
  }

  fail(key: string) {
    const now = Date.now();
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list.slice(-200));
    if (this.hits.size > MAX_KEYS) {
      // Bounded memory: forget the oldest keys first (Map keeps insertion order).
      for (const k of [...this.hits.keys()].slice(0, this.hits.size - MAX_KEYS)) this.hits.delete(k);
    }
  }

  clear(key: string) {
    this.hits.delete(key);
  }

  /** Tests only. */
  reset() {
    this.hits.clear();
  }
}
