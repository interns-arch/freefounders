/** Attendance and leave statuses → tone (same mapping as the web, apps/web/src/features/hr/parts.tsx). */
import type { AttendanceStatus, LeaveRequest } from '@freefounders/core/hr';
import type { Tone } from '@/components/ui';

export const ATTENDANCE_TONE: Record<AttendanceStatus, Tone> = {
  present: 'success',
  late: 'warning',
  half_day: 'warning',
  absent: 'danger',
  leave: 'info',
  holiday: 'primary',
  week_off: 'neutral',
  not_checked_in: 'neutral',
};

export const LEAVE_TONE: Record<LeaveRequest['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

/** The calendar legend, in reading order. */
export const LEGEND: Array<{ status: Exclude<AttendanceStatus, 'not_checked_in'>; label: string }> = [
  { status: 'present', label: 'Present' },
  { status: 'late', label: 'Late' },
  { status: 'half_day', label: 'Half day' },
  { status: 'absent', label: 'Absent' },
  { status: 'leave', label: 'Leave' },
  { status: 'holiday', label: 'Holiday' },
  { status: 'week_off', label: 'Week off' },
];
