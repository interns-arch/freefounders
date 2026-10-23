/**
 * Attendance downloads (PLAN.md §19.31): what each Attendance screen downloads, built from the same query its list
 * hook sends, so the file has every row matching the screen's filters (the API applies them, and its scope).
 */
import type { ExportTarget } from '../export';
import type { AttendanceReportInput, TeamFilters } from './team';

const teamQuery = (f: TeamFilters) => ({ department: f.department || undefined, q: f.q?.trim() || undefined, inactive: f.inactive ? 1 : undefined });

export type TeamDayBucket = 'all' | 'in' | 'late' | 'missing' | 'leave' | 'off' | 'out';

export const hrExports = {
  /** My attendance (or a team member's month): one row per day. */
  month: (year: number, month: number, userId?: number): ExportTarget => ({ api: 'tasks', path: '/attendance/monthly/', query: { year, month, user: userId } }),
  /** My leave: all my requests. */
  myLeave: (): ExportTarget => ({ api: 'tasks', path: '/leaves/' }),
  /** Approvals: pending leave of the people I approve for. */
  pendingLeave: (): ExportTarget => ({ api: 'tasks', path: '/leaves/', query: { scope: 'team', status: 'pending' } }),
  /** Approvals: pending attendance corrections of the people I approve for. */
  pendingCorrections: (): ExportTarget => ({ api: 'tasks', path: '/attendance-corrections/', query: { scope: 'team', status: 'pending' } }),
  /** Live (no date) / Daily: everyone's day, narrowed by search, department and the status tile. */
  teamDay: (date: string | undefined, filters: TeamFilters, bucket: TeamDayBucket = 'all'): ExportTarget => ({
    api: 'tasks',
    path: '/attendance/team_day/',
    query: { date, ...teamQuery(filters), filter: bucket === 'all' ? undefined : bucket },
  }),
  /** Dashboard: per-person month totals in the screen's sort order. */
  teamMonth: (year: number, month: number, filters: TeamFilters, sort?: { key: string; dir: 'asc' | 'desc' }): ExportTarget => ({
    api: 'tasks',
    path: '/attendance/team_month/',
    query: { year, month, ...teamQuery(filters), sort: sort?.key, dir: sort?.dir },
  }),
  /** Reports: one of the attendance report files (the format goes as ?format=). */
  report: (r: Omit<AttendanceReportInput, 'format'>): ExportTarget => ({
    api: 'tasks',
    path: '/attendance/report/',
    param: 'format',
    query: { ...r, department: r.department || undefined },
  }),
};
