/**
 * Punch-in reminder (founder 2026-10-22, PLAN.md §19.32): in the phone app only, each person sets a time and days; the
 * phone schedules local notifications that ring and/or vibrate even when the app is closed (apps/mobile
 * src/lib/reminders.ts). After a check-in in the app, the rest of today's reminders are cancelled (punch.tsx). Settings
 * stay on the phone (per person per phone); nothing is sent to the server.
 *
 * Shown on Attendance → Today and on /attendance/reminder (account menu → Punch-in reminder). In a normal browser the
 * card shows nothing on Today and a short note on its own page; in an app from before reminders, a note to update.
 *
 * Company rule (PLAN.md §19.39): the server reminds people who have not punched in (in-app, WhatsApp if set up) at the
 * reporting time + 30, + 60, + 90 min. The phone's own reminder starts from the same rule (time = reporting + first
 * delay, again every gap, count in all; the person switches it on, as before). Apps 1.2.0/1.2.1 ring the first reminder
 * and one follow-up only. On leave / a holiday / the weekly off, punch.tsx skips today on the phone.
 */
import { type PunchReminderRule, useAttendanceToday, useHrConfig } from '@freefounders/core/hr';
import { useEffect, useState } from 'react';
import { AlarmClock, Bell, BellOff, Smartphone } from '@/components/icons';
import { Segmented } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/primitives';
import {
  AppRequestError,
  type ReminderMode,
  type ReminderSettings,
  type ReminderState,
  appCan,
  appRequest,
  isInApp,
  openAppSettings,
} from '@/lib/native-bridge';
import { cn } from '@/lib/utils';
import { ErrorNote, OkNote } from '../tasks/general/parts';

const DAYS: Array<[number, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];
const MODES: Array<[ReminderMode, string]> = [
  ['vibrate', 'Vibrate'],
  ['ring', 'Ring'],
  ['ring-vibrate', 'Ring + vibrate'],
];

