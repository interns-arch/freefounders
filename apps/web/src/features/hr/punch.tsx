/**
 * Check in / check out, shared by Attendance → Today and the Workspace Portal card (PLAN.md §19.3). The steps run only
 * when the company switched them on: location, then the camera (face check and/or punch photo). The server decides.
 */
import { errorMessage } from '@freefounders/core';
import { type AttendanceToday, useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { useState } from 'react';
import { currentPosition } from './face';
import { FaceCapture } from './face-capture';

export type Which = 'check_in' | 'check_out';

export function usePunch(onDone?: (which: Which) => void) {
  const q = useAttendanceToday();
  const mark = useMarkAttendance();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [camFor, setCamFor] = useState<Which | null>(null);
  const [locating, setLocating] = useState(false);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);

  const send = async (which: Which, faceDescriptor?: number[] | null, photo?: string | null) => {
    setErr('');
    setMsg('');
    setLocating(true);
    const pos = await currentPosition();
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

  const data: AttendanceToday | undefined = q.data;
  // With face attendance or punch photos switched on, the camera step comes first.
  const usesCamera = !!data && (data.face_enabled || (!!data.photo && data.photo !== 'off'));
  const markIt = (which: Which) => (usesCamera ? setCamFor(which) : void send(which));
  const busy = mark.isPending || locating;

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

  return { query: q, data, usesCamera, markIt, busy, waitingForCamera: !!camFor, msg, err, camera, position };
}
