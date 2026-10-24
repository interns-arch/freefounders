/** Attendance: today, check in/out, the monthly view, regularization (PLAN.md §19.38), manual mark, punch photos (old pages/HR.jsx). Team views: team.ts. */
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
/** Uniform question before a check-in (PLAN.md §19.27): off, a reminder only, or ask and save the answer. */
export type UniformCheck = 'off' | 'remind' | 'ask';
export const UNIFORM_MESSAGE_DEFAULT = 'Are you wearing the company shirt / jersey today?';
/** "Must confirm" mode: the answer No blocks the punch (PLAN.md §19.36); the API answers the same text. */
export const UNIFORM_NOT_WORN = 'Please wear the company shirt / jersey, then punch in.';

/** Why a check-in / check-out was refused (`code` next to `detail` in the 400 answer, PLAN.md §19.36). */
export interface PunchRefusal {
  detail: string;
  code?: 'uniform_required' | 'uniform_not_worn' | 'outside_office' | 'location_inaccurate' | 'location_required' | 'no_office';
  office?: string;
  distance_m?: number;
  radius_m?: number;
  accuracy_m?: number;
}

/** Punch-in reminders (PLAN.md §19.39): `count` reminders, `gap_minutes` apart, the first `first_after_minutes` after the reporting time. */
export interface PunchReminderRule {
  enabled: boolean;
  count: number;
  gap_minutes: number;
  first_after_minutes: number;
  /** "HH:MM" = work start. */
  reporting_time: string;
}

export interface HrConfig {
  geofence_enabled: boolean;
  work_start: string;
  work_end: string;
  week_offs: number[];
  /** Uniform check at punch-in and the message shown (PLAN.md §19.27). Older servers leave them out (= off). */
  uniform_check?: UniformCheck;
  uniform_message?: string;
  /** The company's punch-in reminder rule (PLAN.md §19.39); older servers leave it out. */
  punch_reminders?: PunchReminderRule;
  /** May approve leave/corrections (hr.approve, or a manager under the "manager first" rule). */
  can_approve: boolean;
  /** Decides regularizations: approvers, and anyone people report to (PLAN.md §19.38). */
  can_approve_regularization?: boolean;
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
  /** Answer to the uniform question at check-in; null when it was not asked. */
  uniform_ok?: boolean | null;
  /** Changed by an approved regularization (PLAN.md §19.38). */
  regularized?: boolean;
  regularization_reason?: string;
}

export interface AttendanceToday {
  attendance: AttendanceRecord | null;
  can_check_in: boolean;
  can_check_out: boolean;
  geofence_enabled: boolean;
  work_start: string;
  work_end: string;
  photo: PhotoMode;
  uniform_check?: UniformCheck;
  uniform_message?: string;
  /** Punch-in reminders (PLAN.md §19.39): the rule, why today needs none, and how many the server sent today. */
  punch_reminders?: PunchReminderRule;
  day_off?: 'holiday' | 'week_off' | 'leave' | null;
  reminders_sent?: number;
}

/** GET /attendance/today/ */
export function useAttendanceToday(enabled = true) {
  return useQuery({ queryKey: ['hr', 'today'], queryFn: () => tasksApi.get<AttendanceToday>('/attendance/today/'), enabled });
}

