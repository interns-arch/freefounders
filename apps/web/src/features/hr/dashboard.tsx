/**
 * /attendance/dashboard (PLAN.md §19.15): one row per person for a month: present, absent, half days, late marks, leave,
 * week-offs/holidays and hours. Sort any column, open a person's month calendar, download the month or import attendance.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { type TeamMonthRow, useTeamMonth } from '@freefounders/core/hr';
import { ChevronLeft, ChevronRight, Download, Upload } from '@/components/icons';
import { useMemo, useState } from 'react';
import { type Column, DataTable } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { Avatar, Card, Switch } from '@/components/ui/primitives';
import { Chip, ErrorNote, OkNote } from '../tasks/general/parts';
import { useOpenHistory } from './daily';
import { ImportAttendanceDialog } from './import-dialog';
import { useReportDownload } from './reports';

type SortKey = 'name' | 'employee_code' | 'present' | 'absent' | 'half_day' | 'late' | 'leave' | 'off' | 'hours';

const value = (r: TeamMonthRow, k: SortKey): string | number => {
  switch (k) {
    case 'name':
      return r.name.toLowerCase();
    case 'employee_code':
      return r.employee_code.toLowerCase();
    case 'present':
      return r.present_days;
    case 'absent':
      return r.totals.absent;
    case 'half_day':
      return r.totals.half_day;
    case 'late':
      return r.late_marks;
    case 'leave':
      return r.totals.leave;
    case 'off':
      return r.totals.week_off + r.totals.holiday;
    case 'hours':
      return r.working_minutes;
  }
};

const num = (n: number, tone?: 'danger' | 'warning') =>
  n === 0 ? <span className="text-muted-foreground">0</span> : tone ? <span className={tone === 'danger' ? 'font-semibold text-destructive' : 'font-semibold text-warning'}>{n}</span> : n;

export function DashboardTab() {
  const access = useAccess();
  const canImport = access.tasks.can('hr.import');
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [inactive, setInactive] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState('');
  const query = useTeamMonth(ym.year, ym.month, { q, department, inactive });
  const report = useReportDownload();
  const openHistory = useOpenHistory('dashboard');
  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;
  const title = new Date(ym.year, ym.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const shift = (d: number) =>
    setYm(({ year, month }) => {
      const m = month + d;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    });

  const rows = useMemo(() => {
    const list = [...(query.data?.rows ?? [])];
    const k = sort.key as SortKey;
    list.sort((a, b) => {
      const x = value(a, k);
      const y = value(b, k);
      const c = x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
      return sort.dir === 'asc' ? c : -c;
    });
    return list;
  }, [query.data, sort]);
  // Sorted first, then the first 50 drawn (weak phones); a new month, filter or sort starts at the top again.
  const more = useShowMore(rows, { reset: [ym, q, department, inactive, sort] });

  const columns: Column<TeamMonthRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      sortKey: 'name',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.name} className="size-8" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="truncate">{r.name}</span>
              {!r.is_active && <Chip>Inactive</Chip>}
            </span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{[r.designation, r.department].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    { key: 'code', header: 'Employee ID', sortKey: 'employee_code', className: 'font-mono', hideOnMobile: true, cell: (r) => r.employee_code || '—' },
    { key: 'phone', header: 'Phone', className: 'font-mono whitespace-nowrap', hideOnMobile: true, cell: (r) => r.phone || '—' },
    { key: 'present', hideInCard: true, header: 'Present', sortKey: 'present', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.present_days) },
    { key: 'absent', hideInCard: true, header: 'Absent', sortKey: 'absent', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.totals.absent, 'danger') },
    { key: 'half', hideInCard: true, header: 'Half day', sortKey: 'half_day', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.totals.half_day) },
    { key: 'late', hideInCard: true, header: 'Late', sortKey: 'late', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.late_marks, 'warning') },
    { key: 'leave', hideInCard: true, header: 'Leave', sortKey: 'leave', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.totals.leave) },
    { key: 'off', hideInCard: true, header: 'Off / hol.', sortKey: 'off', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums', cell: (r) => num(r.totals.week_off + r.totals.holiday) },
    { key: 'hours', hideInCard: true, header: 'Hours', sortKey: 'hours', headerClassName: 'text-right', className: 'text-right font-mono tabular-nums whitespace-nowrap', cell: (r) => (r.working_minutes ? `${r.total_hours} h` : '—') },
    {
      // Phones (cards): the month on one line instead of seven.
      key: 'summary',
      header: 'Month',
      className: 'hidden',
      headerClassName: 'hidden',
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <Chip tone="success">P {r.present_days}</Chip>
          <Chip tone={r.totals.absent ? 'danger' : 'neutral'}>A {r.totals.absent}</Chip>
          {!!r.totals.half_day && <Chip tone="warning">H {r.totals.half_day}</Chip>}
          {!!r.late_marks && <Chip tone="warning">Late {r.late_marks}</Chip>}
          {!!r.totals.leave && <Chip tone="info">L {r.totals.leave}</Chip>}
          <Chip>Off {r.totals.week_off + r.totals.holiday}</Chip>
          {!!r.working_minutes && <Chip tone="primary">{r.total_hours} h</Chip>}
        </span>
      ),
    },
  ];

  const download = () => {
    setDone('');
    report
      .run({ type: 'monthly_summary', format: 'xlsx', year: ym.year, month: ym.month, department: department || undefined })
      .then((n) => setDone(`Downloaded ${n}`), () => undefined);
  };

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <h2 className="min-w-36 text-center text-[15px] font-bold tracking-tight" aria-live="polite">
            {title}
          </h2>
          <Button size="icon-sm" variant="ghost" aria-label="Next month" disabled={isCurrent} onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {canImport && (
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <Upload /> Import attendance
            </Button>
          )}
          <Button size="sm" onClick={download} loading={report.pending}>
            <Download /> Download report
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchField label="Search staff" placeholder="Name, phone or employee ID" value={q} onChange={setQ} className="sm:w-72" />
        <NativeSelect aria-label="Department" className="sm:w-52" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {query.data?.departments.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
        <div className="flex min-h-11 items-center gap-2">
          <Switch id="show-inactive" checked={inactive} onCheckedChange={setInactive} />
          <Label htmlFor="show-inactive" className="cursor-pointer">
            Show inactive staff
          </Label>
        </div>
        <span className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
          {query.data ? `Showing ${rows.length} staff` : 'Loading…'}
        </span>
      </div>

      {report.error && <ErrorNote>{errorMessage(report.error)}</ErrorNote>}
      <OkNote>{done}</OkNote>
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={query.data ? more.visible : undefined}
          rowKey={(r) => String(r.user_id)}
          loading={!query.data && !query.error}
          fetching={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          sort={sort}
          onSortChange={setSort}
          onRowClick={openHistory}
          empty={<EmptyState title="Nobody to show" description="Try another department, or clear the search." className="py-8" />}
        />
        {query.data && <ShowMore {...more.footer} noun="staff" className="border-t" />}
      </Card>
      <p className="text-xs text-muted-foreground">Present counts late days too; Late is the number of late check-ins. Click a person to open their month.</p>
      {importing && <ImportAttendanceDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
