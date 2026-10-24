// Punch-in reminder (src/lib/reminder-plan.ts, PLAN.md §19.32): settings, the notifications planned, skip today.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHANNELS,
  DEFAULT_REMINDER,
  SKIP_WEEKS,
  expoWeekday,
  isoWeekday,
  localDate,
  nextReminder,
  parseReminderSettings,
  planReminders,
  type ReminderSettings,
} from '../src/lib/reminder-plan.ts';
import { parseMessage } from '../src/lib/protocol.ts';

// 2026-10-21 is a Wednesday (ISO 3). Dates are the phone's local time.
const WED = (h: number, m = 0) => new Date(2026, 9, 21, h, m);
const S = (over: Partial<ReminderSettings> = {}): ReminderSettings => ({ ...DEFAULT_REMINDER, enabled: true, time: '09:20', days: [1, 2, 3, 4, 5, 6], followUpMinutes: 10, ...over });

test('weekday numbering: ISO 1 = Monday … 7 = Sunday; expo 1 = Sunday … 7 = Saturday', () => {
  assert.equal(isoWeekday(WED(9)), 3);
  assert.equal(isoWeekday(new Date(2026, 9, 25)), 7); // Sunday
  assert.equal(expoWeekday(1), 2); // Monday
  assert.equal(expoWeekday(6), 7); // Saturday
  assert.equal(expoWeekday(7), 1); // Sunday
  assert.equal(localDate(WED(23, 59)), '2026-10-21');
});

test('settings from the web: cleaned, defaults, refusals', () => {
  assert.deepEqual(parseReminderSettings({ enabled: true, time: '9:05', days: [5, 1, 1, 9, 0, 3.5], mode: 'vibrate', followUpMinutes: 500 }), {
    ok: true,
    settings: { enabled: true, time: '09:05', days: [1, 5], mode: 'vibrate', followUpMinutes: 240, count: 2 },
  });
  const d = parseReminderSettings({ time: '08:50', days: [1] });
  assert.ok(d.ok && d.settings.mode === 'ring-vibrate' && d.settings.followUpMinutes === 10 && d.settings.enabled);
  assert.ok(!parseReminderSettings({ time: '24:00', days: [1] }).ok);
  assert.ok(!parseReminderSettings({ time: 'nine', days: [1] }).ok);
  assert.deepEqual(parseReminderSettings({ enabled: true, time: '09:00', days: [] }), { ok: false, error: 'Choose at least one day for the reminder.' });
  assert.ok(parseReminderSettings({ enabled: false, time: '09:00', days: [] }).ok); // off: no days needed
  assert.ok(!parseReminderSettings(null).ok);
  assert.equal(CHANNELS.vibrate.sound, false);
  assert.equal(CHANNELS.ring.vibrate, false);
  assert.ok(CHANNELS['ring-vibrate'].sound && CHANNELS['ring-vibrate'].vibrate);
});

test('plan: one weekly reminder per chosen day, plus the follow-up', () => {
  const plan = planReminders(S({ days: [1, 3, 7] }), WED(7));
  assert.deepEqual(plan, [
    { kind: 'weekly', day: 1, n: 1, followUp: false, weekday: 2, hour: 9, minute: 20 },
    { kind: 'weekly', day: 1, n: 2, followUp: true, weekday: 2, hour: 9, minute: 30 },
    { kind: 'weekly', day: 3, n: 1, followUp: false, weekday: 4, hour: 9, minute: 20 },
    { kind: 'weekly', day: 3, n: 2, followUp: true, weekday: 4, hour: 9, minute: 30 },
    { kind: 'weekly', day: 7, n: 1, followUp: false, weekday: 1, hour: 9, minute: 20 },
    { kind: 'weekly', day: 7, n: 2, followUp: true, weekday: 1, hour: 9, minute: 30 },
  ]);
  assert.equal(planReminders(S({ followUpMinutes: 0, days: [2] }), WED(7)).length, 1);
  assert.deepEqual(planReminders(S({ enabled: false }), WED(7)), []);
  // A follow-up past midnight rings early the next day.
  assert.deepEqual(planReminders(S({ time: '23:55', days: [7] }), WED(7)), [
    { kind: 'weekly', day: 7, n: 1, followUp: false, weekday: 1, hour: 23, minute: 55 },
    { kind: 'weekly', day: 7, n: 2, followUp: true, weekday: 2, hour: 0, minute: 5 }, // Monday 00:05
  ]);
});