export interface MarkInput {
  latitude?: number;
  longitude?: number;
  /** JPEG data URL, when the company keeps a photo of every punch. */
  photo?: string;
  /** Check-in only, when the company asks (uniform_check 'ask'): wearing the company shirt / jersey? Only true punches in. */
  uniform?: boolean;
  /** The phone's GPS accuracy in metres (a rough fix near the office is refused as "not accurate enough", §19.36). */
  accuracy?: number;
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
  uniform_ok?: boolean | null;
  /** Changed by an approved regularization (PLAN.md §19.38): the "Regularized" tag, its reason, On duty / WFH. */
  regularized?: boolean;
  regularization_id?: number | null;
  regularization_reason?: string;
  work_mode?: string;
  /** The latest regularization request for the day (any status). */
  request?: { id: number; status: RegularizationStatus; reason_label: string } | null;
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

/** Why a day needs regularizing (PLAN.md §19.38); the company picks which ones its people may use. */
export type RegularizationReason = 'forgot_in' | 'forgot_out' | 'late_work' | 'on_duty' | 'wfh' | 'technical' | 'other';
export type RegularizationStatus = 'pending' | 'approved' | 'rejected';
export const REGULARIZATION_REASONS: Array<{ value: RegularizationReason; label: string }> = [
  { value: 'forgot_in', label: 'Forgot to punch in' },
  { value: 'forgot_out', label: 'Forgot to punch out' },
  { value: 'late_work', label: 'Punched late due to work' },
  { value: 'on_duty', label: 'On duty – client visit' },
  { value: 'wfh', label: 'Work from home' },
  { value: 'technical', label: 'Technical issue (app/GPS)' },
  { value: 'other', label: 'Other' },
];
/** Reasons that need no times: the shift's hours are used. */
export const SHIFT_REASONS: RegularizationReason[] = ['on_duty', 'wfh'];

/** An attendance regularization request (the API keeps the old name, attendance corrections). */
export interface Regularization {
  id: number;
  user: number;
  user_detail: UserBrief;
  date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason_type: RegularizationReason;
  reason_label: string;
  /** The person's note. */
  reason: string;
  attachment_url: string | null;
  attachment_name: string | null;
  /** Days asked for together share this id. */
  batch: string;
  status: RegularizationStatus;
  status_display: string;
  reviewed_by_detail: UserBrief | null;
  remarks: string;
  reviewed_at: string | null;
  auto_approved: boolean;
  /** Added directly by HR / a manager (applied at once, not counted in the person's limit) vs the person's own request. */
  added_by_detail?: UserBrief | null;
  source?: 'hr' | 'request';
  /** The day before the approval, and the status it got (the from → to). */
  original_check_in: string | null;
  original_check_out: string | null;
  original_status: string;
  applied_status: string;
  /** Pending only: the day as recorded now, where the check-in was made and the person's requests that month. */
  day: {
    status: AttendanceStatus | null;
    check_in: string | null;
    check_out: string | null;
    working_minutes: number;
    location_name: string | null;
    distance_m: number | null;
    month_requests: number;
  } | null;
  created_at: string;
}
/** @deprecated the old name. */
export type AttendanceCorrection = Regularization;

/** What the regularization limit counts: per month (default), per week (Monday–Sunday) or per year. */
export type RegularizationPeriod = 'month' | 'week' | 'year';
export const REGULARIZATION_PERIOD_WORDS: Record<RegularizationPeriod, { a: string; this: string }> = {
  month: { a: 'a month', this: 'this month' },
  week: { a: 'a week', this: 'this week' },
  year: { a: 'a year', this: 'this year' },
};

export interface RegularizationPolicy {
  enabled: boolean;
  reasons: Array<{ value: RegularizationReason; label: string }>;
  /** My limit per period (my own when HR set one); 0 = unlimited. Older servers leave these out (use monthly_*). */
  limit?: number;
  period?: RegularizationPeriod;
  personal_limit?: boolean;
  used?: number;
  left?: number | null;
  /** 0 = unlimited. */
  monthly_limit: number;
  used_this_month: number;
  left_this_month: number | null;
  days_back: number;
  /** The first day that may be asked for (YYYY-MM-DD). */
  earliest: string;
  mark: 'times' | 'present';
  work_start: string;
  work_end: string;
  /** Today may be asked for once the shift has ended. */
  shift_ended: boolean;
}

/** GET /attendance-corrections/policy/ — the company's rules and how many requests I have left this month. */
export function useRegularizationPolicy(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'regularization', 'policy'],
    queryFn: () => tasksApi.get<RegularizationPolicy>('/attendance-corrections/policy/'),
    enabled,
    staleTime: 30_000,
  });
}

