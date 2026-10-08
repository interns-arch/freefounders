/** HR → Today: check in / check out (GPS, face check and/or punch photo, per company setting). Built for phones. */
import { errorMessage } from '@freefounders/core';
import { useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { Camera, LogIn, LogOut, MapPin, ScanFace } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { ErrorNote, OkNote, Panel, Tile, fmtTime } from '../tasks/general/parts';
import { currentPosition } from './face';
import { FaceCapture } from './face-capture';
import { AttendanceChip, hrs } from './parts';

type Which = 'check_in' | 'check_out';

export function TodayTab() {
  const q = useAttendanceToday();
  const mark = useMarkAttendance();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [camFor, setCamFor] = useState<Which | null>(null);
  const [locating, setLocating] = useState(false);

  const send = async (which: Which, faceDescriptor?: number[] | null, photo?: string | null) => {
    setErr('');
    setMsg('');
    setLocating(true);
    const pos = await currentPosition();
    setLocating(false);
    mark.mutate(
      { which, ...pos, ...(faceDescriptor ? { face_descriptor: faceDescriptor } : {}), ...(photo ? { photo } : {}) },
      {
        onSuccess: () => setMsg(which === 'check_in' ? 'Checked in ✅' : 'Checked out ✅'),
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  const data = q.data;
  if (q.error && !data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!data) return <Skeleton className="h-64 max-w-2xl" />;

  // With face attendance or punch photos switched on, the camera step comes first.
  const usesCamera = data.face_enabled || (!!data.photo && data.photo !== 'off');
  const markIt = (which: Which) => (usesCamera ? setCamFor(which) : send(which));
  const busy = mark.isPending || locating;
  const a = data.attendance;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Check in" value={fmtTime(a?.check_in)} />
        <Tile label="Check out" value={fmtTime(a?.check_out)} />
        <Tile label="Worked" value={hrs(a?.working_minutes)} />
        <Tile label="Status" value={a ? <AttendanceChip status={a.status} /> : '—'} alert={!!a?.is_late} />
      </div>
      <ErrorNote>{err}</ErrorNote>
      <OkNote className="text-base">{msg}</OkNote>
      <Panel title="Mark attendance">
        <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
          <li>
            Office hours {data.work_start}–{data.work_end}.
          </li>
          <li className="flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            {data.geofence_enabled ? 'Location check is ON — allow GPS access.' : 'Location check is off.'}
          </li>
          {data.face_enabled && (
            <li className="flex items-center gap-1.5">
              <ScanFace className="size-3.5" />
              {data.face_enrolled
                ? 'Face verification is ON.'
                : data.face_self_enroll
                  ? 'Face verification is ON — first time? Your face will be saved on your first check-in, just like setting up a phone face lock.'
                  : 'Face verification is ON but you are not enrolled — ask an admin.'}
            </li>
          )}
          {data.photo === 'required' && (
            <li className="flex items-center gap-1.5">
              <Camera className="size-3.5" /> A photo is taken at every check-in and check-out.
            </li>
          )}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" className="h-14 text-base" disabled={busy || !data.can_check_in} loading={busy && !camFor} onClick={() => markIt('check_in')}>
            {usesCamera ? <Camera /> : <LogIn />} Check in
          </Button>
          <Button size="lg" variant="outline" className="h-14 text-base" disabled={busy || !data.can_check_out} onClick={() => markIt('check_out')}>
            {usesCamera ? <Camera /> : <LogOut />} Check out
          </Button>
        </div>
      </Panel>

      {camFor && (
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
      )}
    </div>
  );
}
