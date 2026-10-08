import { Input, NativeSelect } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Date ranges the Tasks API understands (?range=). "custom" adds ?start=&end= (YYYY-MM-DD). */
export const RANGES: Array<[string, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This Week'],
  ['last_week', 'Last Week'],
  ['this_month', 'This Month'],
  ['last_month', 'Last Month'],
  ['this_year', 'This Year'],
  ['all', 'All Time'],
];

export interface CustomRange {
  start: string;
  end: string;
}

/** Query params for a range: { range } or { range: 'custom', start, end }. */
export function rangeParams(range: string, custom: CustomRange): { range: string; start?: string; end?: string } {
  return range === 'custom' ? { range, start: custom.start, end: custom.end } : { range };
}

/** A custom range is usable only once both dates are picked. */
export function rangeReady(range: string, custom: CustomRange): boolean {
  return range !== 'custom' || (!!custom.start && !!custom.end);
}

/** "01 – 30 Sep 2026", dropping the year and month when they repeat. */
export function fmtRange(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const d = (x: Date, opts: Intl.DateTimeFormatOptions) => x.toLocaleDateString('en-IN', opts);
  if (from === to) return d(a, { day: '2-digit', month: 'short', year: 'numeric' });
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const left = d(a, sameMonth ? { day: '2-digit' } : { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${left} – ${d(b, { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/**
 * One dropdown of preset ranges plus a custom from–to picker, shared by the dashboard and reports.
 * `applied` shows the dates the server actually counted (a week can straddle two months).
 */
export function RangePicker({
  range,
  setRange,
  custom,
  setCustom,
  applied,
  countedBy = 'due date',
  ranges = RANGES,
  allowCustom = true,
  className,
}: {
  range: string;
  setRange: (v: string) => void;
  custom: CustomRange;
  setCustom: (v: CustomRange) => void;
  applied?: { from: string | null; to: string | null } | null;
  countedBy?: string;
  ranges?: Array<[string, string]>;
  allowCustom?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <NativeSelect aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)} className="w-auto min-w-36">
        {ranges.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
        {allowCustom && <option value="custom">Custom range…</option>}
      </NativeSelect>
      {range === 'custom' && (
        <>
          <Input type="date" aria-label="From date" className="w-auto" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" className="w-auto" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
        </>
      )}
      {applied?.from && applied.to && (
        <span className="text-xs text-muted-foreground">
          {fmtRange(applied.from, applied.to)} · counted by {countedBy}
        </span>
      )}
    </div>
  );
}
