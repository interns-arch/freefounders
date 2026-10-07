import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Filters, search, sort and page kept in the URL: instant, shareable and they survive refresh.
 * Changing any filter resets to page 1.
 */
export function useUrlFilters(defaults: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const v: Record<string, string> = { ...defaults };
    params.forEach((value, key) => {
      v[key] = value;
    });
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>, opts: { keepPage?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '' || v === defaults[k]) next.delete(k);
            else next.set(k, String(v));
          }
          if (!opts.keepPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );

  const clear = useCallback(
    (keep: string[] = []) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams();
          for (const k of keep) {
            const v = prev.get(k);
            if (v) next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { values, set, clear, params };
}

export function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Local input state that pushes to the URL after the user pauses typing. */
export function useSearchBox(current: string, onCommit: (value: string) => void, delay = 250) {
  const [text, setText] = useState(current);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const debounced = useDebounced(text, delay);
  useEffect(() => {
    if (debounced !== current) commit.current(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    setText((t) => (t === current ? t : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return [text, setText] as const;
}
