/** Small formatters every Tasks screen shares (same wording as the old Tasks web app). */

/** 45 → "45m", 90 → "1h 30m", 120 → "2h". Empty / 0 → null. */
export function fmtEffort(min: number | null | undefined): string | null {
  if (!min) return null;
  if (min < 60) return `${min}m`;
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** "6 hours from now" / "2 days overdue". */
export function relDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const hours = Math.round(abs / 60);
  const days = Math.round(abs / (60 * 24));
  const span = abs < 60 ? `${abs} min` : abs < 60 * 24 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`;
  return diffMin >= 0 ? `${span} from now` : `${span} overdue`;
}

/** "8 Oct, 05:30 pm" (no year): the short date-time used on task rows. */
export function fmtDT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Now, as a datetime-local value: the earliest deadline a form accepts (a past time is nearly always an AM/PM slip). */
export function nowForInput(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** An ISO instant as a datetime-local value (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Minutes from a number typed in minutes or hours. Empty → null. */
export function toMinutes(value: string, unit: 'minutes' | 'hours'): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (unit === 'hours' ? 60 : 1));
}

/** "40%" share, or "—" when there is nothing to divide by. */
export function pct(n: number, of: number | null | undefined): string {
  return of ? `${Math.round((100 * n) / of)}%` : '—';
}
