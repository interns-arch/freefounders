/** Dates and times for the screens, without Intl (same output on every phone). Pure: tested in test/format.test.ts. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monthName = (month: number) => MONTHS[month - 1] ?? '';
export const weekdayName = (d: Date) => DAYS[d.getDay()];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date → 'YYYY-MM-DD'. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' → a local Date at midnight (no time-zone shift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 'YYYY-MM-DD' → '12 Oct 2026'. */
export function fmtDay(day: string | null | undefined): string {
  if (!day) return '—';
  const d = parseDay(day);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** An ISO timestamp → '9:41 AM' in the phone's time zone. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return clock(d);
}

/** A Date → '9:41 AM' (or with seconds). */
export function clock(d: Date, seconds = false): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** Minutes → '7h 05m' (or '45m'). */
export function fmtMinutes(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** Minutes worked so far: stored minutes once checked out, else from check-in until `now`. */
export function workedMinutes(rec: { check_in: string | null; check_out: string | null; working_minutes: number } | null | undefined, now = new Date()): number {
  if (!rec?.check_in) return 0;
  if (rec.check_out) return rec.working_minutes;
  return Math.max(0, Math.floor((now.getTime() - new Date(rec.check_in).getTime()) / 60_000));
}

/** 'Good morning' / 'Good afternoon' / 'Good evening'. */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * The cells of a month calendar, Monday first: null for the blanks before day 1, then 'YYYY-MM-DD' for each day,
 * padded with nulls to whole weeks.
 */
export function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Whole days from today to `day` (negative = past). */
export function daysUntil(day: string, today = new Date()): number {
  const a = parseDay(isoDate(today)).getTime();
  return Math.round((parseDay(day).getTime() - a) / 86_400_000);
}
