import { countLabel } from '@kaampilot/core';
import { cn } from '@/lib/utils';

/**
 * The red counter for "something waits for you" (PLAN.md §19.42): tabs, menu items, the phone bottom bar and the bell.
 * Round (a counter, the one allowed round label), hidden at 0, "99+" past 99. Screen readers hear ", 5 pending" (or
 * `label`) as part of the tab or link name; it never shrinks, so a tab row keeps scrolling instead of squeezing it.
 */
export function CountBadge({ n, label = 'pending', className }: { n: number | null | undefined; label?: string; className?: string }) {
  const text = countLabel(n);
  if (!text) return null;
  return (
    <span
      data-count-badge={n}
      className={cn(
        'inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-destructive px-1 font-mono text-[10px] leading-none font-bold text-destructive-foreground tabular-nums',
        className,
      )}
    >
      <span aria-hidden>{text}</span>
      <span className="sr-only">, {n} {label}</span>
    </span>
  );
}
