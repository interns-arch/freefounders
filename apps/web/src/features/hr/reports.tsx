/**
 * /attendance/reports (PLAN.md §19.15): pick a report, a period, a department and XLSX or CSV, and download it now.
 * "Recent downloads" are remembered on this device only (last 10) with "Download again".
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { ATTENDANCE_REPORT_TYPES, type AttendanceReportInput, type AttendanceReportType, type ReportFormat, useDownloadAttendanceReport, useTeamDay } from '@freefounders/core/hr';
import { Download, FileSpreadsheet, History, Upload } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { ErrorNote, OkNote, Panel, Segmented, todayLocal } from '../tasks/general/parts';
import { downloadBlob } from '../tasks/shared/csv';
import { addDays } from './daily';
import { ImportAttendanceDialog } from './import-dialog';

const KEY = 'ff-attendance-reports';

const HINT: Record<AttendanceReportType, string> = {
  daily: 'Everyone on one day: status, check in and out, hours, late and early flags.',
  monthly_summary: 'One row per person: present, late, half days, absent, leave, week-offs, holidays and hours.',
  monthly_register: 'The muster roll: one row per person, one column per day (P, A, H, L, WO, HO).',
  late: 'Every late check-in in the period, with how many minutes late.',
  leave: 'Leave requests that touch the period, with their type, days and status.',
};

interface Recent extends AttendanceReportInput {
  at: string;
  label: string;
  period: string;
}

function readRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.slice(0, 10) : [];
  } catch {
    return [];
  }
}

const dmy = (d?: string) => (d ? d.split('-').reverse().join('-') : '');
const monthName = (y?: number, m?: number) => (y && m ? new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '');

export function periodText(r: AttendanceReportInput): string {
  const kind = ATTENDANCE_REPORT_TYPES.find((t) => t.value === r.type)?.period;
  if (kind === 'date') return dmy(r.date);
  if (kind === 'month') return monthName(r.year, r.month);
  return `${dmy(r.from)} to ${dmy(r.to)}`;
}

/** Downloads a report and remembers it in "Recent downloads" on this device. */
export function useReportDownload() {
  const dl = useDownloadAttendanceReport();
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const run = async ({ type, format, date, year, month, from, to, department }: AttendanceReportInput) => {
    const r: AttendanceReportInput = { type, format, date, year, month, from, to, department };
    const { filename, blob } = await dl.mutateAsync(r);
    downloadBlob(filename, blob);
    const entry: Recent = { ...r, at: new Date().toISOString(), label: ATTENDANCE_REPORT_TYPES.find((t) => t.value === r.type)?.label ?? r.type, period: periodText(r) };
    const next = [entry, ...readRecent()].slice(0, 10);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private window: the list just isn't kept */
    }
    setRecent(next);
    return filename;
  };
  return { run, recent, pending: dl.isPending, error: dl.error };
}

export function ReportsTab() {
  const access = useAccess();
  const canImport = access.tasks.can('hr.manage');
  const [params] = useSearchParams();
  const today = todayLocal();
  const asked = params.get('type') as AttendanceReportType | null;
  const [type, setType] = useState<AttendanceReportType>(ATTENDANCE_REPORT_TYPES.some((t) => t.value === asked) ? asked! : 'daily');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [department, setDepartment] = useState('');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [done, setDone] = useState('');
  const [importing, setImporting] = useState(false);
  const day = useTeamDay(undefined);
  const { run, recent, pending, error } = useReportDownload();
  const period = ATTENDANCE_REPORT_TYPES.find((t) => t.value === type)!.period;
  const rangeBad = period === 'range' && (!from || !to || to < from || to > addDays(from, 365));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (rangeBad) return;
    setDone('');
    const [y, m] = month.split('-').map(Number);
    const input: AttendanceReportInput = {
      type,
      format,
      department: department || undefined,
      ...(period === 'date' ? { date } : period === 'month' ? { year: y, month: m } : { from, to }),
    };
    const name = await run(input).catch(() => null);
    if (name) setDone(`Downloaded ${name}`);
  };

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Panel icon={FileSpreadsheet} title="Download a report" description="The file is made now from the latest attendance, for the people you manage.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="report-type">Report type</Label>
            <NativeSelect id="report-type" value={type} onChange={(e) => setType(e.target.value as AttendanceReportType)}>
              {ATTENDANCE_REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-[13px] text-muted-foreground">{HINT[type]}</p>
          </div>
          {period === 'date' && (
            <div className="grid gap-1.5">
              <Label htmlFor="report-date">Date</Label>
              <Input id="report-date" type="date" max={today} value={date} required onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
          {period === 'month' && (
            <div className="grid gap-1.5">
              <Label htmlFor="report-month">Month</Label>
              <Input id="report-month" type="month" max={today.slice(0, 7)} value={month} required onChange={(e) => setMonth(e.target.value)} />
            </div>
          )}
          {period === 'range' && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="report-from">From</Label>
                <Input id="report-from" type="date" value={from} required onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="report-to">To</Label>
                <Input id="report-to" type="date" value={to} required aria-invalid={rangeBad} aria-describedby={rangeBad ? 'report-range-error' : undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
              {rangeBad && (
                <p id="report-range-error" className="text-sm text-destructive sm:col-span-2">
                  Pick an end date on or after the start date, at most a year later.
                </p>
              )}
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="report-department">Department</Label>
            <NativeSelect id="report-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {day.data?.departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Format</span>
            <Segmented
              className="w-fit"
              label="Format"
              value={format}
              onChange={setFormat}
              options={[
                ['xlsx', 'Excel (XLSX)'],
                ['csv', 'CSV'],
              ]}
            />
          </div>
          {error && <ErrorNote className="sm:col-span-2">{errorMessage(error)}</ErrorNote>}
          <OkNote className="sm:col-span-2">{done}</OkNote>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" loading={pending} disabled={rangeBad}>
              <Download /> Download
            </Button>
            {canImport && (
              <Button type="button" variant="outline" onClick={() => setImporting(true)}>
                <Upload /> Import attendance
              </Button>
            )}
          </div>
        </form>
      </Panel>
      <Panel icon={History} tone="neutral" title="Recent downloads" description="Kept on this device only.">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Reports you download show here.</p>
        ) : (
          <ul className="divide-y" aria-label="Recent downloads">
            {recent.map((r) => (
              <li key={r.at} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.period} · {r.format.toUpperCase()} · {new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <Button size="xs" variant="outline" disabled={pending} aria-label={`Download again: ${r.label}, ${r.period}, ${r.format.toUpperCase()}`} onClick={() => run(r).then((n) => setDone(`Downloaded ${n}`), () => undefined)}>
                  Download again
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {importing && <ImportAttendanceDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
