/** Team 360 building blocks (PLAN.md §25): today's status as a text label, small formatting helpers. */
import type { Team360DayStatus } from '@kaampilot/core/team';
import { Chip, type Tone } from '../tasks/general/parts';

/** Today's status in words (no dots; rounded-sm label in its tone). */
export const TODAY_LABEL: Record<NonNullable<Team360DayStatus> | 'none', string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  leave: 'On leave',
  absent: 'Absent',
  not_checked_in: 'Not punched in',
  holiday: 'Holiday',
  week_off: 'Week off',
  none: '—',
};
const TODAY_TONE: Record<NonNullable<Team360DayStatus> | 'none', Tone> = {
  present: 'success',
  late: 'warning',
  half_day: 'warning',
  leave: 'info',
  absent: 'danger',
  not_checked_in: 'neutral',
  holiday: 'primary',
  week_off: 'neutral',
  none: 'neutral',
};

export function TodayChip({ status, className }: { status: Team360DayStatus; className?: string }) {
  const key = status ?? 'none';
  return (
    <Chip tone={TODAY_TONE[key]} className={className}>
      {TODAY_LABEL[key]}
    </Chip>
  );
}

/** The status filter's groups: Week off and Holiday count as one ("Off today"). */
export type StatusFilter = 'all' | 'present' | 'late' | 'leave' | 'absent' | 'not_checked_in' | 'off';
export function statusGroup(s: Team360DayStatus): StatusFilter {
  if (s === 'present' || s === 'half_day') return 'present';
  if (s === 'late') return 'late';
  if (s === 'leave') return 'leave';
  if (s === 'absent') return 'absent';
  if (s === 'holiday' || s === 'week_off') return 'off';
  return 'not_checked_in';
}

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`);
export const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
export const day = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';
export const dayTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
/** Tone for an attendance %: 90+ good, 75–89 watch, under 75 needs a look. */
export const rateTone = (n: number | null | undefined): Tone => (n == null ? 'neutral' : n >= 90 ? 'success' : n >= 75 ? 'warning' : 'danger');
export const RATE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
};
