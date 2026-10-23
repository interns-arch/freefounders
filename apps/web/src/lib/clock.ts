import { useEffect, useState } from 'react';

/**
 * The time now, for clocks that show hours and minutes: it ticks on the minute (never every second) and stops while
 * the page is hidden (another app or tab in front), catching up as soon as it is shown again.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const d = new Date();
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    const onVisible = () => {
      if (!document.hidden) setNow(new Date());
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}
