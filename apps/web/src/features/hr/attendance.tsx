/** HR → My attendance: the month as a calendar, a day's punches (with photos) and correction requests. */
import { errorMessage } from '@freefounders/core';
import { ATTENDANCE_STATUS_LABELS, type AttendanceDay, useAttendanceMonth, useRequestCorrection } from '@freefounders/core/hr';
import { CalendarCheck, CalendarX, Clock3, ChevronLeft, ChevronRight, Palmtree, Sun, Timer } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, Panel, Tile, fmtDay, fmtTime } from '../tasks/general/parts';
import { AttendanceChip, PunchPhoto, STATUS_CELL, STATUS_DOT, STATUS_TEXT, hrs } from './parts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TAG: Record<string, string> = { present: '✓', late: 'L', half_day: '½', absent: '✗', leave: 'Lv', holiday: 'H', week_off: 'off' };

export function MonthView({ userId, userName }: { userId?: number; userName?: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selected, setSelected] = useState<AttendanceDay | null>(null);
  const [correcting, setCorrecting] = useState<AttendanceDay | null>(null);
  const [sent, setSent] = useState('');
  const q = useAttendanceMonth(year, month, userId);

  const shift = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
    setSelected(null);
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data;
  const t = data?.totals ?? {};

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2.5 py-2">
        <Button size="icon-sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <NativeSelect
          aria-label="Month"
          className="w-auto"
          value={month}
          onChange={(e) => {
            setMonth(Number(e.target.value));
            setSelected(null);
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Year"
          className="w-auto"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setSelected(null);
          }}
        >
          {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
        <Button size="icon-sm" variant="outline" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight />
        </Button>
        {userName && <span className="text-sm font-medium text-muted-foreground">· {userName}</span>}
        {data && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
            <Timer className="size-3.5" /> Total {data.total_hours} h
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <Tile icon={CalendarCheck} tone="success" label="Present" value={t.present || 0} />
        <Tile icon={Clock3} tone="warning" label="Late" value={t.late || 0} />
        <Tile icon={Sun} tone="warning" label="Half Day" value={t.half_day || 0} />
        <Tile icon={Palmtree} tone="info" label="Leave" value={t.leave || 0} />
        <Tile icon={CalendarX} tone="danger" label="Absent" value={t.absent || 0} alert={(t.absent ?? 0) > 0} />
        <Tile icon={Sun} tone="neutral" label="Week Off" value={t.week_off || 0} />
      </div>
      <OkNote>{sent}</OkNote>
      {!data ? (
        <Skeleton className="h-72" />
      ) : (
        <Calendar days={data.days} year={year} month={month} selected={selected} onSelect={(d) => setSelected(selected?.date === d.date ? null : d)} />
      )}
      {selected && selected.status && (
        <Panel
          icon={CalendarCheck}
          title={
            <>
              {new Date(`${selected.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              <AttendanceChip status={selected.status} extra={selected.holiday ? `: ${selected.holiday}` : ''} />
            </>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Check in</dt>
              <dd className="mt-0.5 flex items-center font-mono text-lg font-bold tabular-nums">
                {fmtTime(selected.check_in)}
                {selected.has_check_in_photo && <PunchPhoto key={`${selected.attendance_id}-in`} id={selected.attendance_id} which="in" label={`${userName ? `${userName} ` : ''}Check-in photo`} />}
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Check out</dt>
              <dd className="mt-0.5 flex items-center font-mono text-lg font-bold tabular-nums">
                {fmtTime(selected.check_out)}
                {selected.has_check_out_photo && <PunchPhoto key={`${selected.attendance_id}-out`} id={selected.attendance_id} which="out" label={`${userName ? `${userName} ` : ''}Check-out photo`} />}
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Worked</dt>
              <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums">{hrs(selected.working_minutes)}</dd>
            </div>
            {(selected.is_late || selected.is_early_checkout || selected.missing_checkout) && (
              <div className="flex items-center gap-3 sm:col-span-3">
                <dt className="text-muted-foreground">Flags</dt>
                <dd className="flex gap-1">
                  {selected.is_late && <Chip tone="warning">late</Chip>}
                  {selected.is_early_checkout && <Chip>early out</Chip>}
                  {selected.missing_checkout && <Chip tone="danger">no checkout</Chip>}
                </dd>
              </div>
            )}
          </dl>
          {!userId && ['present', 'late', 'half_day', 'absent'].includes(selected.status) && (
            <Button variant="outline" className="mt-3" onClick={() => setCorrecting(selected)}>
              Request a correction for this day
            </Button>
          )}
        </Panel>
      )}
      <Dialog open={!!correcting} onOpenChange={(o) => !o && setCorrecting(null)}>
        <DialogContent className="max-w-md">
          {correcting && (
            <CorrectionForm
              day={correcting}
              onClose={() => setCorrecting(null)}
              onSaved={() => {
                setSent(`Correction for ${fmtDay(correcting.date)} sent for approval.`);
                setCorrecting(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CorrectionForm({ day, onClose, onSaved }: { day: AttendanceDay; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ in: '', out: '', reason: '' });
  const save = useRequestCorrection();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        date: day.date,
        reason: f.reason,
        ...(f.in ? { requested_check_in: new Date(`${day.date}T${f.in}`).toISOString() } : {}),
        ...(f.out ? { requested_check_out: new Date(`${day.date}T${f.out}`).toISOString() } : {}),
      },
      { onSuccess: onSaved },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Correction request — {fmtDay(day.date)}</DialogTitle>
        <DialogDescription>Enter the times that were actually worked and why; your approver decides.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="c-in">Correct check-in</Label>
          <Input id="c-in" type="time" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-out">Correct check-out</Label>
          <Input id="c-out" type="time" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="c-reason">Reason *</Label>
        <Input id="c-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Forgot to check out" />
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.reason.trim() || (!f.in && !f.out)} loading={save.isPending}>
          Send request
        </Button>
      </DialogFooter>
    </form>
  );
}

function Calendar({ days, year, month, selected, onSelect }: { days: AttendanceDay[]; year: number; month: number; selected: AttendanceDay | null; onSelect: (d: AttendanceDay) => void }) {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Monday first
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return (
    <div className="rounded-2xl border bg-card p-2 shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] sm:p-3">
      <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {DOW.map((d, i) => (
          <div key={d} className={cn('py-1', i >= 5 && 'text-muted-foreground/70')}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`x${i}`} />
        ))}
        {days.map((d) => {
          const num = Number(d.date.slice(-2));
          const isToday = d.date === todayIso;
          const isSel = selected?.date === d.date;
          return (
            <button
              key={d.date}
              type="button"
              disabled={!d.status}
              onClick={() => onSelect(d)}
              aria-label={`${fmtDay(d.date)}${d.status ? `: ${ATTENDANCE_STATUS_LABELS[d.status]}` : ''}`}
              aria-pressed={isSel}
              className={cn(
                'relative flex aspect-square min-h-10 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border text-sm transition-[box-shadow,transform,border-color] disabled:cursor-default sm:aspect-auto sm:h-[4.25rem] sm:rounded-xl',
                STATUS_CELL[d.status ?? 'future'],
                d.status && 'hover:-translate-y-px hover:shadow-sm',
                !d.status && 'text-muted-foreground/70',
                isSel && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
              )}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full font-mono text-[13px] font-semibold tabular-nums',
                  isToday && 'bg-gradient-to-b from-brand-2 to-primary text-primary-foreground shadow-sm',
                )}
              >
                {num}
              </span>
              {d.status && <span className={cn('text-xs leading-none font-bold', STATUS_TEXT[d.status])}>{TAG[d.status]}</span>}
              {(d.is_late || d.missing_checkout) && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive ring-2 ring-card" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        {(['present', 'late', 'half_day', 'absent', 'leave', 'week_off'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2 py-0.5">
            <i className={cn('inline-block size-2 rounded-full', STATUS_DOT[s])} />
            {s === 'week_off' ? 'Off/Holiday' : ATTENDANCE_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2 py-0.5">
          <i className="inline-block size-2 rounded-full bg-destructive" /> Late / no checkout
        </span>
      </div>
    </div>
  );
}
