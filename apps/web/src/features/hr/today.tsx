/** Attendance → Today: check in / check out (GPS, face check and/or punch photo, per company setting). Built for phones. */
import { Activity, Camera, Clock, LogIn, LogOut, MapPin, ScanFace, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { ErrorNote, OkNote, Tile, fmtTime } from '../tasks/general/parts';
import { AttendanceChip, hrs } from './parts';
import { usePunch } from './punch';

/** The time right now, once a second (display only). */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function TodayTab() {
  const p = usePunch();
  const now = useClock();
  const data = p.data;
  if (p.query.error && !data) return <ErrorState error={p.query.error} onRetry={() => p.query.refetch()} />;
  if (!data) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }
  const a = data.attendance;
  const checkedIn = !!a?.check_in;
  const checkedOut = !!a?.check_out;
  const stateLabel = checkedOut ? 'Done for today' : checkedIn ? 'Checked in' : 'Not checked in';
  const stateTone = checkedOut ? 'bg-primary/12 text-primary' : checkedIn ? 'bg-success/14 text-success' : 'bg-muted text-muted-foreground';

  const time = (iso: string | null | undefined) => <span className="text-xl sm:text-[22px]">{fmtTime(iso)}</span>;
  return (
    <div className="max-w-3xl space-y-4">
      {/* Marking attendance is the first thing on a phone: the card comes first, the day's tiles after it. */}
      <section aria-label="Mark attendance" className="relative max-w-2xl overflow-hidden rounded-2xl border bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.04)]">
        {/* Header band: the clock and today's state. */}
        <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary/12 via-card to-brand-2/10 px-4 py-4 sm:px-5">
          <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-brand-2/20 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Clock className="size-4" />
                </span>
                Mark attendance
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Office hours{' '}
                <span className="font-mono font-semibold text-foreground">
                  {data.work_start}–{data.work_end}
                </span>
                .
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl font-bold tracking-tight tabular-nums" aria-live="off">
                {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <span className={cn('mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', stateTone)}>
                <span className={cn('size-1.5 rounded-full bg-current', checkedIn && !checkedOut && 'animate-pulse')} />
                {stateLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <ul className="mb-4 flex flex-wrap gap-2 text-[13px]">
            <li className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
              <MapPin className={cn('size-3.5', data.geofence_enabled && 'text-primary')} />
              {data.geofence_enabled ? 'Location check is ON — allow GPS access.' : 'Location check is off.'}
            </li>
            {data.face_enabled && (
              <li className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                <ScanFace className="size-3.5 text-primary" />
                {data.face_enrolled
                  ? 'Face verification is ON.'
                  : data.face_self_enroll
                    ? 'Face verification is ON — first time? Your face will be saved on your first check-in, just like setting up a phone face lock.'
                    : 'Face verification is ON but you are not enrolled — ask an admin.'}
              </li>
            )}
            {data.photo === 'required' && (
              <li className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                <Camera className="size-3.5 text-primary" /> A photo is taken at every check-in and check-out.
              </li>
            )}
          </ul>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <Button
              size="lg"
              className="h-14 rounded-xl text-base font-semibold shadow-md shadow-primary/25"
              disabled={p.busy || !data.can_check_in}
              loading={p.busy && !p.waitingForCamera}
              onClick={() => p.markIt('check_in')}
            >
              {p.usesCamera ? <Camera className="size-5" /> : <LogIn className="size-5" />} Check in
            </Button>
            <Button size="lg" variant="outline" className="h-14 rounded-xl text-base font-semibold" disabled={p.busy || !data.can_check_out} onClick={() => p.markIt('check_out')}>
              {p.usesCamera ? <Camera className="size-5" /> : <LogOut className="size-5" />} Check out
            </Button>
          </div>
        </div>
      </section>
      <ErrorNote>{p.err}</ErrorNote>
      {p.fix && (
        <Button size="lg" className="h-12 w-full max-w-2xl rounded-xl" onClick={p.fix.run}>
          <MapPin className="size-5" /> {p.fix.label}
        </Button>
      )}
      <OkNote className="text-base">{p.msg}</OkNote>
      <div className="grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={LogIn} tone="success" label="Check in" value={time(a?.check_in)} />
        <Tile icon={LogOut} tone="info" label="Check out" value={time(a?.check_out)} />
        <Tile icon={Timer} tone="warning" label="Worked" value={hrs(a?.working_minutes)} />
        <Tile icon={Activity} tone="neutral" label="Status" value={a ? <AttendanceChip status={a.status} /> : '—'} alert={!!a?.is_late} />
      </div>
      {p.camera}
    </div>
  );
}
