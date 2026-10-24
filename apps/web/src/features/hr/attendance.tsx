/** HR → My attendance: the month as a calendar, a day's punches (with photos) and regularization requests (PLAN.md §19.38). */
import { ATTENDANCE_STATUS_LABELS, type AttendanceDay, type AttendanceStatus, hrExports, useAttendanceMonth, useMyRegularizations } from '@freefounders/core/hr';
import { fileSlug } from '@freefounders/core/export';
import { AlertCircle, CalendarCheck, ClipboardCheck, CalendarX, Clock3, ChevronLeft, ChevronRight, Palmtree, Sun, Timer } from '@/components/icons';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DownloadMenu } from '@/components/common/download-menu';
import { ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, OkNote, Panel, Tile, fmtDay, fmtTime, todayLocal } from '../tasks/general/parts';
import { AttendanceChip, PunchPhoto, STATUS_CELL, STATUS_TEXT, UniformChip, hrs } from './parts';
import { RegularizeDialog, RegularizedTag } from './regularize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TAG: Record<string, string> = { present: '✓', late: 'L', half_day: '½', absent: '✗', leave: 'Lv', holiday: 'H', week_off: 'off' };

export function MonthView({ userId, userName }: { userId?: number; userName?: string }) {
  const today = new Date();
  // From a notification (PLAN.md §19.37): ?date=YYYY-MM-DD opens that day's month with the day selected.
  const [params] = useSearchParams();
  const askedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : null;
  const [year, setYear] = useState(askedDay ? Number(askedDay.slice(0, 4)) : today.getFullYear());
  const [month, setMonth] = useState(askedDay ? Number(askedDay.slice(5, 7)) : today.getMonth() + 1);
  const [selected, setSelected] = useState<AttendanceDay | null>(null);
  const [regularizing, setRegularizing] = useState<AttendanceDay | null>(null);
  const [sent, setSent] = useState('');
  const q = useAttendanceMonth(year, month, userId);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (askedDay && !opened && q.data) {
      setSelected(q.data.days.find((d) => d.date === askedDay) ?? null);
      setOpened(true);
    }
  }, [askedDay, opened, q.data]);
  // Keep the open day in step with the month after a request is sent (its request status changes).
  const shown = selected ? (q.data?.days.find((d) => d.date === selected.date) ?? selected) : null;

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
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-primary/8 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
              <Timer className="size-3.5" /> Total {data.total_hours} h
            </span>
          )}
          <DownloadMenu
            filename={fileSlug('attendance', userName ?? 'my-attendance', `${year}-${String(month).padStart(2, '0')}`)}
            target={hrExports.month(year, month, userId)}
            loading={!data}
            empty={!!data && !data.days.length}
          />
        </div>
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
      {shown && shown.status && (
        <Panel
          icon={CalendarCheck}
          title={
            <>
              {new Date(`${shown.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              <AttendanceChip status={shown.status} extra={shown.holiday ? `: ${shown.holiday}` : ''} />
              {shown.regularized && <RegularizedTag reason={shown.regularization_reason} mode={shown.work_mode} />}
            </>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Check in</dt>
              <dd className="mt-0.5 flex items-center font-mono text-lg font-bold tabular-nums">
                {fmtTime(shown.check_in)}
                {shown.has_check_in_photo && <PunchPhoto key={`${shown.attendance_id}-in`} id={shown.attendance_id} which="in" label={`${userName ? `${userName} ` : ''}Check-in photo`} />}
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Check out</dt>
              <dd className="mt-0.5 flex items-center font-mono text-lg font-bold tabular-nums">
                {fmtTime(shown.check_out)}
                {shown.has_check_out_photo && <PunchPhoto key={`${shown.attendance_id}-out`} id={shown.attendance_id} which="out" label={`${userName ? `${userName} ` : ''}Check-out photo`} />}
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">
              <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Worked</dt>
              <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums">{hrs(shown.working_minutes)}</dd>
            </div>
            {shown.uniform_ok != null && (
              <div className="flex items-center gap-3 sm:col-span-3">
                <dt className="text-muted-foreground">Uniform</dt>
                <dd>
                  <UniformChip ok={shown.uniform_ok} />
                </dd>
              </div>
            )}
            {(shown.is_late || shown.is_early_checkout || shown.missing_checkout) && (
              <div className="flex items-center gap-3 sm:col-span-3">
                <dt className="text-muted-foreground">Flags</dt>
                <dd className="flex gap-1">
                  {shown.is_late && <Chip tone="warning">late</Chip>}
                  {shown.is_early_checkout && <Chip>early out</Chip>}
                  {shown.missing_checkout && <Chip tone="danger">no checkout</Chip>}
                </dd>
              </div>
            )}
            {shown.regularized && shown.regularization_reason && (
              <div className="flex items-center gap-3 sm:col-span-3">
                <dt className="text-muted-foreground">Regularized</dt>
                <dd>{shown.regularization_reason}</dd>
              </div>
            )}
            {shown.request && (
              <div className="flex items-center gap-3 sm:col-span-3">
                <dt className="text-muted-foreground">Request</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {shown.request.reason_label}
                  <Chip tone={shown.request.status === 'pending' ? 'warning' : shown.request.status === 'approved' ? 'success' : 'danger'}>{shown.request.status}</Chip>
                </dd>
              </div>
            )}
          </dl>
          {!userId && ['present', 'late', 'half_day', 'absent'].includes(shown.status) && shown.date <= todayLocal() && (
            <Button variant="outline" className="mt-3 w-full sm:w-auto" disabled={shown.request?.status === 'pending'} onClick={() => setRegularizing(shown)}>
              {shown.request?.status === 'pending' ? 'Regularization waiting for approval' : 'Regularize this day'}
            </Button>
          )}
        </Panel>
      )}
      {!userId && <MyRegularizations />}
      <RegularizeDialog
        open={!!regularizing}
        day={regularizing}
        onClose={() => setRegularizing(null)}
        onSent={(m) => {
          setSent(m);
          setRegularizing(null);
        }}
      />
    </div>
  );
}

const statusText = (s: string) => (s ? (ATTENDANCE_STATUS_LABELS[s as AttendanceStatus] ?? s) : '—');

/** My regularization requests: what was asked, the decision (who, when, comment) and the from → to (PLAN.md §19.38). */
function MyRegularizations() {
  const q = useMyRegularizations();
  const rows = q.data ?? [];
  if (!q.data || !rows.length) return null;
  return (
    <Panel
      icon={ClipboardCheck}
      tone="neutral"
      title="My regularization requests"
      actions={<DownloadMenu filename={fileSlug('regularization', 'my-requests')} target={hrExports.myRegularizations()} loading={!q.data} empty={!rows.length} />}
    >
      <ul className="divide-y" aria-label="My regularization requests">
        {rows.slice(0, 30).map((r) => (
          <li key={r.id} className="grid gap-1 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <strong className="font-semibold">{fmtDay(r.date)}</strong>
              <span className="text-muted-foreground">{r.reason_label}</span>
              <Chip tone={r.status === 'pending' ? 'warning' : r.status === 'approved' ? 'success' : 'danger'} className="ml-auto">
                {r.status_display}
              </Chip>
            </div>
            <div className="font-mono text-xs text-muted-foreground tabular-nums">
              Asked: in {r.requested_check_in ? fmtTime(r.requested_check_in) : 'as recorded'} · out {r.requested_check_out ? fmtTime(r.requested_check_out) : 'as recorded'}
            </div>
            {r.status === 'approved' && (
              <div className="font-mono text-xs tabular-nums">
                {fmtTime(r.original_check_in)}–{fmtTime(r.original_check_out)} {statusText(r.original_status)} → {fmtTime(r.requested_check_in ?? r.original_check_in)}–{fmtTime(r.requested_check_out ?? r.original_check_out)} {statusText(r.applied_status)}
              </div>
            )}
            {r.reviewed_by_detail && (
              <div className="text-xs text-muted-foreground">
                {r.status_display} by {r.reviewed_by_detail.name}
                {r.reviewed_at ? `, ${new Date(r.reviewed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                {r.remarks ? ` — “${r.remarks}”` : ''}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Calendar({ days, year, month, selected, onSelect }: { days: AttendanceDay[]; year: number; month: number; selected: AttendanceDay | null; onSelect: (d: AttendanceDay) => void }) {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Monday first
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return (
    <div className="rounded-2xl border bg-card p-2 shadow-card sm:p-3">
      <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[11px] font-semibold tracking-[0.08em] text-foreground/80 uppercase">
        {DOW.map((d, i) => (
          <div key={d} className={cn('py-1', i >= 5 && 'text-muted-foreground')}>
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
              aria-label={`${fmtDay(d.date)}${d.status ? `: ${ATTENDANCE_STATUS_LABELS[d.status]}` : ''}${d.regularized ? ', regularized' : ''}`}
              aria-pressed={isSel}
              className={cn(
                'relative flex aspect-square min-h-10 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border text-sm transition-[box-shadow,transform,border-color] disabled:cursor-default sm:aspect-auto sm:h-[4.25rem] sm:rounded-xl',
                STATUS_CELL[d.status ?? 'future'],
                d.status && 'hover:shadow-sm',
                !d.status && 'text-muted-foreground',
                isSel && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
              )}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full font-mono text-[13px] font-semibold tabular-nums',
                  isToday && 'bg-primary text-primary-foreground shadow-sm',
                )}
              >
                {num}
              </span>
              {d.status && <span className={cn('text-xs leading-none font-bold', STATUS_TEXT[d.status])}>{TAG[d.status]}</span>}
              {(d.is_late || d.missing_checkout) && <AlertCircle className="absolute top-1 right-1 size-3 text-destructive" />}
              {d.regularized && (
                <span
                  className="absolute top-0.5 left-0.5 rounded-xs border border-primary/25 bg-primary/8 px-0.5 text-[9px] leading-3 font-bold text-primary sm:px-1 sm:text-[10px]"
                  title={`Regularized: ${d.regularization_reason ?? ''}`}
                  aria-hidden
                >
                  <span className="sm:hidden">R</span>
                  <span className="hidden sm:inline">Regularized</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        {(['present', 'late', 'half_day', 'absent', 'leave', 'week_off'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-sm border bg-muted/30 py-0.5 pr-2 pl-0.5">
            <span className={cn('inline-grid h-4 min-w-5 place-items-center rounded-xs border px-0.5 text-[11px] leading-none font-bold', STATUS_CELL[s], STATUS_TEXT[s])} aria-hidden>
              {TAG[s]}
            </span>
            {s === 'week_off' ? 'Off/Holiday' : ATTENDANCE_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-sm border bg-muted/30 px-2 py-0.5">
          <AlertCircle className="size-3 text-destructive" /> Late / no checkout
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-sm border bg-muted/30 py-0.5 pr-2 pl-0.5">
          <span className="inline-grid h-4 min-w-5 place-items-center rounded-xs border border-primary/25 bg-primary/8 px-0.5 text-[10px] leading-none font-bold text-primary" aria-hidden>
            R
          </span>
          Regularized
        </span>
      </div>
    </div>
  );
}
