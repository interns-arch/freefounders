/**
 * Check in / check out, shared by Attendance → Today and the Home card (PLAN.md §19.3). The steps run only when the
 * company switched them on: location (office geofence), then the camera (punch photo). The server decides. There is no
 * face matching (founder, 2026-10-12; PLAN.md §19.18). Inside the phone app (PLAN.md §19.17) the app's GPS and front
 * camera are used instead of the browser's. Before a check-in the company may show a uniform reminder or ask whether the
 * company shirt / jersey is worn (PLAN.md §19.27; in "Must confirm" mode No blocks the punch, §19.36); that dialog closes
 * before location and camera start. Check-out never asks. A check-in always reads today's rules fresh from the server
 * first (§19.36: a screen left open, or the saved copy of §19.18, must never miss a uniform rule switched on since).
 */
import { ApiError, errorMessage } from '@freefounders/core';
import { type AttendanceToday, type PunchRefusal, type UniformCheck, useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { useEffect, useRef, useState } from 'react';
import { AppRequestError, appRequest, isInApp, openAppSettings, skipTodaysReminder } from '@/lib/native-bridge';
import { LocationBlockedError, currentPosition } from './device';
import { SelfieCapture } from './selfie-capture';
import { UniformPrompt } from './uniform-prompt';

type Which = 'check_in' | 'check_out';

export function usePunch(onDone?: (which: Which) => void) {
  const q = useAttendanceToday();
  const mark = useMarkAttendance();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [camFor, setCamFor] = useState<Which | null>(null);
  const [locating, setLocating] = useState(false);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [appCamera, setAppCamera] = useState(false);
  const [inApp] = useState(isInApp);
  /** Location was blocked on the last try: the punch to retry and whether only the phone's Settings can allow it. */
  const [blocked, setBlocked] = useState<{ which: Which; settings: boolean } | null>(null);
  /** The uniform dialog is open (check-in only); the answer is kept for this check-in, also across a location retry. */
  const [askUniform, setAskUniform] = useState(false);
  /** The uniform rule read fresh at the tap (the dialog shows this one, not the screen's older copy). */
  const [uniformMode, setUniformMode] = useState<Exclude<UniformCheck, 'off'> | null>(null);
  const uniformAnswer = useRef<boolean | undefined>(undefined);
  /** Reading today's rules from the server before a check-in. */
  const [checking, setChecking] = useState(false);

  const send = async (which: Which, d: AttendanceToday | undefined, photo?: string | null) => {
    setErr('');
    setMsg('');
    setBlocked(null);
    setLocating(true);
    let pos: { latitude?: number; longitude?: number; accuracy?: number };
    const required = !!d?.geofence_enabled;
    try {
      // In the app the location is asked for only when the company checks it, and its reason is shown when it fails.
      pos = inApp ? (required ? await currentPosition({ required: true }) : {}) : await currentPosition({ required });
    } catch (e) {
      setLocating(false);
      setErr(e instanceof Error ? e.message : 'Your location could not be found.');
      if (e instanceof AppRequestError && e.blocked?.permission === 'location') setBlocked({ which, settings: e.blocked.settings });
      else if (e instanceof LocationBlockedError) setBlocked({ which, settings: false });
      return;
    }
    setLocating(false);
    if (pos.latitude != null && pos.longitude != null) setPosition({ latitude: pos.latitude, longitude: pos.longitude });
    const uniform = which === 'check_in' && d?.uniform_check === 'ask' ? uniformAnswer.current : undefined;
    mark.mutate(
      { which, ...pos, ...(photo ? { photo } : {}), ...(uniform !== undefined ? { uniform } : {}) },
      {
        onSuccess: () => {
          // Phone app: checked in → no more punch-in reminders today (PLAN.md §19.32).
          if (which === 'check_in') skipTodaysReminder();
          setMsg(which === 'check_in' ? 'Checked in ✅' : 'Checked out ✅');
          onDone?.(which);
        },
        onError: (e) => {
          const refusal = e instanceof ApiError ? (e.data as PunchRefusal | undefined) : undefined;
          // The company asks about the uniform but this screen did not know yet: read the rules again and ask.
          if (which === 'check_in' && refusal?.code === 'uniform_required') {
            void q.refetch().then((r) => openUniform('ask', r.data));
            return;
          }
          setErr(errorMessage(e));
        },
      },
    );
  };

  /** Phone app: the native front camera takes the selfie, then the punch is sent. */
  const appPunch = async (which: Which, d: AttendanceToday) => {
    setErr('');
    setMsg('');
    if (!d.photo || d.photo === 'off') return send(which, d);
    setAppCamera(true);
    try {
      const photo = await appRequest<string | null>('photo', { title: which === 'check_in' ? 'Check in' : 'Check out', optional: d.photo === 'optional' });
      setAppCamera(false);
      await send(which, d, photo);
    } catch (e) {
      setAppCamera(false);
      if (!(e instanceof AppRequestError && e.code === 'cancelled')) setErr(e instanceof Error ? e.message : 'The camera could not be opened.');
    }
  };

  const data: AttendanceToday | undefined = q.data;
  // Checked in somewhere else (a computer, or before this app had reminders): today's reminders are not needed either.
  const checkedInToday = !!data?.attendance?.check_in;
  useEffect(() => {
    if (checkedInToday) skipTodaysReminder();
  }, [checkedInToday]);
  // With punch photos switched on, the camera step comes first.
  const usesCamera = !!data && !!data.photo && data.photo !== 'off';
  /** The location / camera steps and the punch, with the rules `d` (fresh for a check-in). */
  const proceed = (which: Which, d: AttendanceToday | undefined = data) => {
    if (inApp && d) return void appPunch(which, d);
    if (d?.photo && d.photo !== 'off') {
      freshFor.current = d;
      return setCamFor(which);
    }
    return void send(which, d);
  };
  /** The rules the browser camera dialog punches with (read at the tap). */
  const freshFor = useRef<AttendanceToday | undefined>(undefined);
  const openUniform = (mode: Exclude<UniformCheck, 'off'>, d: AttendanceToday | undefined) => {
    freshFor.current = d;
    uniformAnswer.current = undefined;
    setUniformMode(mode);
    setAskUniform(true);
  };
  /** Check in / out. A check-in first reads today's rules from the server, then shows the uniform dialog if the company has one. */
  const markIt = async (which: Which) => {
    setErr('');
    setMsg('');
    setBlocked(null);
    if (which !== 'check_in') return proceed(which);
    setChecking(true);
    let d = data;
    try {
      const r = await q.refetch();
      d = r.data ?? data; // offline: the last copy, and the server still decides
    } finally {
      setChecking(false);
    }
    if (d && !d.can_check_in) return; // punched in elsewhere meanwhile: the screen now shows it
    const mode = d?.uniform_check && d.uniform_check !== 'off' ? d.uniform_check : null;
    if (mode) return openUniform(mode, d);
    return proceed('check_in', d);
  };
  const busy = mark.isPending || locating || appCamera || checking;

  const uniformDialog = uniformMode ? (
    <UniformPrompt
      open={askUniform}
      mode={uniformMode}
      message={freshFor.current?.uniform_message ?? data?.uniform_message}
      onCancel={() => setAskUniform(false)}
      onAnswer={(wearing) => {
        uniformAnswer.current = wearing;
        proceed('check_in', freshFor.current ?? data);
      }}
    />
  ) : null;

  const selfie =
    camFor && data ? (
      <SelfieCapture
        title={camFor === 'check_in' ? 'Check in' : 'Check out'}
        action={camFor === 'check_in' ? 'Check in' : 'Check out'}
        onClose={() => setCamFor(null)}
        onCapture={(photo) => {
          const w = camFor;
          setCamFor(null);
          void send(w, freshFor.current ?? data, photo);
        }}
        // Optional photo: "Skip photo" punches without one (the phone app's camera allows the same); required: no skip.
        onSkip={
          data.photo === 'optional'
            ? () => {
                const w = camFor;
                setCamFor(null);
                void send(w, freshFor.current ?? data);
              }
            : undefined
        }
      />
    ) : null;
  // Every dialog of the punch (uniform question, browser camera); the screens render it once.
  const camera = (
    <>
      {uniformDialog}
      {selfie}
    </>
  );

  /** A one-tap way out of a blocked permission, shown next to the error: ask again, or open the phone's Settings. */
  const fix = blocked
    ? blocked.settings
      ? { label: 'Open settings to allow location', run: () => void openAppSettings() }
      : { label: 'Allow location', run: () => proceed(blocked.which) }
    : null;

  return { query: q, data, usesCamera, markIt: (which: Which) => void markIt(which), busy, waitingForCamera: !!camFor || appCamera, msg, err, fix, camera, position };
}