test('skip today: today\'s reminders become one-off ones from next week; the other days stay weekly', () => {
  const plan = planReminders(S({ days: [3, 4] }), WED(9, 5), '2026-10-21');
  const wed = plan.filter((p) => p.day === 3);
  assert.equal(wed.length, 2 * SKIP_WEEKS);
  assert.ok(wed.every((p) => p.kind === 'date'));
  const firsts = wed.filter((p) => p.kind === 'date' && !p.followUp).map((p) => (p.kind === 'date' ? p.at : null));
  assert.deepEqual(firsts, [new Date(2026, 9, 28, 9, 20), new Date(2026, 10, 4, 9, 20), new Date(2026, 10, 11, 9, 20), new Date(2026, 10, 18, 9, 20)]);
  assert.ok(plan.filter((p) => p.day === 4).every((p) => p.kind === 'weekly'));
  // Next reminder: Thursday, not today.
  assert.deepEqual(nextReminder(plan, WED(9, 5)), new Date(2026, 9, 22, 9, 20));
});

test('skip today after today\'s reminders rang (or an old skip): weekly again', () => {
  // Checked in at 10:00, both reminders already rang: nothing to cancel.
  assert.ok(planReminders(S({ days: [3] }), WED(10), '2026-10-21').every((p) => p.kind === 'weekly'));
  // Checked in at 09:25: the 09:20 reminder rang (weekly: next Wednesday), the 09:30 follow-up is cancelled for today.
  const p925 = planReminders(S({ days: [3] }), WED(9, 25), '2026-10-21');
  assert.deepEqual(p925.map((p) => `${p.kind}${p.followUp ? '+' : ''}`), ['weekly', ...Array(SKIP_WEEKS).fill('date+')]);
  assert.deepEqual(nextReminder(p925, WED(9, 25)), new Date(2026, 9, 28, 9, 20));
  // Skipped yesterday: today rings as usual.
  const plan = planReminders(S({ days: [3] }), WED(7), '2026-10-20');
  assert.ok(plan.every((p) => p.kind === 'weekly'));
  assert.deepEqual(nextReminder(plan, WED(7)), WED(9, 20));
});

test('skip across midnight: the follow-up after midnight belongs to the day before', () => {
  const late = S({ time: '23:55', days: [3] }); // Wednesday 23:55, follow-up Thursday 00:05
  // Checked in Wednesday 23:58 → the Thursday 00:05 follow-up is cancelled too.
  const p1 = planReminders(late, WED(23, 58), '2026-10-21');
  assert.ok(p1.filter((p) => p.followUp).every((p) => p.kind === 'date'));
  assert.deepEqual(nextReminder(p1, WED(23, 58)), new Date(2026, 9, 28, 23, 55));
  // Checked in Thursday 00:01 (skip = Thursday) → Wednesday's follow-up ringing Thursday 00:05 is cancelled.
  const thu = new Date(2026, 9, 22, 0, 1);
  const p2 = planReminders(late, thu, '2026-10-22');
  const follow = p2.find((p) => p.followUp)!;
  assert.equal(follow.kind, 'date');
  assert.deepEqual(follow.kind === 'date' && follow.at, new Date(2026, 9, 29, 0, 5));
  assert.equal(p2.find((p) => !p.followUp)!.kind, 'weekly'); // next Wednesday's main reminder: weekly as usual
  // The next day the plan is weekly again.
  assert.ok(planReminders(late, new Date(2026, 9, 23, 8), '2026-10-22').every((p) => p.kind === 'weekly'));
});