/** "09:30" minus 10 minutes → "09:20" (wraps at midnight). */
export function minutesBefore(hhmm: string | undefined, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return '09:20';
  const t = (((Number(m[1]) * 60 + Number(m[2]) - minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "09:30" plus 30 minutes → "10:00" (wraps at midnight). */
export const minutesAfter = (hhmm: string | undefined, minutes: number) => minutesBefore(hhmm, -minutes);

/** The phone reminder for the company's rule (PLAN.md §19.39): reporting + first delay, then every gap, `count` in all. */
export function reminderFromRule(rule: PunchReminderRule, weekOffs: number[] | undefined, enabled = false): ReminderSettings {
  return {
    enabled,
    time: minutesAfter(rule.reporting_time, rule.first_after_minutes),
    days: workingDays(weekOffs),
    mode: 'ring-vibrate',
    followUpMinutes: rule.count > 1 ? rule.gap_minutes : 0,
    count: rule.count,
  };
}

/** The company's working days as ISO weekdays (HR week-offs are Python weekdays: 0 = Monday). */
export function workingDays(weekOffs: number[] | undefined): number[] {
  const off = new Set((weekOffs ?? [6]).map((d) => d + 1));
  const days = DAYS.map(([d]) => d).filter((d) => !off.has(d));
  return days.length ? days : [1, 2, 3, 4, 5, 6];
}

const fmtNext = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Where the reminder lives: the card on Today (`compact`) or the full page. */
export function PunchReminderCard({ page = false }: { page?: boolean }) {
  const inApp = isInApp();
  if (!inApp) {
    return page ? (
      <Note>
        <Smartphone className="size-4 shrink-0" /> Punch-in reminders work in the Kaampilot phone app: open this page there to set one.
      </Note>
    ) : null;
  }
  if (!appCan('reminders')) {
    return (
      <Note>
        <Smartphone className="size-4 shrink-0" /> Punch-in reminders need the latest Kaampilot app. Update the app to set one.
      </Note>
    );
  }
  return <ReminderForm />;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="flex max-w-2xl items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function ReminderForm() {
  const today = useAttendanceToday();
  const cfg = useHrConfig();
  const [state, setState] = useState<ReminderState | null>(null);
  const [form, setForm] = useState<ReminderSettings | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [err, setErr] = useState<{ message: string; settings: boolean } | null>(null);
  const [msg, setMsg] = useState('');

  // The company's reminder rule when it has one (PLAN.md §19.39), else 10 min before office start + one follow-up.
  const rule = today.data?.punch_reminders ?? cfg.data?.punch_reminders;
  const defaults: ReminderSettings = rule?.enabled
    ? reminderFromRule(rule, cfg.data?.week_offs)
    : { enabled: false, time: minutesBefore(today.data?.work_start, 10), days: workingDays(cfg.data?.week_offs), mode: 'ring-vibrate', followUpMinutes: 10, count: 2 };
  const gap = rule?.enabled && rule.count > 1 ? rule.gap_minutes : 10;
  const ruleCount = rule?.enabled && rule.count > 1 ? rule.count : 2;
  // Apps before 1.2.2 ring the first reminder and one follow-up only.
  const allCount = appCan('reminder-count');

  useEffect(() => {
    let live = true;
    appRequest<ReminderState>('reminder-get')
      .then((s) => live && setState(s))
      .catch((e) => live && setErr({ message: e instanceof Error ? e.message : 'The app could not read the reminder.', settings: false }));
    return () => {
      live = false;
    };
  }, []);

  // The form starts from what is on the phone, else from the company's office start and working days.
  const loaded = !!state && (!!state.settings || (!!today.data && !!cfg.data) || !!today.error || !!cfg.error);
  useEffect(() => {
    if (loaded && !form) setForm(state?.settings ?? defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const fail = (e: unknown) => {
    setMsg('');
    if (e instanceof AppRequestError && e.blocked?.permission === 'notifications') setErr({ message: e.message, settings: e.blocked.settings });
    else setErr({ message: e instanceof Error ? e.message : 'Something went wrong. Try again.', settings: false });
  };

  const save = async (next: ReminderSettings) => {
    setErr(null);
    setMsg('');
    setBusy('save');
    try {
      let s = next.enabled ? await appRequest<ReminderState>('reminder-set', { settings: next }) : await appRequest<ReminderState>('reminder-off');
      // Already checked in today: the new reminder starts tomorrow.
      if (next.enabled && today.data?.attendance?.check_in) s = await appRequest<ReminderState>('reminder-skip-today');
      setState(s);
      setForm(s.settings ?? next);
      setMsg(next.enabled ? 'Reminder saved on this phone.' : 'Reminder switched off.');
    } catch (e) {
      fail(e);
      if (next.enabled && !state?.settings?.enabled) setForm({ ...next, enabled: false });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    if (!form) return;
    setErr(null);
    setMsg('');
    setBusy('test');
    try {
      await appRequest('reminder-test', { mode: form.mode });
      setMsg('A test reminder comes in 5 seconds. Lock the phone to see how it looks.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  if (!form) {
    return (
      <section aria-label="Punch-in reminder" className="max-w-2xl rounded-xl border bg-card p-4 shadow-card">
        {err ? <ErrorNote>{err.message}</ErrorNote> : <Skeleton className="h-24" />}
      </section>
    );
  }

  const on = form.enabled;
  const repeats = form.followUpMinutes > 0 ? Math.max(2, form.count ?? 2) : 1;
  const saved = state?.settings;
  const dirty = !saved || JSON.stringify({ ...saved, enabled: true }) !== JSON.stringify({ ...form, enabled: true });
  const toggleDay = (d: number) => setForm({ ...form, days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort((a, b) => a - b) });

  return (
    <section aria-labelledby="reminder-title" className="max-w-2xl rounded-xl border bg-card shadow-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="reminder-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-md bg-app-attendance/10 text-app-attendance">
              <AlarmClock className="size-4" />
            </span>
            Punch-in reminder
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {on && saved?.enabled && state?.skipped
              ? 'You have checked in today: the next reminder is tomorrow.'
              : on && saved?.enabled && state?.next
                ? `Next reminder: ${fmtNext(state.next)}`
                : 'Your phone rings or vibrates if you have not punched in, even when the app is closed.'}
          </p>
        </div>
        <Switch
          aria-label="Punch-in reminder"
          checked={on}
          disabled={!!busy}
          onCheckedChange={(c) => {
            const next = { ...form, enabled: c };
            setForm(next);
            void save(next);
          }}
        />
      </div>

      {on && (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="grid gap-1.5">
            <Label htmlFor="reminder-time">Remind me at</Label>
            <Input id="reminder-time" type="time" className="w-36" value={form.time} onChange={(e) => e.target.value && setForm({ ...form, time: e.target.value })} />
            {today.data?.work_start && <p className="text-xs text-muted-foreground">Office starts at {today.data.work_start}.</p>}
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">On these days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([d, label]) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={form.days.includes(d)}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    'inline-flex h-9 min-w-12 cursor-pointer items-center justify-center rounded-md border px-2.5 text-sm font-medium transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    form.days.includes(d) ? 'border-primary/40 bg-primary/8 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id="reminder-mode">
              Alert
            </span>
            <Segmented label="Alert" value={form.mode} onChange={(mode) => setForm({ ...form, mode })} options={MODES} wrap />
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              {form.followUpMinutes > 0
                ? `Remind me again every ${form.followUpMinutes} min until I punch in (${repeats} reminders in all)`
                : `Remind me again every ${gap} min until I punch in`}
            </span>
            <Switch
              aria-label="Remind me again until I punch in"
              checked={form.followUpMinutes > 0}
              onCheckedChange={(c) => setForm({ ...form, followUpMinutes: c ? gap : 0, count: c ? ruleCount : 1 })}
            />
          </label>
          {repeats > 2 && !allCount && (
            <p role="note" className="text-xs text-muted-foreground">
              This app version rings the first 2 reminders. Update the Kaampilot app to get all {repeats}.
            </p>
          )}

          {err && (
            <div className="space-y-2">
              <ErrorNote>{err.message}</ErrorNote>
              {err.settings && (
                <Button variant="outline" onClick={() => void openAppSettings()}>
                  <Bell className="size-4" /> Open settings
                </Button>
              )}
            </div>
          )}
          <OkNote>{msg}</OkNote>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save(form)} disabled={!!busy || form.days.length === 0 || (!dirty && !!saved?.enabled)} loading={busy === 'save'}>
              Save reminder
            </Button>
            <Button variant="outline" onClick={() => void test()} disabled={!!busy} loading={busy === 'test'}>
              <Bell className="size-4" /> Send a test reminder now
            </Button>
          </div>
          {form.days.length === 0 && <p className="text-xs text-destructive">Choose at least one day.</p>}
          <p className="text-xs text-muted-foreground">
            Saved on this phone only. Android may ring a few minutes late in battery saver; for exact timing allow Settings → Apps →
            Kaampilot → Alarms &amp; reminders. Don&rsquo;t force-stop the app, or reminders stop until you open it again.
          </p>
        </div>
      )}
      {!on && (err || msg) && (
        <div className="space-y-2 px-4 py-3 sm:px-5">
          {err && <ErrorNote>{err.message}</ErrorNote>}
          {err?.settings && (
            <Button variant="outline" onClick={() => void openAppSettings()}>
              <BellOff className="size-4" /> Open settings
            </Button>
          )}
          <OkNote>{msg}</OkNote>
        </div>
      )}
    </section>
  );
}

/** /attendance/reminder: the reminder on its own page (account menu → Punch-in reminder). */
export function ReminderPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Punch-in reminder</h1>
        <p className="mt-1 text-sm text-muted-foreground">A reminder on this phone when it is time to punch in.</p>
      </div>
      <PunchReminderCard page />
    </div>
  );
}
