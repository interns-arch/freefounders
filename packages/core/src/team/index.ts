// @kaampilot/core/team: Team 360 (PLAN.md §25): every employee as a tile, and one person's whole picture
// (performance, attendance, tasks, visitors). The Tasks API decides whom the viewer may see.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AttendanceMonth } from '../hr/attendance';
import type { LeaveBalance } from '../hr/leave';
import { tasksApi } from '../http';

export type Team360Scope = 'company' | 'department' | 'team';
export type Team360Range = 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'custom';
export const TEAM360_RANGES: Array<[Team360Range, string]> = [
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['custom', 'Custom'],
];

export interface Team360Areas {
  tasks: boolean;
  attendance: boolean;
  visitors: boolean;
}

export interface Team360Facts {
  id: number;
  name: string;
  username: string;
  employee_code: string;
  designation: string;
  department: string;
  department_code: string;
  manager: { id: number; name: string } | null;
  phone: string;
}

/** Today's status: a day classification (present, late, leave, absent…), "not_checked_in" today, or null (future). */
export type Team360DayStatus = 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'holiday' | 'week_off' | 'not_checked_in' | null;

export interface Team360Tile extends Team360Facts {
  is_self: boolean;
  today: {
    status: Team360DayStatus;
    check_in: string | null;
    check_out: string | null;
    is_late: boolean;
  } | null;
  month: {
    attendance_rate: number | null;
    present_days: number;
    working_days: number;
    late_days: number;
    leave_days: number;
    absent_days: number;
  } | null;
  tasks: { open: number; overdue: number; done_this_month: number } | null;
}

export interface Team360Tiles {
  scope: Team360Scope;
  areas: Team360Areas;
  today: string;
  month: { start: string; end: string };
  departments: Array<{ code: string; name: string }>;
  rows: Team360Tile[];
}

/** GET /team360/ — everyone the viewer may see, in one answer. */
export function useTeam360Tiles(enabled = true) {
  return useQuery({
    queryKey: ['team360', 'tiles'],
    queryFn: () => tasksApi.get<Team360Tiles>('/team360/'),
    enabled,
    staleTime: 60_000,
  });
}

export interface Team360Period {
  range: Team360Range;
  start: string;
  end: string;
}
export interface Team360PeriodInput {
  range: Team360Range;
  start?: string;
  end?: string;
}
const periodQuery = (p: Team360PeriodInput) => ({
  range: p.range,
  start: p.range === 'custom' ? p.start : undefined,
  end: p.range === 'custom' ? p.end : undefined,
});
const periodReady = (p: Team360PeriodInput) => p.range !== 'custom' || (!!p.start && !!p.end && p.start <= p.end);

export interface Team360Person extends Team360Facts {
  email: string;
  join_date: string | null;
  is_active: boolean;
  is_self: boolean;
  roles: string[];
  reports: number;
}

export interface Team360AttendanceKpis {
  attendance_rate: number | null;
  present_days: number;
  working_days: number;
  late_days: number;
  half_days: number;
  absent_days: number;
  leave_days: number;
  avg_minutes: number | null;
  total_hours: number;
  regularizations: { approved: number; pending: number; rejected: number };
  leave_requests: { approved: number; pending: number };
  leave_balances: LeaveBalance[];
  trend: Array<{
    label: string;
    start: string;
    end: string;
    attendance_rate: number | null;
    working_days: number;
    late_days: number;
  }>;
}

export interface Team360TaskKpis {
  assigned: number;
  completed: number;
  in_time: number;
  delayed: number;
  overdue: number;
  pending: number;
  on_time_rate: number | null;
  score: number | null;
  review: string | null;
  time_earned_minutes: number;
  mistakes: number;
  change_requests: { requests: number; rank: number | null; of: number };
  trend: Array<{
    label: string;
    start: string;
    end: string;
    completed: number;
    on_time: number;
    late: number;
  }>;
}

export interface Team360Summary {
  person: Team360Person;
  period: Team360Period;
  areas: Team360Areas;
  attendance: Team360AttendanceKpis | null;
  tasks: Team360TaskKpis | null;
}

/** GET /team360/:id/?range= — the header and the period's numbers. */
export function useTeam360Person(id: number | null, period: Team360PeriodInput) {
  return useQuery({
    queryKey: ['team360', 'person', id, periodQuery(period)],
    queryFn: () => tasksApi.get<Team360Summary>(`/team360/${id}/`, periodQuery(period)),
    enabled: id != null && periodReady(period),
    placeholderData: keepPreviousData,
  });
}

export interface Team360Regularization {
  id: number;
  date: string;
  reason: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  status_display: string;
  source: 'hr' | 'request';
  added_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  remarks: string;
  from_status: string;
  to_status: string;
}

export interface Team360Leave {
  id: number;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  half_day: boolean;
  status: string;
  status_display: string;
  reviewed_by: string | null;
  remarks: string;
}

export interface Team360AttendanceMonth extends AttendanceMonth {
  user: { id: number; name: string };
  can_see_photos: boolean;
  days: Array<
    AttendanceMonth['days'][number] & {
      place?: {
        office: string | null;
        lat: number | null;
        lng: number | null;
      } | null;
    }
  >;
  regularizations: Team360Regularization[];
  leaves: Team360Leave[];
  leave_balances: LeaveBalance[];
}

/** GET /team360/:id/attendance/?year&month — the month day by day, regularizations, leave. */
export function useTeam360Attendance(id: number | null, year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: ['team360', 'attendance', id, year, month],
    queryFn: () =>
      tasksApi.get<Team360AttendanceMonth>(`/team360/${id}/attendance/`, {
        year,
        month,
      }),
    enabled: id != null && enabled,
    placeholderData: keepPreviousData,
  });
}

export interface Team360Task {
  id: number;
  code: string;
  title: string;
  status: string;
  status_display: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  overdue: boolean;
  on_time: boolean | null;
  given_by: string | null;
  level?: number;
  root?: { id: number; code: string; title: string } | null;
  parts?: number;
}

export interface Team360Tasks {
  period: Team360Period;
  open: Team360Task[];
  open_more: boolean;
  completed: Team360Task[];
  completed_more: boolean;
  chains: Team360Task[];
  on_time_rate: number | null;
}

/** GET /team360/:id/tasks/?range= — open (overdue first), completed in the period, chains. */
export function useTeam360Tasks(id: number | null, period: Team360PeriodInput, enabled = true) {
  return useQuery({
    queryKey: ['team360', 'tasks', id, periodQuery(period)],
    queryFn: () => tasksApi.get<Team360Tasks>(`/team360/${id}/tasks/`, periodQuery(period)),
    enabled: id != null && enabled && periodReady(period),
    placeholderData: keepPreviousData,
  });
}

export interface Team360Visit {
  id: number;
  name: string;
  company: string;
  purpose: string;
  people: number;
  status: string;
  status_display: string;
  location: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  created_at: string;
}

/** GET /team360/:id/visitors/?range= — visits they hosted (no visitor phone or ID). */
export function useTeam360Visitors(id: number | null, period: Team360PeriodInput, enabled = true) {
  return useQuery({
    queryKey: ['team360', 'visitors', id, periodQuery(period)],
    queryFn: () => tasksApi.get<{ period: Team360Period; rows: Team360Visit[] }>(`/team360/${id}/visitors/`, periodQuery(period)),
    enabled: id != null && enabled && periodReady(period),
    placeholderData: keepPreviousData,
  });
}