test('next reminder: later today, or the next chosen day', () => {
  assert.deepEqual(nextReminder(planReminders(S({ days: [3] }), WED(9, 25)), WED(9, 25)), WED(9, 30));
  assert.deepEqual(nextReminder(planReminders(S({ days: [3], followUpMinutes: 0 }), WED(9, 25)), WED(9, 25)), new Date(2026, 9, 28, 9, 20));
  assert.deepEqual(nextReminder(planReminders(S({ days: [7] }), WED(9)), WED(9)), new Date(2026, 9, 25, 9, 20));
  assert.equal(nextReminder([], WED(9)), null);
});

test('bridge: reminder requests', () => {
  assert.deepEqual(parseMessage(JSON.stringify({ id: 'r1', type: 'reminder-set', settings: { enabled: true, time: '09:20', days: [1, 2], mode: 'ring', followUpMinutes: 0 } })), {
    kind: 'request',
    request: { id: 'r1', type: 'reminder-set', settings: { enabled: true, time: '09:20', days: [1, 2], mode: 'ring', followUpMinutes: 0, count: 1 } },
  });
  assert.deepEqual(parseMessage(JSON.stringify({ id: 'r2', type: 'reminder-set', settings: { time: '09:20', days: [] } })), {
    kind: 'invalid',
    id: 'r2',
    error: 'Choose at least one day for the reminder.',
  });
  for (const type of ['reminder-get', 'reminder-skip-today', 'reminder-off'] as const) assert.deepEqual(parseMessage(JSON.stringify({ id: 'r3', type })), { kind: 'request', request: { id: 'r3', type } });
  assert.deepEqual(parseMessage('{"id":"r4","type":"reminder-test","mode":"loud"}'), { kind: 'request', request: { id: 'r4', type: 'reminder-test', mode: 'ring-vibrate' } });
  assert.deepEqual(parseMessage('{"id":"r5","type":"reminder-test","mode":"vibrate"}'), { kind: 'request', request: { id: 'r5', type: 'reminder-test', mode: 'vibrate' } });
});

test('several reminders a day (PLAN.md §19.39): reporting 09:30 → 10:00, 10:30, 11:00; skip today cancels the rest', () => {
  const rule = S({ time: '10:00', days: [3], followUpMinutes: 30, count: 3 });
  const plan = planReminders(rule, WED(7));
  assert.deepEqual(
    plan.map((p) => (p.kind === 'weekly' ? `${p.n} ${p.hour}:${p.minute}` : '')),
    ['1 10:0', '2 10:30', '3 11:0'],
  );
  assert.deepEqual(nextReminder(plan, WED(10, 10)), WED(10, 30));
  // Punched in at 10:10: reminders 2 and 3 of today become one-offs from next week, reminder 1 stays weekly.
  const skipped = planReminders(rule, WED(10, 10), '2026-10-21');
  assert.deepEqual(skipped.filter((p) => p.kind === 'weekly').map((p) => p.n), [1]);
  assert.equal(skipped.filter((p) => p.kind === 'date').length, 2 * SKIP_WEEKS);
  assert.deepEqual(nextReminder(skipped, WED(10, 10)), new Date(2026, 9, 28, 10, 0));
  // Settings: count clamped to 1–10, 1 without a follow-up; an older saved setting (no count) = 2 (first + follow-up).
  const p = (raw: object) => {
    const r = parseReminderSettings({ time: '10:00', days: [3], ...raw });
    return r.ok ? [r.settings.count, r.settings.followUpMinutes] : null;
  };
  assert.deepEqual(p({ followUpMinutes: 30, count: 3 }), [3, 30]);
  assert.deepEqual(p({ followUpMinutes: 30, count: 50 }), [10, 30]);
  assert.deepEqual(p({ followUpMinutes: 0, count: 3 }), [1, 0]);
  assert.deepEqual(p({ followUpMinutes: 10 }), [2, 10]);
  assert.equal(DEFAULT_REMINDER.count, 2);
});
