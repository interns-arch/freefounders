/**
 * Check in / check out, shared by Attendance → Today and the Workspace Portal card (PLAN.md §19.3). The steps run only
 * when the company switched them on: location, then the camera (face check and/or punch photo). The server decides.
 * Inside the phone app (PLAN.md §19.17) the app's GPS and front camera are used instead of the browser's, and the face
 * check is never run: with face check on, the app says so and does not punch (founder, 2026-10-12).
 */
import { errorMessage } from '@freefounders/core';
import { type AttendanceToday, useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { useState } from 'react';
import { AppRequestError, appRequest, isInApp } from '@/lib/native-bridge';
import { currentPosition } from './face';
import { FaceCapture } from './face-capture';

type Which = 'check_in' | 'check_out';

export const APP_FACE_CHECK_MESSAGE =
  'Face check is on for your company; the app punches with a selfie only — ask your admin to switch face check off in Attendance → HR settings.';

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

  const send = async (which: Which, faceDescriptor?: number[] | null, photo?: string | null) => {
    setErr('');
    setMsg('');
    setLocating(true);
    let pos: { latitude?: number; longitude?: number };
    try {
      // In the app the location is asked for only when the company checks it, and its reason is shown when it fails.
      pos = inApp ? (q.data?.geofence_enabled ? await currentPosition({ required: true }) : {}) : await currentPosition();
    } catch (e) {
      setLocating(false);
      setErr(e instanceof Error ? e.message : 'Your location could not be found.');
      return;
    }
    setLocating(false);
    if (pos.latitude != null && pos.longitude != null) setPosition({ latitude: pos.latitude, longitude: pos.longitude });
    mark.mutate(
      { which, ...pos, ...(faceDescriptor ? { face_descriptor: faceDescriptor } : {}), ...(photo ? { photo } : {}) },
      {
        onSuccess: () => {
          setMsg(which === 'check_in' ? 'Checked in ✅' : 'Checked out ✅');
          onDone?.(which);
        },
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  /** Phone app: the native front camera takes the selfie (no face check), then the punch is sent. */
  const appPunch = async (which: Which, d: AttendanceToday) => {
    setErr('');
    setMsg('');
    if (d.face_enabled) return setErr(APP_FACE_CHECK_MESSAGE);
    if (!d.photo || d.photo === 'off') return send(which);
    setAppCamera(true);
    try {
      const photo = await appRequest<string | null>('photo', { title: which === 'check_in' ? 'Check in' : 'Check out', optional: d.photo === 'optional' });
      setAppCamera(false);
      await send(which, null, photo);
    } catch (e) {
      setAppCamera(false);
      if (!(e instanceof AppRequestError && e.code === 'cancelled')) setErr(e instanceof Error ? e.message : 'The camera could not be opened.');
    }
  };

  const data: AttendanceToday | undefined = q.data;
  // With face attendance or punch photos switched on, the camera step comes first.
  const usesCamera = !!data && (data.face_enabled || (!!data.photo && data.photo !== 'off'));
  const markIt = (which: Which) => {
    if (inApp && data) return void appPunch(which, data);
    return usesCamera ? setCamFor(which) : void send(which);
  };
  const busy = mark.isPending || locating || appCamera;

  const camera =
    camFor && data ? (
      <FaceCapture
        face={!!data.face_enabled}
        photo={!!data.photo && data.photo !== 'off'}
        title={data.face_enabled ? (camFor === 'check_in' ? 'Check in with your face' : 'Check out with your face') : camFor === 'check_in' ? 'Check in' : 'Check out'}
        action={camFor === 'check_in' ? 'Check in' : 'Check out'}
        hint={
          data.face_enabled && !data.face_enrolled
            ? data.face_self_enroll
              ? 'First time: this capture becomes your face profile. Look straight at the camera in good light, without a mask.'
              : 'Your face is not enrolled yet — ask an admin to enrol you first.'
            : undefined
        }
        onClose={() => setCamFor(null)}
        onCapture={(descriptor, photo) => {
          const w = camFor;
          setCamFor(null);
          void send(w, descriptor, photo);
        }}
      />
    ) : null;

  return { query: q, data, usesCamera, markIt, busy, waitingForCamera: !!camFor || appCamera, msg, err, camera, position };
}
