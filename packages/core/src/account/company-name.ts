/**
 * Company names are unique across the product (PLAN.md §21.6), the parts without React: the same normalisation and
 * length rule as the Platform (services/platform/src/company/company-name.ts; the server always decides).
 */

export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 80;
export const COMPANY_NAME_INVALID = `Use ${COMPANY_NAME_MIN}–${COMPANY_NAME_MAX} characters for the company name.`;

/** GET companies/name-available. */
export interface CompanyNameAvailability {
  available: boolean;
  reason?: 'taken' | 'invalid';
  message: string;
}

/** Trimmed, inner whitespace collapsed (what is stored). */
export const cleanCompanyName = (raw: string) => raw.trim().replace(/\s+/g, ' ');
/** What is compared: cleaned and lower-cased. */
export const normaliseCompanyName = (raw: string) => cleanCompanyName(raw).toLowerCase();

/** 'invalid' when the length is wrong (no server call needed), else null. */
export function companyNameShapeProblem(raw: string): 'invalid' | null {
  const n = cleanCompanyName(raw).length;
  return n >= COMPANY_NAME_MIN && n <= COMPANY_NAME_MAX ? null : 'invalid';
}

/** The server's answer about the company name (409 taken at submit, 400 length), shown on the Company name field. */
export function companyNameErrorOf(err: unknown): string | null {
  const e = err as { status?: number; errors?: Record<string, string> } | null;
  return e && (e.status === 409 || e.status === 400) && e.errors?.companyName ? e.errors.companyName : null;
}
