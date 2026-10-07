import { z } from 'zod';

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'boolean',
  'select',
  'multiselect',
  'email',
  'phone',
  'url',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  boolean: 'Yes / No',
  select: 'Dropdown',
  multiselect: 'Multi-select',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
};

/** Field types that use a list of options. */
export const OPTION_FIELD_TYPES: readonly FieldType[] = ['select', 'multiselect'];
/** Field types where min / max apply to the numeric value (otherwise to text length). */
export const NUMERIC_FIELD_TYPES: readonly FieldType[] = ['number', 'currency'];

/** The part of a field definition needed to validate and render values. */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  isUnique?: boolean;
  options?: string[] | null;
  min?: number | null;
  max?: number | null;
  placeholder?: string | null;
  helpText?: string | null;
}

export type AttributeValue = string | number | boolean | string[] | null;
export type Attributes = Record<string, AttributeValue>;

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[+()\-.\s\d]{5,20}$/;

/** "Engine No." → "engine_no" */
export function slugifyKey(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!key) return 'field';
  return /^[a-z]/.test(key) ? key : `f_${key}`.slice(0, 50);
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

function isValidDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function valueSchema(f: FieldDef): z.ZodTypeAny {
  const label = f.label;
  const hasMin = f.min !== null && f.min !== undefined;
  const hasMax = f.max !== null && f.max !== undefined;
  switch (f.type) {
    case 'number':
    case 'currency': {
      let s = z.number({ message: `${label} must be a number` }).finite({ message: `${label} must be a number` });
      if (hasMin) s = s.min(f.min as number, { message: `${label} must be at least ${f.min}` });
      if (hasMax) s = s.max(f.max as number, { message: `${label} must be at most ${f.max}` });
      return z.preprocess((v) => (typeof v === 'string' ? Number(v.trim().replace(/,/g, '')) : v), s);
    }
    case 'boolean':
      return z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean({ message: `${label} must be yes or no` }));
    case 'date':
      return z
        .string({ message: `${label} must be a date` })
        .refine(isValidDate, { message: `${label} must be a valid date (YYYY-MM-DD)` });
    case 'select': {
      const opts = (f.options ?? []).filter(Boolean);
      const s = z.string({ message: `${label} is invalid` }).trim();
      return opts.length ? s.refine((v) => opts.includes(v), { message: `${label} must be one of: ${opts.join(', ')}` }) : s;
    }
    case 'multiselect': {
      const opts = (f.options ?? []).filter(Boolean);
      const item = opts.length
        ? z.string().refine((v) => opts.includes(v), { message: `${label} has an invalid option` })
        : z.string();
      return z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(item, { message: `${label} is invalid` }));
    }
    case 'email':
      return z.string().trim().email({ message: `${label} must be a valid email` });
    case 'url':
      return z.string().trim().url({ message: `${label} must be a valid URL` });
    case 'phone':
      return z.string().trim().regex(PHONE_RE, { message: `${label} must be a valid phone number` });
    case 'textarea':
    case 'text':
    default: {
      let s = z.string({ message: `${label} must be text` }).trim();
      s = s.max(hasMax ? (f.max as number) : f.type === 'textarea' ? 5000 : 500, {
        message: `${label} is too long`,
      });
      if (hasMin) s = s.min(f.min as number, { message: `${label} must be at least ${f.min} characters` });
      return s;
    }
  }
}

/**
 * Builds a zod schema for the custom attributes of an asset type from its field definitions.
 * The same builder runs in the browser (forms) and in the API (every write), so the rules
 * can never drift apart. Empty values are dropped; unknown keys are stripped.
 */
export function buildAttributesSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const inner = valueSchema(f);
    if (f.required && f.type !== 'boolean') {
      shape[f.key] = z.preprocess(
        (v) => (isEmpty(v) ? undefined : v),
        z.any().refine((v) => v !== undefined, { message: `${f.label} is required` }).pipe(inner),
      );
    } else {
      shape[f.key] = z.preprocess((v) => (isEmpty(v) ? undefined : v), inner.optional());
    }
  }
  return z.object(shape);
}

export type AttributeErrors = Record<string, string>;

/** Validates attributes and returns either clean values or per-field error messages. */
export function validateAttributes(
  fields: FieldDef[],
  input: unknown,
): { ok: true; value: Attributes } | { ok: false; errors: AttributeErrors } {
  const result = buildAttributesSchema(fields).safeParse(input ?? {});
  if (result.success) {
    const value: Attributes = {};
    for (const [k, v] of Object.entries(result.data as Record<string, unknown>)) {
      if (v !== undefined) value[k] = v as AttributeValue;
    }
    return { ok: true, value };
  }
  const errors: AttributeErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

/** Human-readable value for tables and detail pages. */
export function formatAttributeValue(field: Pick<FieldDef, 'type'>, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'currency':
      return typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-IN') : String(value);
    default:
      return String(value);
  }
}
