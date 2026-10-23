/**
 * Punch-in reminder (founder 2026-10-22, PLAN.md §19.32): local notifications scheduled on the phone (expo-notifications),
 * so they ring or vibrate even when the app is closed; no server push. The plan (which notifications, when) is the pure
 * src/lib/reminder-plan.ts; this file talks to Android.
 *
 * - Android channels: "Punch-in reminders" (high importance, sound + vibration, shown on the lock screen), a ring-only and
 *   a vibrate-only channel. A channel's sound/vibration cannot change after it is created, so each mode has its own.
 * - Android 13+: the notification permission is asked with Android's pop-up when the person switches the reminder on.
 * - Settings are kept on this phone (expo-secure-store), per person per phone.
 * - Scheduled notifications survive a reboot and an app update (expo-notifications re-registers them on BOOT_COMPLETED /
 *   MY_PACKAGE_REPLACED). The plan is also refreshed every time the app opens (refreshReminders).
 * - Timing: exact when Android allows exact alarms for the app (Android 12–13 with SCHEDULE_EXACT_ALARM declared, or the
 *   person allowed "Alarms & reminders" on Android 14+), otherwise Android may deliver a few minutes late (battery saver,
 *   Doze). Ringing = the notification sound, not a full-screen alarm.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { CHANNELS, type ReminderMode, type ReminderSettings, VIBRATION_PATTERN, localDate, nextReminder, parseReminderSettings, planReminders } from './reminder-plan';

type NotificationsModule = typeof import('expo-notifications');

const KEY = 'ff.punchReminder';
const ID_PREFIX = 'ff-punch-';
export const REMINDER_PATH = '/attendance';

export type PermissionState = 'granted' | 'ask' | 'blocked' | 'unavailable';

export interface ReminderState {
  settings: ReminderSettings | null;
  permission: PermissionState;
  /** ISO time of the next reminder, or null. */
  next: string | null;
  /** "YYYY-MM-DD" of a skipped day, when today was skipped. */
  skipped: string | null;
}

export class ReminderError extends Error {
  constructor(
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let cached: NotificationsModule | null | undefined;
/** expo-notifications, or null when this build has no such native module (loaded lazily, like voice). */
export function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

interface Stored {
  settings: ReminderSettings;
  skip: string | null;
}

async function load(): Promise<Stored | null> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { settings?: unknown; skip?: unknown };
    const p = parseReminderSettings(v.settings);
    if (!p.ok) return null;
    return { settings: p.settings, skip: typeof v.skip === 'string' ? v.skip : null };
  } catch {
    return null;
  }
}

const save = (s: Stored) => SecureStore.setItemAsync(KEY, JSON.stringify(s)).catch(() => {});

let channelsReady = false;
async function ensureChannels(N: NotificationsModule) {
  if (channelsReady || Platform.OS !== 'android') return;
  for (const c of Object.values(CHANNELS)) {
    await N.setNotificationChannelAsync(c.id, {
      name: c.name,
      description: 'Reminds you to punch in when you have not yet.',
      importance: N.AndroidImportance.HIGH,
      sound: c.sound ? 'default' : null,
      enableVibrate: c.vibrate,
      vibrationPattern: c.vibrate ? VIBRATION_PATTERN : null,
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });
  }
  channelsReady = true;
}

async function permissionOf(N: NotificationsModule): Promise<PermissionState> {
  const p = await N.getPermissionsAsync().catch(() => null);
  if (!p) return 'unavailable';
  return p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked';
}

/** Android's "Allow Kaampilot to send you notifications?" pop-up when needed (13+; earlier versions: always on). */
async function askPermission(N: NotificationsModule): Promise<void> {
  await ensureChannels(N); // Android 13 shows the pop-up only once a channel exists
  let p = await N.getPermissionsAsync().catch(() => null);
  if (p && !p.granted && p.canAskAgain) p = (await N.requestPermissionsAsync().catch(() => null)) ?? p;
  if (p?.granted) return;
  throw p && !p.canAskAgain
    ? new ReminderError('Notifications are off for Kaampilot. Tap "Open settings" → Notifications → Allow, then save the reminder again.', {
        code: 'permission',
        permission: 'notifications',
        settings: true,
      })
    : new ReminderError('Kaampilot needs to show notifications to remind you. Tap "Save" again and choose "Allow".', {
        code: 'permission',
        permission: 'notifications',
        settings: false,
      });
}

