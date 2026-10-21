import { ConflictException, HttpException } from '@nestjs/common';
import { and, ne, sql } from 'drizzle-orm';
import { badRequest } from '../common/http';
import type { Executor } from '../db/db.service';
import { companies } from '../db/schema';

/**
 * Company names are unique across the product (founder, 2026-10-21: a second sign-up made another "testcomp"). Compared
 * after trimming, collapsing inner spaces and lower-casing, so "Test  Comp" = "test comp". Checked in code under an
 * advisory lock per name (no unique index: deployed databases already hold duplicates, which stay as they are).
 */
export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 80;

export const companyNameTakenMessage = (name: string) => `A company called "${cleanCompanyName(name)}" already exists. If you work there, ask its owner for an invite link.`;
export const COMPANY_NAME_INVALID = `Use ${COMPANY_NAME_MIN}–${COMPANY_NAME_MAX} characters for the company name.`;

/** Trimmed, inner whitespace collapsed to one space (the stored form for new names). */
export const cleanCompanyName = (raw: string | null | undefined) => (raw ?? '').trim().replace(/\s+/g, ' ');
/** What is compared: cleaned and lower-cased. */
export const normaliseCompanyName = (raw: string | null | undefined) => cleanCompanyName(raw).toLowerCase();

/** The same normalisation in SQL, for the stored names (older rows may have extra spaces or another case). */
const storedNormalised = sql`lower(regexp_replace(btrim(${companies.name}), '\\s+', ' ', 'g'))`;

export function companyNameShape(raw: string | null | undefined): { ok: true; value: string } | { ok: false } {
  const value = cleanCompanyName(raw);
  return value.length >= COMPANY_NAME_MIN && value.length <= COMPANY_NAME_MAX ? { ok: true, value } : { ok: false };
}

/** Does another company (any status: there is no deleted state) already use this name? `exceptCompanyId`: a rename. */
export async function companyNameTaken(db: Executor, name: string, exceptCompanyId?: string | null): Promise<boolean> {
  const value = normaliseCompanyName(name);
  if (!value) return false;
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(sql`${storedNormalised} = ${value}`, exceptCompanyId ? ne(companies.id, exceptCompanyId) : undefined))
    .limit(1);
  return !!row;
}

/** Serialises everyone claiming the same name inside the current transaction (released at commit / rollback). */
export async function lockCompanyName(db: Executor, name: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'ff-company-name:' + normaliseCompanyName(name)}))`);
}

/** 409 on the company name field (the web shows it next to the field). */
export const companyNameConflict = (name: string) => {
  const message = companyNameTakenMessage(name);
  return new ConflictException({ statusCode: 409, message, field: 'companyName', errors: { companyName: message } });
};

/**
 * Checks a new name (shape, free) and returns the stored form. Throws 400 / 409. Call inside the transaction that saves
 * it: takes the lock first, so two sign-ups with the same name cannot both pass.
 */
export async function assertCompanyNameFree(db: Executor, raw: string, exceptCompanyId?: string | null): Promise<string> {
  const shape = companyNameShape(raw);
  if (!shape.ok) throw badRequest(COMPANY_NAME_INVALID, { companyName: COMPANY_NAME_INVALID });
  await lockCompanyName(db, shape.value);
  if (await companyNameTaken(db, shape.value, exceptCompanyId)) throw companyNameConflict(shape.value);
  return shape.value;
}

/** GET companies/name-available. */
export async function companyNameAvailability(db: Executor, raw: string, exceptCompanyId?: string | null) {
  const shape = companyNameShape(raw);
  if (!shape.ok) return { available: false, reason: 'invalid' as const, message: COMPANY_NAME_INVALID };
  if (await companyNameTaken(db, shape.value, exceptCompanyId)) return { available: false, reason: 'taken' as const, message: companyNameTakenMessage(shape.value) };
  return { available: true, message: 'Available' };
}

/** Availability checks per IP address and minute (they reveal which company names exist). */
const CHECK_WINDOW_MS = 60 * 1000;
const checks = new Map<string, { start: number; n: number }>();
function checkLimit(): number {
  const n = Number(process.env.COMPANY_NAME_CHECK_IP_LIMIT ?? 60);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}
export function countCompanyNameCheck(ip: string | undefined) {
  const now = Date.now();
  const key = ip ?? 'unknown';
  const row = checks.get(key);
  if (!row || now - row.start >= CHECK_WINDOW_MS) {
    if (checks.size > 50_000) checks.clear();
    checks.set(key, { start: now, n: 1 });
    return;
  }
  row.n += 1;
  if (row.n > checkLimit()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((row.start + CHECK_WINDOW_MS - now) / 1000));
    throw new HttpException({ statusCode: 429, message: `Too many company name checks. Wait ${retryAfterSeconds} s.`, retryAfterSeconds }, 429);
  }
}
/** Tests only. */
export const resetCompanyNameChecks = () => checks.clear();
