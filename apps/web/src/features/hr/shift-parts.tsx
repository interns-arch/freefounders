/** Shift building blocks (PLAN.md §28): a shift's colour is a theme token name, mapped here to fixed theme classes. */
import type { ShiftColour } from '@kaampilot/core/hr';
import { cn } from '@/lib/utils';

/** Tint + text + border per shift colour (theme tokens only; the code is always written, never colour alone). */
export const SHIFT_TONE: Record<ShiftColour, string> = {
  primary: 'bg-primary/12 text-primary border-primary/30',
  cta: 'bg-cta/14 text-cta border-cta/35',
  success: 'bg-success/14 text-success border-success/30',
  warning: 'bg-warning/16 text-warning border-warning/40',
  info: 'bg-info/14 text-info border-info/30',
  destructive: 'bg-destructive/10 text-destructive border-destructive/30',
  attendance: 'bg-app-attendance/12 text-app-attendance border-app-attendance/30',
  tasks: 'bg-app-tasks/12 text-app-tasks border-app-tasks/30',
  assets: 'bg-app-assets/12 text-app-assets border-app-assets/30',
  visitors: 'bg-app-visitors/12 text-app-visitors border-app-visitors/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

/** A solid swatch for the colour picker. */
export const SHIFT_SWATCH: Record<ShiftColour, string> = {
  primary: 'bg-primary',
  cta: 'bg-cta',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
  attendance: 'bg-app-attendance',
  tasks: 'bg-app-tasks',
  assets: 'bg-app-assets',
  visitors: 'bg-app-visitors',
  muted: 'bg-muted-foreground',
};

export const SHIFT_COLOUR_NAMES: Record<ShiftColour, string> = {
  primary: 'Primary',
  cta: 'Action',
  success: 'Green',
  warning: 'Amber',
  info: 'Blue',
  destructive: 'Red',
  attendance: 'Attendance',
  tasks: 'Tasks',
  assets: 'Assets',
  visitors: 'Visitors',
  muted: 'Grey',
};

export const toneOf = (colour: string | null | undefined) => SHIFT_TONE[(colour as ShiftColour) in SHIFT_TONE ? (colour as ShiftColour) : 'muted'];

/** "G" in its shift colour. */
export function ShiftCode({ code, colour, className, title }: { code: string; colour: string; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex min-w-8 items-center justify-center rounded-sm border px-1.5 py-0.5 font-mono text-xs font-bold', toneOf(colour), className)}>
      {code}
    </span>
  );
}

/** "22:00–06:00 (next day)" / "". */
export function shiftHours(start: string, end: string, overnight?: boolean) {
  if (!start || !end) return '';
  return `${start}–${end}${overnight ? ' (next day)' : ''}`;
}
