/**
 * Everyone's attendance for one day (PLAN.md §19.15): the list behind "Live team" (today, refreshed every minute) and
 * "Daily attendance" (any date). Tiles count and filter, search finds a name / phone / employee ID, HR marks a day by hand.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { type ManualMarkStatus, type TeamDayRow, useManualMark, useTeamDay } from '@freefounders/core/hr';
import { CalendarCheck, CalendarOff, ChevronLeft, ChevronRight, Clock3, LogOut, Palmtree, Radio, RefreshCw, UserRoundX } from '@/components/icons';
import { type ComponentType, type FormEvent, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, type Tone, fmtTime, todayLocal } from '../tasks/general/parts';
import { AttendanceChip, PunchPhoto, hrs } from './parts';

type Filter = 'all' | 'in' | 'late' | 'missing' | 'leave' | 'off' | 'out';

const IN = new Set(['present', 'late', 'half_day']);

function matches(r: TeamDayRow, f: Filter): boolean {
  switch (f) {
    case 'in':
      return IN.has(r.status ?? '');
    case 'late':
      return r.is_late || r.status === 'late';
    case 'missing':
      return r.status === 'not_checked_in' || r.status === 'absent';
    case 'leave':
      return r.status === 'leave';
    case 'off':
      return r.status === 'holiday' || r.status === 'week_off';
    case 'out':
      return !!r.check_out;
    default:
      return true;
  }
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const longDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Opens a person's month calendar (the existing My attendance view, for them). */
export function useOpenHistory(from: string) {
  const navigate = useNavigate();
  return (r: { user_id: number; name: string }) => navigate(`/attendance/history?user=${r.user_id}&name=${encodeURIComponent(r.name)}&from=${from}`);
}

export function TeamDayView({ live }: { live: boolean }) {
  const access = useAccess();
  const canMark = access.tasks.can('hr.mark');
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const asked = params.get('date');
  const date = live ? today : asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [marking, setMarking] = useState<TeamDayRow | null>(null);
  const [msg, setMsg] = useState('');
  const query = useTeamDay(live ? undefined : date, { q, department }, { refetchMs: live ? 60_000 : undefined });
  const openHistory = useOpenHistory(live ? 'team' : 'daily');
  const data = query.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const shown = useMemo(() => rows.filter((r) => matches(r, filter)), [rows, filter]);
  const count = (f: Filter) => rows.filter((r) => matches(r, f)).length;
  // Tiles and "Showing N of M staff" count everyone; the table draws the first 50 (weak phones), "Load more" adds the next.
  const more = useShowMore(shown, { reset: [live, date, q, department, filter] });
  const isToday = date === today;
  const future = date > today;
  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    if (d === today) next.delete('date');
    else next.set('date', d);
    setParams(next, { replace: true });
    setMsg('');
  };

  const tiles: Array<[Filter, string, ComponentType<{ className?: string }>, Tone]> = [
    ['in', 'Present', CalendarCheck, 'success'],
    ['late', 'Late', Clock3, 'warning'],
    ['missing', isToday ? 'Not checked in' : 'Absent', UserRoundX, isToday ? 'neutral' : 'danger'],
    ['leave', 'On leave', Palmtree, 'info'],
    ['off', 'Off / holiday', CalendarOff, 'neutral'],
    ['out', 'Checked out', LogOut, 'primary'],
  ];

  const columns: Column<TeamDayRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.name} className="size-8" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{r.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {[r.employee_code, r.designation].filter(Boolean).join(' · ') || r.username}
            </span>
          </span>
        </span>
      ),
    },
    { key: 'department', header: 'Department', cell: (r) => r.department || '—', hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.status ? (
          <span className="flex flex-wrap items-center gap-1">
            <AttendanceChip status={r.status} />
            {r.is_late && r.status !== 'late' && <Chip tone="warning">Late</Chip>}
            {r.is_early_checkout && <Chip tone="warning">Left early</Chip>}
            {r.missing_checkout && <Chip tone="danger">No check-out</Chip>}
          </span>
        ) : (
          <span className="text-muted-foreground">Upcoming</span>
        ),
    },
    {
      key: 'in',
      header: 'In',
      className: 'whitespace-nowrap font-mono tabular-nums',
      cell: (r) => (
        <span className="inline-flex items-center">
          {fmtTime(r.check_in)}
          {r.has_check_in_photo && <PunchPhoto id={r.attendance_id} which="in" label={`${r.name} check-in photo`} />}
        </span>
      ),
    },
    {
      key: 'out',
      header: 'Out',
      className: 'whitespace-nowrap font-mono tabular-nums',
      cell: (r) => (
        <span className="inline-flex items-center">
          {fmtTime(r.check_out)}
          {r.has_check_out_photo && <PunchPhoto id={r.attendance_id} which="out" label={`${r.name} check-out photo`} />}
        </span>
      ),
    },
    { key: 'hours', header: 'Hours', className: 'whitespace-nowrap font-mono tabular-nums', cell: (r) => hrs(r.working_minutes) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="outline" aria-label={`History of ${r.name}`} onClick={() => openHistory(r)}>
            History
          </Button>
          {canMark && !future && (
            <Button size="xs" variant="outline" aria-label={`Mark ${r.name}`} onClick={() => setMarking(r)}>
              Mark
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-6xl space-y-4">
      {!live && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2.5 py-2">
          <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft />
          </Button>
          <Input type="date" aria-label="Date" className="w-auto font-mono" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <Button size="icon-sm" variant="outline" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight />
          </Button>
          <Button size="sm" variant="ghost" disabled={isToday} onClick={() => setDate(today)}>
            Today
          </Button>
          <span className="text-sm font-medium text-muted-foreground max-sm:basis-full">
            {longDay(date)}
            {data?.holiday && ` · Holiday: ${data.holiday}`}
            {data && !data.holiday && data.week_off && ' · Week off'}
          </span>
        </div>
      )}
      {live && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Radio className="size-4 text-success" />
            Live · {longDay(today)}
          </span>
          <span>
            <span className="max-sm:hidden" aria-hidden>
              ·{' '}
            </span>
            updated {query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '…'}, refreshes every minute
          </span>
          <Button size="xs" variant="ghost" onClick={() => query.refetch()} loading={query.isFetching} aria-label="Refresh now">
            <RefreshCw /> Refresh
          </Button>
        </div>
      )}

      <div role="group" aria-label="Filter by status" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([f, label, Icon, tone]) => (
          <StatTile key={f} label={label} value={data ? count(f) : '…'} icon={Icon} tone={tone} pressed={filter === f} onClick={() => setFilter(filter === f ? 'all' : f)} />
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField label="Search staff" placeholder="Name, phone or employee ID" value={q} onChange={setQ} className="sm:w-72" />
        <NativeSelect aria-label="Department" className="sm:w-52" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {data?.departments.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
        <span className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
          {data ? `Showing ${shown.length} of ${rows.length} staff` : 'Loading…'}
          {filter !== 'all' && (
            <Button size="xs" variant="link" onClick={() => setFilter('all')}>
              Show everyone
            </Button>
          )}
        </span>
      </div>

      <OkNote>{msg}</OkNote>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data ? more.visible : undefined}
          rowKey={(r) => String(r.user_id)}
          loading={!data && !query.error}
          fetching={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={<EmptyState title={rows.length ? 'Nobody matches this filter' : 'Nobody to show'} description={rows.length ? 'Pick another tile or clear the search.' : 'Try another department or search.'} className="py-8" />}
        />
        {data && <ShowMore {...more.footer} noun="staff" className="border-t" />}
      </Card>
      {marking && (
        <MarkDialog
          row={marking}
          date={date}
          onClose={() => setMarking(null)}
          onDone={(text) => {
            setMarking(null);
            setMsg(text);
          }}
        />
      )}
    </div>
  );
}

/** A count that is also a filter button (pressed = the list shows only those people). */
function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  pressed,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  pressed: boolean;
  onClick: () => void;
}) {
  const bubble: Record<Tone, string> = {
    neutral: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/8 text-primary',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-info/12 text-info',
  };
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs transition-[border-color,box-shadow] outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40',
        pressed && 'border-primary ring-2 ring-primary/25',
      )}
    >
      <span className={cn('hidden size-9 shrink-0 items-center justify-center rounded-lg min-[400px]:flex', bubble[tone])}>
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[11px] leading-tight font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
        <span className="block font-mono text-xl leading-tight font-bold tabular-nums">{value}</span>
      </span>
    </button>
  );
}

