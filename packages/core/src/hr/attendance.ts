/** Attendance: today, check in/out, the monthly view, corrections, team today, punch photos (old pages/HR.jsx). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { UserBrief } from '../tasks/types';

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'late' | 'leave' | 'holiday' | 'week_off' | 'not_checked_in';
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  late: 'Late',
  leave: 'Leave',
  holiday: 'Holiday',
  week_off: 'Week Off',
  not_checked_in: 'Not checked in',
};
export type PhotoMode = 'off' | 'optional' | 'required';

export interface HrConfig {
  geofence_enabled: boolean;
  face_enabled: boolean;
  work_start: string;
  work_end: string;
  week_offs: number[];
  /** May approve leave/corrections (hr.approve, or a manager under the "manager first" rule). */
  can_approve: boolean;
  can_manage: boolean;
}

/** GET /hr/config/ */
export function useHrConfig() {
  return useQuery({ queryKey: ['hr', 'config'], queryFn: () => tasksApi.get<HrConfig>('/hr/config/'), staleTime: 60_000 });
}

export interface AttendanceRecord {
  id: number;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  status_display: string;
  working_minutes: number;
  is_late: boolean;
  is_early_checkout: boolean;
  missing_checkout: boolean;
  has_check_in_photo: boolean;
  has_check_out_photo: boolean;
}

export interface AttendanceToday {
  attendance: AttendanceRecord | null;
  can_check_in: boolean;
  can_check_out: boolean;
  geofence_enabled: boolean;
  face_enabled: boolean;
  face_self_enroll: boolean;
  face_enrolled: boolean;
  work_start: string;
  work_end: string;
  photo: PhotoMode;
}

/** GET /attendance/today/ */
export function useAttendanceToday() {
  return useQuery({ queryKey: ['hr', 'today'], queryFn: () => tasksApi.get<AttendanceToday>('/attendance/today/') });
}

export interface MarkInput {
  latitude?: number;
  longitude?: number;
  /** 128 numbers from the face check (never an image). */
  face_descriptor?: number[];
  /** JPEG data URL, when the company keeps a photo of every punch. */
  photo?: string;
}

/** POST /attendance/check_in/ or /attendance/check_out/ — every rule (geofence, face, photo) is decided by the server. */
export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ which, ...body }: MarkInput & { which: 'check_in' | 'check_out' }) => tasksApi.post(`/attendance/${which}/`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

export interface AttendanceDay {
  date: string;
  status: Exclude<AttendanceStatus, 'not_checked_in'> | null;
  holiday?: string | null;
  check_in: string | null;
  check_out: string | null;
  working_minutes: number;
  is_late: boolean;
  is_early_checkout: boolean;
  missing_checkout: boolean;
  attendance_id?: number | null;
  has_check_in_photo?: boolean;
  has_check_out_photo?: boolean;
}

export interface AttendanceMonth {
  year: number;
  month: number;
  days: AttendanceDay[];
  totals: Partial<Record<AttendanceStatus, number>>;
  total_hours: number;
}

/** GET /attendance/monthly/?year&month(&user) — my month, or a team member's. */
export function useAttendanceMonth(year: number, month: number, userId?: number) {
  return useQuery({
    queryKey: ['hr', 'monthly', year, month, userId ?? null],
    queryFn: () => tasksApi.get<AttendanceMonth>('/attendance/monthly/', { year, month, user: userId }),
  });
}

export interface AttendanceCorrection {
  id: number;
  user: number;
  user_detail: UserBrief;
  date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  status_display: string;
  reviewed_by_detail: UserBrief | null;
  remarks: string;
  created_at: string;
}

/** POST /attendance-corrections/ */
export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; reason: string; requested_check_in?: string; requested_check_out?: string }) => tasksApi.post('/attendance-corrections/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

/** Pending corrections of the people I approve for. */
export function usePendingCorrections(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'corrections', 'pending'],
    queryFn: () =>
      tasksApi
        .get<DrfPage<AttendanceCorrection> | AttendanceCorrection[]>('/attendance-corrections/', { scope: 'team', page_size: 100 })
        .then(resultsOf)
        .then((rows) => rows.filter((c) => c.status === 'pending')),
    enabled,
  });
}

export interface TeamTodayRow {
  user_id: number;
  name: string;
  department: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  working_minutes: number;
  attendance_id: number | null;
  has_check_in_photo: boolean;
  has_check_out_photo: boolean;
}

export interface TeamToday {
  date: string;
  counts: Partial<Record<AttendanceStatus, number>>;
  rows: TeamTodayRow[];
}

/** GET /attendance/team_today/ */
export function useTeamToday(enabled = true) {
  return useQuery({ queryKey: ['hr', 'team-today'], queryFn: () => tasksApi.get<TeamToday>('/attendance/team_today/'), enabled });
}

/** POST /attendance/manual_mark/ {user, status, reason} (hr.manage). */
export function useManualMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { user: number; status: 'present'; reason: string }) => tasksApi.post('/attendance/manual_mark/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

/** GET /attendance/:id/photo/in|out/ — a punch photo, loaded with the sign-in token (never a public URL). */
export function usePunchPhoto(attendanceId: number | null | undefined, which: 'in' | 'out') {
  return useQuery({
    queryKey: ['hr', 'photo', attendanceId, which],
    queryFn: () => tasksApi.blob(`/attendance/${attendanceId}/photo/${which}/`),
    enabled: attendanceId != null,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