async function cancelOurs(N: NotificationsModule) {
  const all = await N.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(all.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => N.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
}

function content(followUp: boolean, channel: string) {
  return {
    title: followUp ? 'Not punched in yet?' : 'Time to punch in',
    body: followUp ? 'Tap to open Kaampilot and check in.' : 'Your office day is about to start. Tap to check in.',
    data: { path: REMINDER_PATH, kind: 'punch-reminder' },
    sound: channel === CHANNELS.vibrate.id ? false : 'default',
    priority: 'max' as const,
    vibrate: VIBRATION_PATTERN,
  };
}

/** Cancels this app's reminders and schedules them again from the stored settings. */
async function apply(N: NotificationsModule, stored: Stored | null, now = new Date()): Promise<ReminderState> {
  await cancelOurs(N);
  const permission = await permissionOf(N);
  if (!stored) return { settings: null, permission, next: null, skipped: null };
  const skip = stored.skip && stored.skip >= localDate(new Date(now.getTime() - 86_400_000)) ? stored.skip : null;
  const plan = stored.settings.enabled && permission === 'granted' ? planReminders(stored.settings, now, skip) : [];
  if (plan.length) await ensureChannels(N);
  const channelId = CHANNELS[stored.settings.mode].id;
  let i = 0;
  for (const p of plan) {
    const identifier = `${ID_PREFIX}${i++}`;
    const trigger =
      p.kind === 'weekly'
        ? { type: N.SchedulableTriggerInputTypes.WEEKLY, weekday: p.weekday, hour: p.hour, minute: p.minute, channelId }
        : { type: N.SchedulableTriggerInputTypes.DATE, date: p.at, channelId };
    await N.scheduleNotificationAsync({ identifier, content: content(p.followUp, channelId), trigger });
  }
  const next = nextReminder(plan, now);
  return { settings: stored.settings, permission, next: next ? next.toISOString() : null, skipped: skip === localDate(now) ? skip : null };
}

function need(): NotificationsModule {
  const N = notifications();
  if (!N) throw new ReminderError('Reminders need the latest Kaampilot app.', { code: 'unavailable' });
  return N;
}

export async function setReminder(settings: ReminderSettings): Promise<ReminderState> {
  const N = need();
  if (settings.enabled) await askPermission(N);
  const before = await load();
  // A new time or new days start fresh; the skip of today stays (already checked in).
  return apply(N, await persist({ settings, skip: before?.skip ?? null }));
}

const persist = async (s: Stored) => {
  await save(s);
  return s;
};

export async function getReminder(): Promise<ReminderState> {
  const N = need();
  const stored = await load();
  return { ...(await apply(N, stored)) };
}

/** After a check-in: today's remaining reminders (and today's follow-up) are cancelled; tomorrow they ring again. */
export async function skipToday(): Promise<ReminderState> {
  const N = need();
  const stored = await load();
  if (!stored) return apply(N, null);
  return apply(N, await persist({ ...stored, skip: localDate(new Date()) }));
}

export async function reminderOff(): Promise<ReminderState> {
  const N = need();
  const stored = await load();
  return apply(N, stored ? await persist({ settings: { ...stored.settings, enabled: false }, skip: stored.skip }) : null);
}

/** "Send a test reminder now": one notification in 5 seconds, in the chosen mode. */
export async function testReminder(mode: ReminderMode): Promise<{ at: string }> {
  const N = need();
  await askPermission(N);
  await ensureChannels(N);
  const channelId = CHANNELS[mode].id;
  await N.scheduleNotificationAsync({
    identifier: 'ff-test-punch-reminder',
    content: { ...content(false, channelId), title: 'Test: time to punch in' },
    trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId },
  });
  return { at: new Date(Date.now() + 5000).toISOString() };
}

/** At app start: roll the plan forward (a skipped day back to weekly, one-off reminders for the coming weeks). */
export async function refreshReminders(): Promise<void> {
  const N = notifications();
  if (!N) return;
  const stored = await load();
  if (stored?.settings.enabled) await apply(N, stored).catch(() => {});
}

/** A notification shown while the app is open still pops up and rings. */
export function installReminderHandler() {
  const N = notifications();
  N?.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** The page a tapped reminder opens (null for any other notification). */
export function pathOfResponse(r: { notification: { request: { content: { data?: unknown } } } } | null | undefined): string | null {
  const data = r?.notification.request.content.data as { path?: unknown; kind?: unknown } | undefined;
  return data?.kind === 'punch-reminder' && typeof data.path === 'string' && data.path.startsWith('/') ? data.path : null;
}
