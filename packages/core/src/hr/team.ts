/**
 * Attendance for managers (PLAN.md §19.15): everyone's day (live / daily), everyone's month (dashboard), report files and
 * the attendance import. Scope is decided by the API: HR sees the company, an approver their team.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import type { AttendanceStatus } from './attendance';

export interface TeamFilters {
  department?: string;
  q?: string;
  /** Include people who are switched off. */
  inactive?: boolean;
}

export interface TeamPerson {
  user_id: number;
  name: string;
  username: string;
  employee_code: string;
  phone: string;
  department: string;
  department_code: string;
  designation: string;
  is_active: boolean;
}

export interface TeamDayRow extends TeamPerson {
  /** null: a future day with nothing recorded. */
  status: AttendanceStatus | null;
  check_in: string | null;
  check_out: string | null;
  working_minutes: number;
  is_late: boolean;
  is_early_checkout: boolean;
  missing_checkout: boolean;
  attendance_id: number | null;
  note: string;
  /** Answer to the uniform question at check-in; null when it was not asked. */
  uniform_ok?: boolean | null;
  has_check_in_photo: boolean;
  has_check_out_photo: boolean;
  /** Changed by an approved regularization (PLAN.md §19.38). Older servers leave these out. */
  regularized?: boolean;
  regularization_reason?: string;
  work_mode?: string;
  /** Punch-in reminders the server sent this day (PLAN.md §19.39). */
  reminders_sent?: number;
}

export interface TeamDepartment {
  code: string;
  name: string;
}

export interface TeamDay {
  date: string;
  is_today: boolean;
  holiday: string | null;
  week_off: boolean;
  rows: TeamDayRow[];
  departments: TeamDepartment[];
}

export interface TeamMonthRow extends TeamPerson {
  totals: Record<'present' | 'absent' | 'half_day' | 'late' | 'leave' | 'holiday' | 'week_off', number>;
  /** Present + late days. */
  present_days: number;
  /** Days with a late check-in (half days included). */
  late_marks: number;
  working_minutes: number;
  total_hours: number;
}

export interface TeamMonth {
  year: number;
  month: number;
  days: number;
  rows: TeamMonthRow[];
  departments: TeamDepartment[];
}

const filterQuery = (f: TeamFilters) => ({ department: f.department || undefined, q: f.q?.trim() || undefined, inactive: f.inactive ? 1 : undefined });

/** GET /attendance/team_day/?date — everyone's status for a day (today when no date). `refetchMs` keeps it live. */
export function useTeamDay(date: string | undefined, filters: TeamFilters = {}, opts: { refetchMs?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['hr', 'team-day', date ?? 'today', filters.department ?? '', filters.q?.trim() ?? '', !!filters.inactive],
    queryFn: () => tasksApi.get<TeamDay>('/attendance/team_day/', { date, ...filterQuery(filters) }),
    refetchInterval: opts.refetchMs,
    enabled: opts.enabled ?? true,
    placeholderData: (prev) => prev,
  });
}

/** GET /attendance/team_month/?year&month — per-person totals for a month. */
export function useTeamMonth(year: number, month: number, filters: TeamFilters = {}) {
  return useQuery({
    queryKey: ['hr', 'team-month', year, month, filters.department ?? '', filters.q?.trim() ?? '', !!filters.inactive],
    queryFn: () => tasksApi.get<TeamMonth>('/attendance/team_month/', { year, month, ...filterQuery(filters) }),
    placeholderData: (prev) => prev,
  });
}

export type AttendanceReportType = 'daily' | 'monthly_summary' | 'monthly_register' | 'late' | 'leave' | 'regularization';
export type ReportFormat = 'xlsx' | 'csv';

export const ATTENDANCE_REPORT_TYPES: Array<{ value: AttendanceReportType; label: string; period: 'date' | 'month' | 'range' }> = [
  { value: 'daily', label: 'Daily attendance', period: 'date' },
  { value: 'monthly_summary', label: 'Monthly summary', period: 'month' },
  { value: 'monthly_register', label: 'Monthly register (muster roll)', period: 'month' },
  { value: 'late', label: 'Late arrivals', period: 'range' },
  { value: 'leave', label: 'Leave register', period: 'range' },
  { value: 'regularization', label: 'Regularization requests', period: 'range' },
];

export interface AttendanceReportInput {
  type: AttendanceReportType;
  format: ReportFormat;
  date?: string;
  year?: number;
  month?: number;
  from?: string;
  to?: string;
  department?: string;
}

/** The file name the API gives the report (the download is a Blob, so the screen names it). */
export function attendanceReportFilename(r: AttendanceReportInput): string {
  const ym = `${r.year}-${String(r.month).padStart(2, '0')}`;
  const stem = {
    daily: `attendance-daily-${r.date}`,
    monthly_summary: `attendance-monthly-summary-${ym}`,
    monthly_register: `attendance-register-${ym}`,
    late: `attendance-late-${r.from}-to-${r.to}`,
    leave: `leave-register-${r.from}-to-${r.to}`,
    regularization: `attendance-regularization-${r.from}-to-${r.to}`,
  }[r.type];
  return `${stem}.${r.format}`;
}

/** GET /attendance/report/?type&format… — the report file as a Blob (needs the token, so not a plain link). */
export function useDownloadAttendanceReport() {
  return useMutation({
    mutationFn: async (r: AttendanceReportInput) => ({
      filename: attendanceReportFilename(r),
      blob: await tasksApi.blob('/attendance/report/', { ...r, department: r.department || undefined }),
    }),
  });
}

/** GET /attendance/import_template/?format — the empty import sheet (hr.manage). */
export function useImportTemplate() {
  return useMutation({
    mutationFn: async (format: ReportFormat) => ({
      filename: `attendance-import-template.${format}`,
      blob: await tasksApi.blob('/attendance/import_template/', { format }),
    }),
  });
}

export interface ImportRow {
  line: number;
  employee_id: string;
  user_id: number | null;
  name: string;
  date: string;
  status: string;
  check_in: string;
  check_out: string;
  note: string;
  ok: boolean;
  error: string;
}

export interface ImportResult {
  dry_run: boolean;
  rows: ImportRow[];
  created: number;
  updated: number;
  skipped: number;
  skipped_rows: Array<{ line: number; error: string }>;
}

/** POST /attendance/import/ (multipart: file, dry_run) — preview first (dry run), then apply. hr.manage only. */
export function useImportAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('dry_run', dryRun ? 'true' : 'false');
      return tasksApi.upload<ImportResult>('/attendance/import/', form);
    },
    onSuccess: (res) => {
      if (!res.dry_run) qc.invalidateQueries({ queryKey: ['hr'] });
    },
  });
}
