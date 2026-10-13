/**
 * Lite mode for weak devices (phones, old laptops) (PLAN.md §19.18): `<html data-lite>` turns off the costly paint work (backdrop blur,
 * blurred glows, big shadows, gradients on big surfaces, transitions and animations; see index.css).
 *
 * Auto (the default) switches it on for any device (phone, tablet, laptop or desktop) with at most 2 GB of memory or
 * at most 2 CPU cores, a computer with at most 4 GB and 4 cores, a phone-size screen with at most 4 cores, a device
 * in data-saver mode, or one that asks for less motion. The account menu has "Lite mode: Auto / On / Off", kept on this
 * device (localStorage `ff-lite`).
 */
import { useEffect, useState } from 'react';

export type LiteChoice = 'auto' | 'on' | 'off';
const KEY = 'ff-lite';
const listeners = new Set<() => void>();

export function liteChoice(): LiteChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** What Auto decides on this device. */
export function autoLite(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const media = (q: string) => !!window.matchMedia?.(q).matches;
  const phoneSize = media('(max-width: 639px)') || Math.min(screen.width || 9999, screen.height || 9999) <= 640;
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const cores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null;
  if (memory !== null && memory <= 2) return true;
  if (cores !== null && cores <= 2) return true;
  if (!phoneSize && memory !== null && memory <= 4 && cores !== null && cores <= 4) return true;
  if (phoneSize && cores !== null && cores <= 4) return true;
  if (nav.connection?.saveData) return true;
  return media('(prefers-reduced-motion: reduce)');
}

export function isLite(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-lite');
}

/** Sets or clears `<html data-lite>` from the saved choice. Called once at start (before the first render) and on change. */
export function applyLite(): boolean {
  const choice = liteChoice();
  const on = choice === 'on' || (choice === 'auto' && autoLite());
  document.documentElement.toggleAttribute('data-lite', on);
  listeners.forEach((l) => l());
  return on;
}

export function setLiteChoice(choice: LiteChoice) {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: for this visit only */
  }
  document.documentElement.toggleAttribute('data-lite', choice === 'on' || (choice === 'auto' && autoLite()));
  listeners.forEach((l) => l());
}

/** Starts lite mode at app start; follows the device's reduced-motion setting while Auto. */
export function installLite() {
  applyLite();
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => {
    if (liteChoice() === 'auto') applyLite();
  });
}

/** The saved choice and whether lite mode is on now, for the account menu. */
export function useLite() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { choice: liteChoice(), active: isLite(), auto: autoLite(), setChoice: setLiteChoice };
}

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
