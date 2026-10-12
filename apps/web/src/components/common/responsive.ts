import { type RefObject, useEffect, useSyncExternalStore } from 'react';

/** True while the media query matches (re-renders when it changes). Phones: `useMediaQuery('(max-width: 639px)')`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** Below Tailwind's `sm` breakpoint: the phone layout. */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 639px)');
}

/**
 * A row of tabs or chips that scrolls sideways (phones): keeps the current one in view, so "Live team" is not
 * selected but hidden off the right edge. Pass the scrolling element and anything that changes the current item.
 * Only the row scrolls (never the page).
 */
export function useActiveInView(row: RefObject<HTMLElement | null>, current: unknown, selector = '[aria-current="page"], [aria-pressed="true"], [aria-selected="true"], [data-state="active"]') {
  useEffect(() => {
    const el = row.current;
    const item = el?.querySelector<HTMLElement>(selector);
    if (!el || !item || el.scrollWidth <= el.clientWidth) return;
    const r = item.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (r.left >= box.left && r.right <= box.right) return;
    el.scrollLeft += r.left + r.width / 2 - (box.left + box.width / 2);
  }, [row, current, selector]);
}