/** HR: mark a day by hand (present / half day / absent), always with a reason that is kept on the record. */
function MarkDialog({ row, date, onClose, onDone }: { row: TeamDayRow; date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const mark = useManualMark();
  const [status, setStatus] = useState<ManualMarkStatus>(row.status === 'half_day' || row.status === 'absent' ? row.status : 'present');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const label = { present: 'present', half_day: 'half day', absent: 'absent' }[status];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!reason.trim()) return;
    mark.mutate({ user: row.user_id, status, reason: reason.trim(), date }, { onSuccess: () => onDone(`${row.name} marked ${label} for ${longDay(date)} ✅`) });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Mark {row.name}</DialogTitle>
            <DialogDescription>{longDay(date)}. The reason and your name are saved on the day.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="mark-status">Mark as</Label>
            <NativeSelect id="mark-status" value={status} onChange={(e) => setStatus(e.target.value as ManualMarkStatus)}>
              <option value="present">Present</option>
              <option value="half_day">Half day</option>
              <option value="absent">Absent</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mark-reason">Reason</Label>
            <Textarea id="mark-reason" rows={2} maxLength={120} placeholder="e.g. phone GPS not working" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={tried && !reason.trim()} aria-describedby={tried && !reason.trim() ? 'mark-reason-error' : undefined} />
            {tried && !reason.trim() && (
              <p id="mark-reason-error" className="text-sm text-destructive">
                Enter a reason.
              </p>
            )}
          </div>
          {mark.error && <ErrorNote>{errorMessage(mark.error)}</ErrorNote>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mark.isPending}>
              Mark {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** /attendance/daily: any date (?date=YYYY-MM-DD), past days with their final status. */
export function DailyTab() {
  return <TeamDayView live={false} />;
}
