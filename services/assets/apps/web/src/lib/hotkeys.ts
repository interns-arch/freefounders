import { useEffect, useRef } from 'react';

/** Return `false` to signal the key was not handled (the browser default then runs). */
type Handler = (e: KeyboardEvent) => void | boolean;

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const mod = parts.includes('mod');
  const wantCtrl = parts.includes('ctrl') || (mod && !navigator.platform.includes('Mac'));
  const wantMeta = parts.includes('meta') || (mod && navigator.platform.includes('Mac'));
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== wantAlt) return false;
  if (wantShift && !e.shiftKey) return false;
  const k = e.key.toLowerCase();
  return k === key || (key === 'slash' && k === '/') || (key === 'question' && k === '?') || (key === 'escape' && k === 'escape');
}

/**
 * Global keyboard shortcuts. Combos: "mod+k", "/", "n", "?", or sequences like "g a".
 * Plain-key shortcuts are ignored while typing in a field.
 */
export function useHotkeys(bindings: Record<string, Handler>, deps: unknown[] = [], opts: { enabled?: boolean; allowInInputs?: string[] } = {}) {
  const ref = useRef(bindings);
  ref.current = bindings;
  const seq = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = isTyping(e);
      for (const [combo, handler] of Object.entries(ref.current)) {
        const hasModifier = /(mod|ctrl|meta|alt)\+/.test(combo);
        if (typing && !hasModifier && !opts.allowInInputs?.includes(combo)) continue;
        if (combo.includes(' ')) {
          const [first, second] = combo.split(' ');
          const prev = seq.current;
          if (prev && prev.key === first && Date.now() - prev.at < 1000 && e.key.toLowerCase() === second && !e.ctrlKey && !e.metaKey) {
            seq.current = null;
            if (handler(e) !== false) e.preventDefault();
            return;
          }
          continue;
        }
        if (matches(combo, e)) {
          if (handler(e) !== false) {
            e.preventDefault();
            return;
          }
        }
      }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        seq.current = { key: e.key.toLowerCase(), at: Date.now() };
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, ...deps]);
}

/**
 * Detects USB barcode / QR scanners, which "type" a code very fast and press Enter.
 * Fires only when focus is not in a text field.
 */
export function useScannerInput(onScan: (code: string) => void) {
  const ref = useRef(onScan);
  ref.current = onScan;
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (now - last > 60) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 5) {
          e.preventDefault();
          ref.current(buffer);
        }
        buffer = '';
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
