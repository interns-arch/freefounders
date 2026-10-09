/** Attendance → Today: check in / check out (GPS, face check and/or punch photo, per company setting). Built for phones. */
import { Camera, LogIn, LogOut, MapPin, ScanFace } from 'lucide-react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { ErrorNote, OkNote, Panel, Tile, fmtTime } from '../tasks/general/parts';
import { AttendanceChip, hrs } from './parts';
import { usePunch } from './punch';

export function TodayTab() {
  const p = usePunch();
  const data = p.data;
  if (p.query.error && !data) return <ErrorState error={p.query.error} onRetry={() => p.query.refetch()} />;
  if (!data) return <Skeleton className="h-64 max-w-2xl" />;
  const a = data.attendance;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Check in" value={fmtTime(a?.check_in)} />
        <Tile label="Check out" value={fmtTime(a?.check_out)} />
        <Tile label="Worked" value={hrs(a?.working_minutes)} />
        <Tile label="Status" value={a ? <AttendanceChip status={a.status} /> : '—'} alert={!!a?.is_late} />
      </div>
      <ErrorNote>{p.err}</ErrorNote>
      <OkNote className="text-base">{p.msg}</OkNote>
      <Panel title="Mark attendance">
        <ul className="mb-4 space-y-1.5 text-sm text-muted-foreground">
          <li>
            Office hours <span className="font-mono text-foreground">{data.work_start}–{data.work_end}</span>.
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
          <Button
            size="lg"
            className="h-14 text-base"
            disabled={p.busy || !data.can_check_in}
            loading={p.busy && !p.waitingForCamera}
            onClick={() => p.markIt('check_in')}
          >
            {p.usesCamera ? <Camera /> : <LogIn />} Check in
          </Button>
          <Button size="lg" variant="outline" className="h-14 text-base" disabled={p.busy || !data.can_check_out} onClick={() => p.markIt('check_out')}>
            {p.usesCamera ? <Camera /> : <LogOut />} Check out
          </Button>
        </div>
      </Panel>
      {p.camera}
    </div>
  );
}
