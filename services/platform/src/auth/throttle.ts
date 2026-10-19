import { Injectable } from '@nestjs/common';

/**
 * Failed-attempt counters kept in memory (one Platform process).
 * - per IP address: a bot guard only (founder decision 2026-10-19: people may try their password any number of times).
 *   1000 failed sign-ins per 15 minutes from one address; a whole office on one Wi-Fi never gets near it.
 * - only when `LOGIN_MAX_FAILED` > 0 (the old lockout, off by default): per sign-in name that matches no account, so it
 *   answers exactly like a locked account after that many tries and the lockout message cannot reveal which names exist;
 *   and per person for "change password" (a stolen access token cannot guess the current password quickly).
 * With several Platform processes each keeps its own counters (the database lockout, when on, stays exact); see
 * docs/security/platform.md for moving them into Postgres if that is ever needed.
 */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 50_000;
const DEFAULT_IP_LIMIT = 1000;

/** Failed sign-ins from one IP address in 15 minutes before it must wait (0 = off). Read on every call. */
export function ipLimit(): number {
  const raw = process.env.LOGIN_IP_LIMIT?.trim();
  const n = raw ? Number(raw) : DEFAULT_IP_LIMIT;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_IP_LIMIT;
}

/**
 * Wrong passwords before a login / account is locked for 15 minutes. 0 (default, founder decision 2026-10-19) = never
 * lock: unlimited tries. A positive number turns the old lockout (and the per-name and change-password limits) back on.
 */
export function maxFailedLogins(): number {
  const raw = process.env.LOGIN_MAX_FAILED?.trim();
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The answer when one network has failed too often (HTTP 429). */
export const IP_LIMIT_MESSAGE = 'Too many sign-in attempts from this network. Wait a few minutes.';

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
