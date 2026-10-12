import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Long lists in pages (PLAN.md §19.18): a weak phone renders the first `step` rows, then "Load {step} more" adds the
 * next ones. The count goes back to the first page whenever `reset` changes (a new filter, search, tab or date), so a
 * filtered list never starts half-way down. Use it for lists the API already returns in full; lists the server pages
 * keep their own pager.
 *
 *   const more = useShowMore(rows, { reset: [status, search] });
 *   more.visible.map(...)
 *   <ShowMore {...more.footer} noun="tasks" />
 */
export function useShowMore<T>(rows: readonly T[], { step = 50, reset }: { step?: number; reset?: unknown } = {}) {
  const key = JSON.stringify(reset ?? null);
  const [state, setState] = useState({ key, limit: step });
  const limit = state.key === key ? state.limit : step;
  if (state.key !== key) setState({ key, limit: step });
  const total = rows.length;
  const shown = Math.min(limit, total);
  // Same array between renders while nothing changed, so tables keyed on their rows (keyboard focus, selection) keep state.
  // Typed as a plain array so it drops into props like DataTable's `rows`; nothing here ever changes it.
  const visible = useMemo(() => (shown < total ? rows.slice(0, shown) : (rows as T[])), [rows, shown, total]);
  return {
    visible,
    shown,
    total,
    hasMore: shown < total,
    footer: { shown, total, step, onMore: () => setState({ key, limit: limit + step }) },
  };
}

/**
 * "Showing 50 of 312 · Load 50 more". Nothing when every row is shown. The count is a polite live region, so a screen
 * reader hears the new total; when the last rows arrive the button goes and focus moves to the count.
 */
export function ShowMore({
  shown,
  total,
  step,
  onMore,
  noun,
  className,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: () => void;
  /** "tasks", "people"… — read after the numbers. */
  noun?: string;
  className?: string;
}) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  if (total <= step && shown >= total) return null;
  const left = total - shown;
  const next = Math.min(step, left);
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-3 text-sm text-muted-foreground', className)}>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {left > 0 ? `Showing ${shown} of ${total}${noun ? ` ${noun}` : ''}` : `Showing all ${total}${noun ? ` ${noun}` : ''}`}
      </p>
      {left > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onMore();
            if (next >= left) requestAnimationFrame(() => statusRef.current?.focus());
          }}
        >
          Load {next} more
        </Button>
      )}
    </div>
  );
}
