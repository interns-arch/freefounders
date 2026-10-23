/**
 * Punch-in reminder (PLAN.md §19.32): the settings a person chooses in the web app and the list of local notifications
 * the phone schedules for them. Pure functions only (no React Native), so the unit tests run them under plain Node; the
 * native side is src/lib/reminders.ts (expo-notifications).
 *
 * Days are ISO weekdays: 1 = Monday … 7 = Sunday. expo-notifications' weekly trigger counts 1 = Sunday … 7 = Saturday
 * (expoWeekday converts).
 *
 * Normally every reminder is a weekly repeating notification (one per chosen day, plus the follow-up), so it keeps
 * ringing every week even if the app is never opened again. "Skip today" (a check-in in the app) cannot cancel one
 * occurrence of a weekly notification, so the reminders that belong to the skipped day are planned as one-off
 * notifications for the next weeks instead; the next time the app opens after that day, the plan goes back to weekly.
 */

export const REMINDER_MODES = ['vibrate', 'ring', 'ring-vibrate'] as const;
export type ReminderMode = (typeof REMINDER_MODES)[number];

export interface ReminderSettings {
  enabled: boolean;
  /** "HH:MM", 24 h, phone's local time. */
  time: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday; sorted, no repeats. */
  days: number[];
  mode: ReminderMode;
  /** Remind again this many minutes later (0 = off). */
  followUpMinutes: number;
}

export const MAX_FOLLOW_UP = 120;
/** Weeks of one-off reminders planned for a skipped day (the plan is refreshed every time the app opens). */
export const SKIP_WEEKS = 4;

export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, time: '09:20', days: [1, 2, 3, 4, 5, 6], mode: 'ring-vibrate', followUpMinutes: 10 };

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = TIME.exec(t.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export const reminderMode = (v: unknown): ReminderMode => ((REMINDER_MODES as readonly unknown[]).includes(v) ? (v as ReminderMode) : 'ring-vibrate');

/** Settings sent by the web app (or read back from the phone's storage) → clean settings, or the reason they are not. */
export function parseReminderSettings(raw: unknown): { ok: true; settings: ReminderSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'No reminder settings.' };
  const m = raw as Record<string, unknown>;
  const time = typeof m.time === 'string' ? parseTime(m.time) : null;
  if (!time) return { ok: false, error: 'Choose a time for the reminder (HH:MM).' };
  const days = Array.isArray(m.days) ? [...new Set(m.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : [];
  const enabled = m.enabled !== false;
  if (enabled && days.length === 0) return { ok: false, error: 'Choose at least one day for the reminder.' };
  const f = typeof m.followUpMinutes === 'number' && Number.isFinite(m.followUpMinutes) ? Math.round(m.followUpMinutes) : m.followUpMinutes === undefined ? 10 : 0;
  return {
    ok: true,
    settings: {
      enabled,
      time: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
      days,
      mode: reminderMode(m.mode),
      followUpMinutes: Math.min(MAX_FOLLOW_UP, Math.max(0, f)),
    },
  };
}

/** The phone's local calendar date, "YYYY-MM-DD". */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
/** ISO weekday → expo-notifications' weekly `weekday` (1 = Sunday … 7 = Saturday). */
export const expoWeekday = (iso: number) => (iso % 7) + 1;

/** Which Android notification channel a reminder uses (a channel's sound / vibration cannot change once created). */
export const CHANNELS: Record<ReminderMode, { id: string; name: string; sound: boolean; vibrate: boolean }> = {
  'ring-vibrate': { id: 'punch-reminders', name: 'Punch-in reminders', sound: true, vibrate: true },
  ring: { id: 'punch-reminders-ring', name: 'Punch-in reminders (ring only)', sound: true, vibrate: false },
  vibrate: { id: 'punch-reminders-vibrate', name: 'Punch-in reminders (vibrate only)', sound: false, vibrate: true },
};
export const VIBRATION_PATTERN = [0, 600, 300, 600, 300, 900];

export type PlannedReminder =
  | { kind: 'weekly'; day: number; followUp: boolean; weekday: number; hour: number; minute: number }
  | { kind: 'date'; day: number; followUp: boolean; at: Date };

function atMinutes(date: Date, minutes: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes, 0, 0);
}
const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/**
 * The notifications to schedule for these settings at `now`. `skipDate` ("YYYY-MM-DD", set by "skip today") cancels
 * the reminders of that day: those whose day is the skipped day, and a follow-up that rings on the skipped day after
 * midnight for the day before. A skip whose reminders are all in the past changes nothing (weekly again).
 */
export function planReminders(s: ReminderSettings, now: Date, skipDate: string | null = null): PlannedReminder[] {
  const t = parseTime(s.time);
  if (!s.enabled || !t || s.days.length === 0) return [];
  const base = t.hour * 60 + t.minute;
  const slots = [{ followUp: false, minutes: base }, ...(s.followUpMinutes > 0 ? [{ followUp: true, minutes: base + s.followUpMinutes }] : [])];
  let skip: Date | null = null;
  if (skipDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(skipDate);
    if (m) skip = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const out: PlannedReminder[] = [];
  for (const day of s.days) {
    for (const slot of slots) {
      const shift = Math.floor(slot.minutes / 1440); // a follow-up after midnight rings the next day
      const inDay = slot.minutes % 1440;
      // The occurrence the skip cancels: the one of the skipped day, or the one ringing on it (for the day before).
      let source: Date | null = null;
      if (skip) {
        const candidates = [skip, ...(shift > 0 ? [addDays(skip, -shift)] : [])];
        source = candidates.find((c) => isoWeekday(c) === day && atMinutes(c, slot.minutes).getTime() > now.getTime()) ?? null;
      }
      if (source) {
        for (let k = 1; k <= SKIP_WEEKS; k++) out.push({ kind: 'date', day, followUp: slot.followUp, at: atMinutes(addDays(source, 7 * k), slot.minutes) });
      } else {
        const fireIso = ((day - 1 + shift) % 7) + 1;
        out.push({ kind: 'weekly', day, followUp: slot.followUp, weekday: expoWeekday(fireIso), hour: Math.floor(inDay / 60), minute: inDay % 60 });
      }
    }
  }
  return out;
}

/** When the next planned reminder rings after `now` (for "Next reminder: …" in the web app). */
export function nextReminder(plan: PlannedReminder[], now: Date): Date | null {
  let best: Date | null = null;
  for (const p of plan) {
    let at: Date;
    if (p.kind === 'date') at = p.at;
    else {
      const fireIso = p.weekday === 1 ? 7 : p.weekday - 1;
      let diff = (fireIso - isoWeekday(now) + 7) % 7;
      at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, p.hour, p.minute);
      if (at.getTime() <= now.getTime()) {
        diff += 7;
        at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, p.hour, p.minute);
      }
    }
    if (at.getTime() > now.getTime() && (!best || at < best)) best = at;
  }
  return best;
}
