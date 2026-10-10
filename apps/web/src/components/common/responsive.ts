import { useSyncExternalStore } from 'react';

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
