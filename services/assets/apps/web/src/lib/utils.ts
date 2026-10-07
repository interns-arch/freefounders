import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  // Plain dates are local calendar days, not UTC instants.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function formatMoney(v: number | null | undefined, currency = 'INR', compact = false): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(v);
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(v);
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function relativeTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const diff = (toDate(v).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(v);
}

/** Whole days from today until the date (negative when in the past). */
export function daysUntil(v: string | null | undefined): number | null {
  if (!v) return null;
  const target = toDate(v);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

export function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/\(.*\)/, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${formatNumber(n)} ${n === 1 ? word : pluralWord}`;
}
