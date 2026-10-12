/**
 * Check in / check out, shared by Attendance → Today and the Home card (PLAN.md §19.3). The steps run only when the
 * company switched them on: location (office geofence), then the camera (punch photo). The server decides. There is no
 * face matching (founder, 2026-10-12; PLAN.md §19.18). Inside the phone app (PLAN.md §19.17) the app's GPS and front
 * camera are used instead of the browser's.
 */
import { errorMessage } from '@freefounders/core';
import { type AttendanceToday, useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { useState } from 'react';
import { AppRequestError, appRequest, isInApp, openAppSettings } from '@/lib/native-bridge';
import { LocationBlockedError, currentPosition } from './device';
import { SelfieCapture } from './selfie-capture';

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

  const send = async (which: Which, photo?: string | null) => {
    setErr('');
    setMsg('');
    setBlocked(null);
    setLocating(true);
    let pos: { latitude?: number; longitude?: number };
    const required = !!q.data?.geofence_enabled;
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
    mark.mutate(
      { which, ...pos, ...(photo ? { photo } : {}) },
      {
        onSuccess: () => {
          setMsg(which === 'check_in' ? 'Checked in ✅' : 'Checked out ✅');
          onDone?.(which);
        },
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  /** Phone app: the native front camera takes the selfie, then the punch is sent. */
  const appPunch = async (which: Which, d: AttendanceToday) => {
    setErr('');
    setMsg('');
    if (!d.photo || d.photo === 'off') return send(which);
    setAppCamera(true);
    try {
      const photo = await appRequest<string | null>('photo', { title: which === 'check_in' ? 'Check in' : 'Check out', optional: d.photo === 'optional' });
      setAppCamera(false);
      await send(which, photo);
    } catch (e) {
      setAppCamera(false);
      if (!(e instanceof AppRequestError && e.code === 'cancelled')) setErr(e instanceof Error ? e.message : 'The camera could not be opened.');
    }
  };

  const data: AttendanceToday | undefined = q.data;
  // With punch photos switched on, the camera step comes first.
  const usesCamera = !!data && !!data.photo && data.photo !== 'off';
  const markIt = (which: Which) => {
    if (inApp && data) return void appPunch(which, data);
    return usesCamera ? setCamFor(which) : void send(which);
  };
  const busy = mark.isPending || locating || appCamera;

  const camera =
    camFor && data ? (
      <SelfieCapture
        title={camFor === 'check_in' ? 'Check in' : 'Check out'}
        action={camFor === 'check_in' ? 'Check in' : 'Check out'}
        onClose={() => setCamFor(null)}
        onCapture={(photo) => {
          const w = camFor;
          setCamFor(null);
          void send(w, photo);
        }}
      />
    ) : null;

  /** A one-tap way out of a blocked permission, shown next to the error: ask again, or open the phone's Settings. */
  const fix = blocked
    ? blocked.settings
      ? { label: 'Open settings to allow location', run: () => void openAppSettings() }
      : { label: 'Allow location', run: () => markIt(blocked.which) }
    : null;

  return { query: q, data, usesCamera, markIt, busy, waitingForCamera: !!camFor || appCamera, msg, err, fix, camera, position };
}
