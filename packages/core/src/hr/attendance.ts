/** Attendance: today, check in/out, the monthly view, corrections, manual mark, punch photos (old pages/HR.jsx). Team views: team.ts. */
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
  work_start: string;
  work_end: string;
  week_offs: number[];
  /** May approve leave/corrections (hr.approve, or a manager under the "manager first" rule). */
  can_approve: boolean;
  /** HR settings (hr.settings). */
  can_manage: boolean;
  /** The managers' attendance screens this person may open: their permissions, plus their own team under the "manager approves" rule (PLAN.md §19.19). */
  screens?: Partial<Record<'live' | 'daily' | 'dashboard' | 'reports', boolean>>;
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
  /** JPEG data URL, when the company keeps a photo of every punch. */
  photo?: string;
}

/** POST /attendance/check_in/ or /attendance/check_out/ — every rule (geofence, photo) is decided by the server. No face check (§19.18). */
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

export type ManualMarkStatus = 'present' | 'half_day' | 'absent';

/** POST /attendance/manual_mark/ {user, status, reason, date?} (hr.manage). `date` (YYYY-MM-DD, today or earlier) defaults to today. */
export function useManualMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { user: number; status: ManualMarkStatus; reason: string; date?: string }) => tasksApi.post('/attendance/manual_mark/', body),
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

/** Metres between two points (haversine). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/**
 * The closest active office to a position, how far it is and whether that is inside its radius (PLAN.md §19.2).
 * Only a hint for the screen: the server decides the location check at punch time.
 */
export function nearestOffice<O extends { name: string; latitude: number; longitude: number; radius_m: number; active: boolean }>(
  pos: { latitude: number; longitude: number },
  offices: O[],
): { office: O; metres: number; inside: boolean } | null {
  let best: { office: O; metres: number; inside: boolean } | null = null;
  for (const o of offices) {
    if (!o.active) continue;
    const metres = distanceMetres(pos, o);
    if (!best || metres < best.metres) best = { office: o, metres, inside: metres <= o.radius_m };
  }
  return best;
}
