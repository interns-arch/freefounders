/** Attendance → Today: check in / check out (GPS and/or punch photo, per company setting). Built for phones. */
import { useAccess } from '@freefounders/core';
import { Activity, Camera, ClipboardCheck, Clock, LogIn, LogOut, MapPin, Timer } from '@/components/icons';
import { useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { useMinuteClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { ErrorNote, OkNote, Tile, fmtTime } from '../tasks/general/parts';
import { AttendanceChip, hrs } from './parts';
import { usePunch } from './punch';
import { RegularizeDialog, RegularizedTag } from './regularize';
import { PunchReminderCard } from './reminder';

export function TodayTab() {
  const p = usePunch();
  const now = useMinuteClock();
  // Punching in is its own permission (PLAN.md §19.19), the same check as the Home card: without it, no buttons.
  const access = useAccess();
  const punches = access.tasks.can('attendance.punch');
  // Regularize a past day (or today after the shift) from here too (PLAN.md §19.38): two taps to the form.
  const regularizes = access.tasks.can('attendance.self');
  const [regularizing, setRegularizing] = useState(false);
  const [sent, setSent] = useState('');
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
  const stateTone = checkedOut ? 'bg-primary/8 text-primary' : checkedIn ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground';

  const time = (iso: string | null | undefined) => <span className="text-xl sm:text-[22px]">{fmtTime(iso)}</span>;
  return (
    <div className="max-w-3xl space-y-4">
      {punches ? (
        <>
          {/* Marking attendance is the first thing on a phone: the card comes first, the day's tiles after it. */}
          <section aria-label="Mark attendance" className="relative max-w-2xl overflow-hidden rounded-xl border bg-card shadow-card">
            {/* Header band: the clock and today's state. */}
            <div className="border-b bg-muted/40 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                    <span className="flex size-8 items-center justify-center rounded-md bg-app-attendance/10 text-app-attendance">
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
                  <span className={cn('mt-1 inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold', stateTone)}>
                    {stateLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 sm:px-5">
              <ul className="mb-4 flex flex-wrap gap-2 text-[13px]">
                <li className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                  <MapPin className={cn('size-3.5', data.geofence_enabled && 'text-primary')} />
                  {data.geofence_enabled ? 'Location check is ON — allow GPS access.' : 'Location check is off.'}
                </li>
                {data.photo === 'required' && (
                  <li className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-muted-foreground">
                    <Camera className="size-3.5 text-primary" /> A photo is taken at every check-in and check-out.
                  </li>
                )}
              </ul>
              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                {/* The orange call to action is whichever punch is due now; the other one stays quiet. */}
                <Button
                  size="lg"
                  variant={data.can_check_in ? 'cta' : 'outline'}
                  className="h-14 text-base"
                  disabled={p.busy || !data.can_check_in}
                  loading={p.busy && !p.waitingForCamera}
                  onClick={() => p.markIt('check_in')}
                >
                  {p.usesCamera ? <Camera className="size-5" /> : <LogIn className="size-5" />} Check in
                </Button>
                <Button size="lg" variant={data.can_check_out ? 'cta' : 'outline'} className="h-14 text-base" disabled={p.busy || !data.can_check_out} onClick={() => p.markIt('check_out')}>
                  {p.usesCamera ? <Camera className="size-5" /> : <LogOut className="size-5" />} Check out
                </Button>
              </div>
            </div>
          </section>
        </>
      ) : (
        <p role="note" className="max-w-2xl rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          Your role doesn't include punching in.
        </p>
      )}
      <ErrorNote>{p.err}</ErrorNote>
      {p.fix && (
        <Button size="lg" className="h-12 w-full max-w-2xl" onClick={p.fix.run}>
          <MapPin className="size-5" /> {p.fix.label}
        </Button>
      )}
      <OkNote className="text-base">{p.msg}</OkNote>
      <div className="grid max-w-2xl grid-cols-2 gap-3">
        <Tile icon={LogIn} tone="success" label="Check in" value={time(a?.check_in)} />
        <Tile icon={LogOut} tone="info" label="Check out" value={time(a?.check_out)} />
        <Tile icon={Timer} tone="warning" label="Worked" value={hrs(a?.working_minutes)} />
        <Tile
          icon={Activity}
          tone="neutral"
          label="Status"
          value={
            a ? (
              <span className="inline-flex flex-wrap gap-1">
                <AttendanceChip status={a.status} />
                {a.regularized && <RegularizedTag reason={a.regularization_reason} />}
              </span>
            ) : (
              '—'
            )
          }
          alert={!!a?.is_late}
        />
      </div>
      {regularizes && (
        <div className="max-w-2xl space-y-2">
          <OkNote>{sent}</OkNote>
          <Button variant="outline" className="h-11 w-full min-[400px]:w-auto" onClick={() => setRegularizing(true)}>
            <ClipboardCheck /> Regularize a day
          </Button>
          <RegularizeDialog
            open={regularizing}
            onClose={() => setRegularizing(false)}
            onSent={(m) => {
              setSent(m);
              setRegularizing(false);
            }}
          />
        </div>
      )}
      {/* Phone app only (PLAN.md §19.32): nothing in a browser. */}
      {punches && <PunchReminderCard />}
      {p.camera}
    </div>
  );
}
