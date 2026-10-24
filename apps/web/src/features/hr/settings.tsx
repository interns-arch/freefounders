/** HR → HR Settings (hr.manage): attendance rules (PLAN.md §16.1/§16.4/§17.2), office locations, leave types. Punch = location + selfie, no face check (§19.18). */
import { ApiError, errorMessage } from '@freefounders/core';
import {
  type HrSettingValues,
  REGULARIZATION_PERIOD_WORDS,
  REGULARIZATION_REASONS,
  type RegularizationPeriod,
  type RegularizationReason,
  UNIFORM_MESSAGE_DEFAULT,
  useAddLeaveType,
  useAddOffice,
  useDeleteOffice,
  useHrSettings,
  useLeaveTypes,
  useOfficeLocations,
  useRegularizablePeople,
  useSaveHrSettings,
} from '@freefounders/core/hr';
import { AlarmClock, CalendarHeart, ClipboardCheck, LocateFixed, MapPin, Settings2, Shirt, X } from '@/components/icons';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, Panel } from '../tasks/general/parts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PHOTO_LABELS: Record<string, string> = { off: 'Off', optional: 'Optional', required: 'Required at every punch' };

export function HrSettingsTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <AttendanceRules />
      <UniformCheck />
      <RegularizationPolicy />
      <PunchReminders />
      <Offices />
      <LeaveTypes />
    </div>
  );
}

type Form = { [K in keyof HrSettingValues]: HrSettingValues[K] | string };
const UNIFORM_KEYS: string[] = ['uniform_check', 'uniform_message'];
/** Punch-in reminders have their own card and save (PLAN.md §19.39). */
const PUNCH_KEYS: string[] = ['punch_reminders', 'punch_reminder_count', 'punch_reminder_gap', 'punch_reminder_first'];
/** The regularization policy has its own card and save too (PLAN.md §19.38). */
const REG_KEYS: string[] = ['reg_enabled', 'reg_reasons', 'reg_monthly_limit', 'reg_limit_period', 'reg_days_back', 'reg_person_limits', 'reg_mark'];

