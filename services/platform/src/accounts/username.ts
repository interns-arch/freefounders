import { ConflictException, HttpException } from '@nestjs/common';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '../db/db.service';
import { accounts, logins, people } from '../db/schema';
import { badRequest } from '../common/http';

/**
 * Usernames of accounts (PLAN.md §21.5): an optional sign-in name a self-signed-up person chooses, next to their email /
 * mobile. Stored lower-case. One namespace with admin-made logins: a name is free only if no account and no admin-made
 * login uses it (case-insensitive), and it is nobody's employee ID (sign-in would otherwise be ambiguous).
 */
export const USERNAME_MESSAGES = {
  taken: 'This username is already taken. Try another.',
  invalid: 'Use 3–30 letters, numbers, dots, - or _, starting with a letter.',
  reserved: 'This username is reserved.',
} as const;
export type UsernameProblem = keyof typeof USERNAME_MESSAGES;

/**
 * 3–30 characters, starts with a letter (so never all digits: it cannot look like a mobile number or a numeric employee
 * ID), then letters, digits, dot, underscore, hyphen. No '@' (never mistaken for an email).
 */
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,29}$/;

/** Names that would look official or collide with routes. `owner` stays usable by existing admin-made logins only. */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'admins', 'owner', 'owners', 'support', 'help', 'helpdesk', 'staff', 'root', 'system', 'sysadmin',
  'superuser', 'super', 'moderator', 'mod', 'freefounders', 'free-founders', 'free_founders', 'free.founders', 'founder',
  'founders', 'api', 'www', 'mail', 'email', 'postmaster', 'hostmaster', 'webmaster', 'abuse', 'security', 'billing',
  'payments', 'invoice', 'invoices', 'account', 'accounts', 'login', 'logout', 'signin', 'signup', 'register', 'join',
  'console', 'settings', 'platform', 'tasks', 'assets', 'attendance', 'hr', 'me', 'null', 'undefined', 'anonymous',
  'guest', 'user', 'users', 'official', 'team', 'info', 'noreply', 'no-reply', 'razorpay',
]);

/** Lower-cased and trimmed (what is stored and compared). */
export const normaliseUsername = (raw: string | null | undefined) => (raw ?? '').trim().toLowerCase();

/** Format and reserved words only (no database). */
export function usernameShape(raw: string | null | undefined): { ok: true; value: string } | { ok: false; reason: Exclude<UsernameProblem, 'taken'> } {
  const value = normaliseUsername(raw);
  if (!USERNAME_RE.test(value)) return { ok: false, reason: 'invalid' };
  if (RESERVED_USERNAMES.has(value) || value.startsWith('freefounders') || value.startsWith('admin')) return { ok: false, reason: 'reserved' };
  return { ok: true, value };
}

/** Looks like an account username (sign-in uses it to decide whether to look in accounts.username). */
export const looksLikeUsername = (raw: string) => USERNAME_RE.test(normaliseUsername(raw));

/**
 * Is the name used by an account, an admin-made login, or as someone's employee ID (case-insensitive)?
 * `except.accountId`: the account changing its own name; `except.personId`: the person whose login is being set.
 */
export async function usernameTaken(db: Executor, name: string, except: { accountId?: string | null; personId?: string | null } = {}): Promise<boolean> {
  const value = normaliseUsername(name);
  if (!value) return false;
  const [acc] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(sql`lower(${accounts.username}) = ${value}`, except.accountId ? ne(accounts.id, except.accountId) : undefined))
    .limit(1);
  if (acc) return true;
  const [login] = await db
    .select({ id: logins.personId })
    .from(logins)
    .innerJoin(people, eq(people.id, logins.personId))
    .where(
      and(
        sql`lower(${logins.username}) = ${value}`,
        except.personId ? ne(logins.personId, except.personId) : undefined,
        // The account's own memberships never block its name.
        except.accountId ? or(isNull(people.accountId), ne(people.accountId, except.accountId)) : undefined,
      ),
    )
    .limit(1);
  if (login) return true;
  const [coded] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        sql`lower(${people.employeeCode}) = ${value}`,
        except.personId ? ne(people.id, except.personId) : undefined,
        except.accountId ? or(isNull(people.accountId), ne(people.accountId, except.accountId)) : undefined,
      ),
    )
    .limit(1);
  return !!coded;
}

/** Is the name used by an account? Checked when an admin sets a login username or an employee ID. */
export async function accountUsernameTaken(db: Executor, name: string): Promise<boolean> {
  const value = normaliseUsername(name);
  if (!value) return false;
  const [acc] = await db.select({ id: accounts.id }).from(accounts).where(sql`lower(${accounts.username}) = ${value}`).limit(1);
  return !!acc;
}

/**
 * Serialises everyone claiming the same name inside the current transaction (accounts and admin-made logins live in two
 * tables, so one unique index cannot cover both). Released at commit / rollback.
 */
export async function lockUsername(db: Executor, name: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'ff-username:' + normaliseUsername(name)}))`);
}

/** 409 with the field, so the web shows it next to the Username field. */
export const usernameConflict = (field = 'username') =>
  new ConflictException({ statusCode: 409, message: USERNAME_MESSAGES.taken, field, errors: { [field]: USERNAME_MESSAGES.taken } });

/** 400 for a malformed or reserved name. */
export const usernameRefused = (reason: Exclude<UsernameProblem, 'taken'>, field = 'username') =>
  badRequest(USERNAME_MESSAGES[reason], { [field]: USERNAME_MESSAGES[reason] });

/**
 * Checks a name for an account (format, reserved, free) and returns the stored form. Throws 400 / 409.
 * Call inside the transaction that saves it, after `lockUsername`, so two people cannot take the same name.
 */
export async function assertUsernameFree(db: Executor, raw: string, except: { accountId?: string | null } = {}): Promise<string> {
  const shape = usernameShape(raw);
  if (!shape.ok) throw usernameRefused(shape.reason);
  if (await usernameTaken(db, shape.value, except)) throw usernameConflict();
  return shape.value;
}

/** Availability checks per IP address and minute (they reveal which names exist; acceptable for usernames). */
const CHECK_WINDOW_MS = 60 * 1000;
const checks = new Map<string, { start: number; n: number }>();
export function usernameCheckLimit(): number {
  const n = Number(process.env.USERNAME_CHECK_IP_LIMIT ?? 60);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}
export function countUsernameCheck(ip: string | undefined) {
  const now = Date.now();
  const key = ip ?? 'unknown';
  const row = checks.get(key);
  if (!row || now - row.start >= CHECK_WINDOW_MS) {
    if (checks.size > 50_000) checks.clear();
    checks.set(key, { start: now, n: 1 });
    return;
  }
  row.n += 1;
  if (row.n > usernameCheckLimit()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.start + CHECK_WINDOW_MS - now) / 1000));
    throw new HttpException({ statusCode: 429, message: `Too many username checks. Wait ${retryAfterSeconds} s.`, retryAfterSeconds }, 429);
  }
}
/** Tests only. */
export const resetUsernameChecks = () => checks.clear();