export interface RegularizationInput {
  date: string;
  /** Several days (a range without its week-offs and holidays). */
  end_date?: string;
  reason_type: RegularizationReason;
  /** HH:MM; leave out to keep what was recorded. */
  check_in_time?: string;
  check_out_time?: string;
  reason?: string;
  /** A photo or document (sent as multipart when given). */
  attachment?: Blob & { name?: string };
}

type RegularizationAnswer = Regularization | { results: Regularization[]; count: number };

/** POST /attendance-corrections/ — one day answers the request, a range answers {results, count}. */
export function useRequestRegularization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attachment, ...body }: RegularizationInput) => {
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== ''));
      if (!attachment) return tasksApi.post<RegularizationAnswer>('/attendance-corrections/', clean);
      const fd = new FormData();
      for (const [k, v] of Object.entries(clean)) fd.append(k, String(v));
      fd.append('attachment', attachment, attachment.name ?? 'attachment');
      return tasksApi.upload<RegularizationAnswer>('/attendance-corrections/', fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

/** Someone I may regularize for (GET /attendance-corrections/people/). */
export interface RegularizablePerson {
  id: number;
  name: string;
  username: string;
  department: string;
}

/**
 * GET /attendance-corrections/people/ — whom I may regularize for (my reports / my approving scope; the Owner also
 * themselves). `all`: everyone (HR settings → per-person limits; HR settings people only).
 */
export function useRegularizablePeople(enabled = true, all = false) {
  return useQuery({
    queryKey: ['hr', 'regularization', 'people', all],
    queryFn: () => tasksApi.get<RegularizablePerson[]>('/attendance-corrections/people/', all ? { scope: 'all' } : undefined),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * POST /attendance-corrections/add_for/ — HR / a manager regularizes days for someone (PLAN.md §19.38 addendum): applied at
 * once, not counted in the person's limit, any past day; the person is told.
 */
export function useAddRegularization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attachment, ...body }: RegularizationInput & { user: number }) => {
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== ''));
      if (!attachment) return tasksApi.post<RegularizationAnswer>('/attendance-corrections/add_for/', clean);
      const fd = new FormData();
      for (const [k, v] of Object.entries(clean)) fd.append(k, String(v));
      fd.append('attachment', attachment, attachment.name ?? 'attachment');
      return tasksApi.upload<RegularizationAnswer>('/attendance-corrections/add_for/', fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

/** POST /attendance-corrections/ (the old form: full date-times). Kept for older screens. */
export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; reason: string; requested_check_in?: string; requested_check_out?: string }) => tasksApi.post('/attendance-corrections/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

/** Pending regularizations of the people I approve for. */
export function usePendingCorrections(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'corrections', 'pending'],
    queryFn: () =>
      tasksApi
        .get<DrfPage<Regularization> | Regularization[]>('/attendance-corrections/', { scope: 'team', status: 'pending', page_size: 100 })
        .then(resultsOf)
        .then((rows) => rows.filter((c) => c.status === 'pending')),
    enabled,
  });
}
export const usePendingRegularizations = usePendingCorrections;

/** GET /attendance-corrections/ — my own regularization requests, newest first (the permanent record, PLAN.md §19.38). */
export function useMyRegularizations() {
  return useQuery({
    queryKey: ['hr', 'regularization', 'mine'],
    queryFn: () => tasksApi.get<DrfPage<Regularization> | Regularization[]>('/attendance-corrections/', { page_size: 100 }).then(resultsOf),
  });
}

/** POST /attendance-corrections/bulk_review/ {ids, decision, remarks} → what was done, and why the others were not. */
export function useBulkReviewRegularizations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: number[]; decision: 'approved' | 'rejected'; remarks?: string }) =>
      tasksApi.post<{ done: number[]; failed: Array<{ id: number; detail: string }> }>('/attendance-corrections/bulk_review/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
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