/** Working hours and attendance rules, saved for this company. */
function AttendanceRules() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (q.data && !form) setForm(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, v.value])) as Form);
  }, [q.data, form]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data || !form) return <Skeleton className="h-80" />;
  const s = q.data;
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const fe = (k: string) => fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const week = (form.week_offs as number[]) ?? [];
  const toggleDay = (d: number) => setForm({ ...form, week_offs: week.includes(d) ? week.filter((x) => x !== d) : [...week, d] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    // The uniform check and the regularization policy have their own cards and saves (below); never resend them from here.
    const rules = Object.fromEntries(Object.entries(form).filter(([k]) => !UNIFORM_KEYS.includes(k) && !REG_KEYS.includes(k) && !PUNCH_KEYS.includes(k)));
    save.mutate(rules, {
      onSuccess: (d) => {
        setMsg('Saved');
        setForm(Object.fromEntries(Object.entries(d ?? s).map(([k, v]) => [k, v.value])) as Form);
      },
    });
  };

  const num = (id: string, k: keyof Form, label: string, props: React.ComponentProps<'input'>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={String(form[k] ?? '')} onChange={set(k)} {...props} />
      {fe(k)}
    </div>
  );

  return (
    <form onSubmit={submit} aria-label="Attendance rules">
      <Panel icon={Settings2} title="Attendance rules" description="Working hours, grace time and what a punch needs. Saved for this company.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="hr-start">Work starts</Label>
            <Input id="hr-start" type="time" value={String(form.work_start)} onChange={set('work_start')} />
            {fe('work_start')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hr-end">Work ends</Label>
            <Input id="hr-end" type="time" value={String(form.work_end)} onChange={set('work_end')} />
            {fe('work_end')}
          </div>
          {num('hr-grace', 'grace_minutes', 'Late after (minutes of grace)', { min: 0, max: 240 })}
          {num('hr-half', 'half_day_hours', 'Half day below (hours)', { min: 0.5, max: 24, step: 0.5 })}
          {num('hr-full', 'full_day_hours', 'Full day (hours)', { min: 1, max: 24, step: 0.5 })}
          <div className="grid gap-1.5">
            <Label htmlFor="hr-photo">Photo at check-in / check-out</Label>
            <NativeSelect id="hr-photo" value={String(form.photo)} onChange={set('photo')}>
              {(s.photo.choices ?? ['off', 'optional', 'required']).map((c) => (
                <option key={c} value={c}>
                  {PHOTO_LABELS[c] ?? c}
                </option>
              ))}
            </NativeSelect>
            {fe('photo')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hr-approval">Leave and corrections are approved by</Label>
            <NativeSelect id="hr-approval" value={String(form.leave_approval)} onChange={set('leave_approval')}>
              <option value="department">Approvers in the person’s department</option>
              <option value="manager">The person’s manager (reports to) first</option>
            </NativeSelect>
            {fe('leave_approval')}
          </div>
          {num('hr-remind', 'approval_remind_hours', 'Remind approvers after (hours; 0 = never)', { min: 0, max: 720 })}
          {num('hr-keep', 'photo_retention_days', 'Keep photos for (days)', { min: 1, max: 3650 })}
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[13px] font-medium">Weekly off</legend>
          <div role="group" aria-label="Weekly off days" className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-accent', week.includes(i) && 'border-primary/40 bg-primary/8 font-semibold text-primary')}>
                <Checkbox checked={week.includes(i)} onCheckedChange={() => toggleDay(i)} aria-label={d} /> {d}
              </label>
            ))}
          </div>
          {fe('week_offs')}
        </fieldset>
        <div className="mt-4 grid gap-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={!!form.geofence_enabled} onCheckedChange={(c) => setForm({ ...form, geofence_enabled: c === true })} /> Check location at check-in (needs an office below)
          </label>
        </div>
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote className="mt-3">{errorMessage(save.error)}</ErrorNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
          {msg && (
            <span className="text-sm text-success" role="status">
              {msg}
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

/** "3 times a month" / "unlimited": what a limit means, for the helper texts. */
function limitWords(limit: string | number, period: RegularizationPeriod): string {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 'unlimited';
  return `${n} time${n === 1 ? '' : 's'} ${REGULARIZATION_PERIOD_WORDS[period].a}`;
}

type PersonLimit = { user: number; name: string; limit: string };
type RegForm = {
  enabled: boolean;
  reasons: RegularizationReason[];
  limit: string;
  period: RegularizationPeriod;
  back: string;
  mark: 'times' | 'present';
  people: PersonLimit[];
};

/**
 * Attendance regularization (PLAN.md §19.38 + addendum 2026-10-24): on/off, the reasons people may pick, the limit (any
 * number, 0 = unlimited) per month / week / year, how far back (any number), a different limit for some people and what
 * an approved day counts as. Every request goes to the reporting manager (else HR) and needs approval. Its own save.
 */
function RegularizationPolicy() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [f, setF] = useState<RegForm | null>(null);
  const [msg, setMsg] = useState('');
  const hasOwnLimits = !!q.data?.reg_person_limits;
  const people = useRegularizablePeople(!!f && hasOwnLimits, true);
  const [pick, setPick] = useState('');
  useEffect(() => {
    const d = q.data;
    if (d?.reg_enabled && !f) {
      setF({
        enabled: d.reg_enabled.value,
        reasons: d.reg_reasons.value,
        limit: String(d.reg_monthly_limit.value),
        period: d.reg_limit_period?.value ?? 'month',
        back: String(d.reg_days_back.value),
        mark: d.reg_mark.value,
        people: (d.reg_person_limits?.value ?? []).map((p) => ({ ...p, limit: String(p.limit) })),
      });
    }
  }, [q.data, f]);
  if (!q.data || !f) return q.error || (q.data && !q.data.reg_enabled) ? null : <Skeleton className="h-60" />;
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const fe = (k: string) => fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;
  const toggle = (list: RegularizationReason[], v: RegularizationReason) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    save.mutate(
      {
        reg_enabled: f.enabled,
        reg_reasons: f.reasons,
        reg_monthly_limit: f.limit,
        reg_limit_period: f.period,
        reg_days_back: f.back,
        reg_mark: f.mark,
        ...(hasOwnLimits ? { reg_person_limits: f.people.map((p) => ({ user: p.user, limit: Number(p.limit) || 0 })) } : {}),
      },
      { onSuccess: () => setMsg('Saved') },
    );
  };
  const back = Number(f.back);
  const backText = !Number.isFinite(back) || back <= 0 ? 'only today, after the shift ends' : `up to ${back} day${back === 1 ? '' : 's'} back`;
  const choices = (people.data ?? []).filter((p) => !f.people.some((x) => x.user === p.id));
  const addPerson = () => {
    const p = people.data?.find((x) => String(x.id) === pick);
    if (!p) return;
    setF({ ...f, people: [...f.people, { user: p.id, name: p.name, limit: f.limit }] });
    setPick('');
  };
  const setPersonLimit = (user: number, limit: string) => setF({ ...f, people: f.people.map((p) => (p.user === user ? { ...p, limit } : p)) });
  return (
    <form onSubmit={submit} aria-label="Regularization">
      <Panel icon={ClipboardCheck} title="Regularization" description="People ask to fix a past day (a missed punch, on duty, work from home). Every request goes to the person’s reporting manager (without one, to HR / people who approve attendance) and needs approval; on approval the day is corrected and worked out again with the rules above. HR and managers can also regularize a day for someone directly (Approvals, Daily, My team): applied at once and not counted in the person’s limit.">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.enabled} onCheckedChange={(c) => setF({ ...f, enabled: c === true })} /> People can request regularization
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="reg-limit">Requests per person (0 = unlimited)</Label>
            <Input id="reg-limit" type="number" min={0} step={1} inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
            {fe('reg_monthly_limit')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reg-period">Counted per</Label>
            <NativeSelect id="reg-period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as RegularizationPeriod })}>
              <option value="month">Month</option>
              <option value="week">Week (Monday–Sunday)</option>
              <option value="year">Year</option>
            </NativeSelect>
            {fe('reg_limit_period')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reg-back">How many days back (0 = today only)</Label>
            <Input id="reg-back" type="number" min={0} step={1} inputMode="numeric" value={f.back} onChange={(e) => setF({ ...f, back: e.target.value })} />
            {fe('reg_days_back')}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite" data-testid="reg-effect">
          Each person can ask {limitWords(f.limit, f.period)}, {backText}. Unlimited = 0.
        </p>
        {hasOwnLimits && (
          <fieldset className="mt-4">
            <legend className="mb-1 text-[13px] font-medium">Different limit for some people</legend>
            <p className="mb-2 text-xs text-muted-foreground">Their own number replaces the company’s ({limitWords(f.limit, f.period)}); 0 = unlimited.</p>
            {f.people.length > 0 && (
              <ul className="mb-2 divide-y rounded-md border" aria-label="People with their own limit">
                {f.people.map((p) => (
                  <li key={p.user} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      className="w-24"
                      aria-label={`Limit for ${p.name}`}
                      value={p.limit}
                      onChange={(e) => setPersonLimit(p.user, e.target.value)}
                    />
                    <span className="w-32 text-xs text-muted-foreground">{limitWords(p.limit, f.period)}</span>
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => setF({ ...f, people: f.people.filter((x) => x.user !== p.user) })}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-48 flex-1 gap-1.5">
                <Label htmlFor="reg-person">Person</Label>
                <NativeSelect id="reg-person" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{people.isLoading ? 'Loading…' : 'Pick a person'}</option>
                  {choices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.department ? ` · ${p.department}` : ''}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="button" variant="outline" disabled={!pick} onClick={addPerson}>
                Add person
              </Button>
            </div>
            {fe('reg_person_limits')}
          </fieldset>
        )}
        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="reg-mark">An approved day counts as</Label>
            <NativeSelect id="reg-mark" value={f.mark} onChange={(e) => setF({ ...f, mark: e.target.value as 'times' | 'present' })}>
              <option value="times">Worked out from the times (Present, Late or Half day)</option>
              <option value="present">Always Present</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">On duty and Work from home days are tagged “On duty” / “WFH” and count as present days.</p>
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[13px] font-medium">Reasons people can pick</legend>
          <div role="group" aria-label="Allowed reasons" className="grid gap-1.5 sm:grid-cols-2">
            {REGULARIZATION_REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.reasons.includes(r.value)} onCheckedChange={() => setF({ ...f, reasons: toggle(f.reasons, r.value) })} aria-label={r.label} /> {r.label}
              </label>
            ))}
          </div>
          {fe('reg_reasons')}
        </fieldset>
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote className="mt-3">{errorMessage(save.error)}</ErrorNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            Save regularization
          </Button>
          {msg && (
            <span className="text-sm text-success" role="status">
              {msg}
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

/** "09:30" + 30 → "10:00". */
function plus(hhmm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return '';
  const t = (((Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Punch-in reminders (PLAN.md §19.39): people who have not punched in by the reporting time (work start) are reminded
 * `count` times, `gap` minutes apart, the first `first` minutes after it (in the app, WhatsApp when set up, and the phone
 * app's own reminder). Nobody on leave, a holiday or the weekly off. Its own save.
 */
function PunchReminders() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [f, setF] = useState<{ on: boolean; count: string; gap: string; first: string } | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const d = q.data;
    if (d?.punch_reminders && !f) {
      setF({ on: d.punch_reminders.value, count: String(d.punch_reminder_count.value), gap: String(d.punch_reminder_gap.value), first: String(d.punch_reminder_first.value) });
    }
  }, [q.data, f]);
  if (!q.data || !f) return q.error || (q.data && !q.data.punch_reminders) ? null : <Skeleton className="h-48" />;
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const fe = (k: string) => fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;
  const start = q.data.work_start.value;
  const n = Math.max(1, Math.min(10, Number(f.count) || 1));
  const times = Array.from({ length: n }, (_, i) => plus(start, (Number(f.first) || 0) + i * (Number(f.gap) || 0))).filter(Boolean);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    save.mutate({ punch_reminders: f.on, punch_reminder_count: f.count, punch_reminder_gap: f.gap, punch_reminder_first: f.first }, { onSuccess: () => setMsg('Saved') });
  };
  return (
    <form onSubmit={submit} aria-label="Punch-in reminders">
      <Panel icon={AlarmClock} title="Punch-in reminders" description="People who have not punched in by the reporting time (work starts) get a reminder in the app, on WhatsApp when it is set up, and on the phone app. Nobody on leave, a holiday or the weekly off; it stops once they punch in.">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.on} onCheckedChange={(c) => setF({ ...f, on: c === true })} /> Remind people who have not punched in
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pr-count">Number of reminders</Label>
            <Input id="pr-count" type="number" min={1} max={10} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
            {fe('punch_reminder_count')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pr-gap">Minutes between reminders</Label>
            <Input id="pr-gap" type="number" min={5} max={240} value={f.gap} onChange={(e) => setF({ ...f, gap: e.target.value })} />
            {fe('punch_reminder_gap')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pr-first">First reminder after reporting time (min)</Label>
            <Input id="pr-first" type="number" min={0} max={240} value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
            {fe('punch_reminder_first')}
          </div>
        </div>
        {f.on && times.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Reporting time {start}: reminders at {times.join(', ')}.
          </p>
        )}
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote className="mt-3">{errorMessage(save.error)}</ErrorNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            Save reminders
          </Button>
          {msg && (
            <span className="text-sm text-success" role="status">
              {msg}
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

/** PLAN.md §19.36: the names say what the person's answer does. */
const UNIFORM_MODES: { value: HrSettingValues['uniform_check']; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No question' },
  { value: 'remind', label: 'Reminder only', hint: 'OK, punch in' },
  { value: 'ask', label: 'Must confirm', hint: 'Yes punches in, No blocks' },
];

/** Uniform at punch-in (PLAN.md §19.27): a reminder, or a Yes / No question saved with the attendance. Its own save. */
function UniformCheck() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [mode, setMode] = useState<HrSettingValues['uniform_check'] | null>(null);
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (q.data?.uniform_check && mode === null) {
      setMode(q.data.uniform_check.value);
      setMessage(q.data.uniform_message?.value ?? '');
    }
  }, [q.data, mode]);

  if (!q.data || mode === null) return q.error ? null : <Skeleton className="h-40" />;
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    save.mutate(
      // The default text is saved as blank, so a later change of the default reaches this company too.
      { uniform_check: mode, uniform_message: message.trim() === UNIFORM_MESSAGE_DEFAULT ? '' : message.trim() },
      { onSuccess: () => setMsg('Saved') },
    );
  };

  return (
    <form onSubmit={submit} aria-label="Uniform at punch-in">
      <Panel icon={Shirt} title="Uniform at punch-in" description="Reminder only shows the message before check-in (OK, punch in). Must confirm asks Yes / No: Yes punches in and is saved with the attendance, No blocks the punch until the person is wearing it.">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Before check-in</legend>
          <div className="grid grid-cols-3 gap-1.5 max-[420px]:grid-cols-1">
            {UNIFORM_MODES.map((m) => (
              <label
                key={m.value}
                className={cn(
                  'flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-md border bg-card px-2 py-1.5 text-center text-sm font-medium transition outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 hover:border-primary/40',
                  mode === m.value && 'border-primary bg-primary/8 text-primary',
                )}
              >
                <input type="radio" name="uniform-check" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} aria-label={m.label} className="sr-only" />
                <span>{m.label}</span>
                <span className={cn('text-xs font-normal', mode === m.value ? 'text-primary' : 'text-muted-foreground')} aria-hidden>
                  {m.hint}
                </span>
              </label>
            ))}
          </div>
          {fieldErrors.uniform_check && <p className="mt-1 text-xs text-destructive">{fieldErrors.uniform_check}</p>}
        </fieldset>
        {mode !== 'off' && (
          <div className="mt-4 grid gap-1.5">
            <Label htmlFor="hr-uniform-message">Message</Label>
            <Textarea
              id="hr-uniform-message"
              rows={2}
              maxLength={200}
              placeholder={UNIFORM_MESSAGE_DEFAULT}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{message.length}/200 · blank uses the default text</p>
            {fieldErrors.uniform_message && <p className="text-xs text-destructive">{fieldErrors.uniform_message}</p>}
          </div>
        )}
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote className="mt-3">{errorMessage(save.error)}</ErrorNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save uniform check'}
          </Button>
          {msg && (
            <span className="text-sm text-success" role="status">
              {msg}
            </span>
          )}
        </div>
      </Panel>
    </form>
  );
}

function Offices() {
  const q = useOfficeLocations();
  const add = useAddOffice();
  const del = useDeleteOffice();
  const empty = { name: '', latitude: '', longitude: '', radius_m: '200' };
  const [o, setO] = useState(empty);
  const useMyLocation = () =>
    navigator.geolocation?.getCurrentPosition((p) => setO((x) => ({ ...x, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })));
  const error = add.error ?? del.error;
  return (
    <Panel icon={MapPin} tone="info" title="Office locations (geo-fence)">
      {q.data?.length === 0 && <p className="text-sm text-muted-foreground">No office added. Geo-fencing cannot be enforced until one exists.</p>}
      <ul className="divide-y">
        {q.data?.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-info/12 text-info">
                <MapPin className="size-4" />
              </span>
              <div>
              <div className="text-sm font-medium">{x.name}</div>
              <div className="text-xs text-muted-foreground">
                {x.latitude}, {x.longitude} · {x.radius_m} m
              </div>
              </div>
            </div>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove office ${x.name}`} onClick={() => del.mutate(x.id)}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="of-name">Name</Label>
          <Input id="of-name" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-radius">Radius (m)</Label>
          <Input id="of-radius" type="number" value={o.radius_m} onChange={(e) => setO({ ...o, radius_m: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-lat">Latitude</Label>
          <Input id="of-lat" value={o.latitude} onChange={(e) => setO({ ...o, latitude: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="of-lng">Longitude</Label>
          <Input id="of-lng" value={o.longitude} onChange={(e) => setO({ ...o, longitude: e.target.value })} />
        </div>
      </div>
      {error && <ErrorNote className="mt-3">{errorMessage(error)}</ErrorNote>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={useMyLocation}>
          <LocateFixed /> Use my current location
        </Button>
        <Button
          disabled={!o.name || !o.latitude}
          loading={add.isPending}
          onClick={() =>
            add.mutate(
              { name: o.name, latitude: Number(o.latitude), longitude: Number(o.longitude), radius_m: Number(o.radius_m) },
              { onSuccess: () => setO(empty) },
            )
          }
        >
          Add office
        </Button>
      </div>
    </Panel>
  );
}

function LeaveTypes() {
  const q = useLeaveTypes();
  const add = useAddLeaveType();
  const empty = { name: '', annual_quota: '12', paid: true, requires_document: false };
  const [t, setT] = useState(empty);
  return (
    <Panel icon={CalendarHeart} tone="success" title="Leave types">
      <ul className="grid gap-2 sm:grid-cols-2">
        {q.data?.map((x) => (
          <li key={x.id} className={cn('flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2', !x.active && 'opacity-70')}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{x.name}</div>
              <div className="text-xs text-muted-foreground">
                {x.annual_quota}/yr · {x.paid ? 'paid' : 'unpaid'}
                {x.requires_document ? ' · document required' : ''}
              </div>
            </div>
            {!x.active ? <Chip>Inactive</Chip> : <span className="font-mono text-sm font-bold text-primary tabular-nums">{x.annual_quota}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lt-name">Name</Label>
          <Input id="lt-name" value={t.name} placeholder="e.g. Casual" onChange={(e) => setT({ ...t, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lt-quota">Annual quota</Label>
          <Input id="lt-quota" type="number" value={t.annual_quota} onChange={(e) => setT({ ...t, annual_quota: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={t.paid} onCheckedChange={(c) => setT({ ...t, paid: c === true })} /> Paid
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={t.requires_document} onCheckedChange={(c) => setT({ ...t, requires_document: c === true })} /> Document required
        </label>
      </div>
      {add.error && <ErrorNote className="mt-3">{errorMessage(add.error)}</ErrorNote>}
      <Button
        className="mt-3"
        disabled={!t.name.trim()}
        loading={add.isPending}
        onClick={() => add.mutate({ ...t, annual_quota: Number(t.annual_quota) }, { onSuccess: () => setT(empty) })}
      >
        Add leave type
      </Button>
    </Panel>
  );
}
