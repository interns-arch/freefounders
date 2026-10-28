/**
 * The landing page's motion kit (PLAN.md §24.2 v3): small and dependency-free, so it stays fast on low-cost phones.
 * - One IntersectionObserver for every reveal, one passive scroll listener batched into requestAnimationFrame.
 * - Only `transform` and `opacity` move. Everything is off with `prefers-reduced-motion` (and index.css cuts any
 *   transition to 0 there as well).
 * - Content never waits for motion: elements are hidden for the reveal only once `html[data-motion]` is set by the page
 *   (landing.css), so without JavaScript, in print, or with less motion everything is simply there.
 */
import { type CSSProperties, type ElementType, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const reducedMotion = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True while the media query matches; follows resizes. */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return on;
}

/** Marks <html> so landing.css may hide not-yet-revealed elements (only with motion allowed). */
export function useMotionRoot() {
  useLayoutEffect(() => {
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') return;
    const html = document.documentElement;
    html.dataset.motion = '';
    return () => {
      delete html.dataset.motion;
    };
  }, []);
}

// ---- one shared IntersectionObserver per rootMargin ----------------------------------------------------------------
type Hit = (entry: IntersectionObserverEntry) => void;
const observers = new Map<string, { io: IntersectionObserver; hits: Map<Element, Hit> }>();
function observe(el: Element, margin: string, threshold: number, hit: Hit) {
  const key = `${margin}|${threshold}`;
  let o = observers.get(key);
  if (!o) {
    const hits = new Map<Element, Hit>();
    const io = new IntersectionObserver((entries) => entries.forEach((e) => hits.get(e.target)?.(e)), { rootMargin: margin, threshold });
    o = { io, hits };
    observers.set(key, o);
  }
  o.hits.set(el, hit);
  o.io.observe(el);
  const mine = o;
  return () => {
    mine.hits.delete(el);
    mine.io.unobserve(el);
  };
}

/** Calls `onEnter` once, the first time the element comes into view. */
export function useInViewOnce(ref: RefObject<Element | null>, onEnter: () => void, margin = '0px 0px -12% 0px', threshold = 0) {
  const cb = useRef(onEnter);
  cb.current = onEnter;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return void cb.current();
    let done = false;
    const stop = observe(el, margin, threshold, (e) => {
      if (done || !e.isIntersecting) return;
      done = true;
      stop();
      cb.current();
    });
    return stop;
  }, [ref, margin, threshold]);
}

/** Calls `onChange(visible)` every time the element crosses the band given by `margin`. */
export function useInView(ref: RefObject<Element | null>, onChange: (visible: boolean) => void, margin: string) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observe(el, margin, 0, (e) => cb.current(e.isIntersecting));
  }, [ref, margin]);
}

// ---- one passive scroll listener, batched per frame -----------------------------------------------------------------
const frameSubs = new Set<() => void>();
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    frameSubs.forEach((f) => f());
  });
}
/** Runs `fn` on the first frame after each scroll or resize (and once at the start). */
export function useScrollFrame(fn: () => void, enabled = true) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const sub = () => cb.current();
    if (!frameSubs.size) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }
    frameSubs.add(sub);
    sub();
    return () => {
      frameSubs.delete(sub);
      if (!frameSubs.size) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    };
  }, [enabled]);
}

// ---- pieces ---------------------------------------------------------------------------------------------------------

/** Fades and lifts its children in once, when they scroll into view; `delay` staggers siblings. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useInViewOnce(ref, () => ref.current?.setAttribute('data-shown', ''));
  return (
    <Tag ref={ref} className={cn('kp-reveal', className)} style={delay ? { ...style, transitionDelay: `${delay}ms` } : style}>
      {children}
    </Tag>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tweens a number to `value` (ease-out); jumps straight there with less motion. The last frame is always exact. */
export function useTween(value: number, ms = 450) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = t >= 1 ? value : a + (value - a) * easeOut(t);
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** A number that counts up from 0 the first time it is seen. Screen readers get the final value only. */
export function CountUp({ to, prefix = '', suffix = '', className }: { to: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState(() => (reducedMotion() ? to : 0));
  useInViewOnce(ref, () => setTarget(to), '0px 0px -8% 0px');
  useEffect(() => {
    setTarget((t) => (t === 0 ? t : to));
  }, [to]);
  const v = useTween(target, 1100);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden className="tabular-nums">
        {prefix}
        {Math.round(v).toLocaleString('en-IN')}
        {suffix}
      </span>
      <span className="sr-only">
        {prefix}
        {to.toLocaleString('en-IN')}
        {suffix}
      </span>
    </span>
  );
}

/** A thin bar under the top bar that fills as the page is read (transform only). */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useScrollFrame(() => {
    const el = bar.current;
    if (!el) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    el.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`;
  });
  return <div ref={bar} aria-hidden className="kp-progress pointer-events-none absolute inset-x-0 -bottom-px h-0.5 origin-left bg-primary" />;
}

/**
 * Tilts and lifts its child a little toward the mouse (desktop with a real mouse only, never on touch or with less
 * motion). The work is one CSS variable write per frame.
 */
export function Tilt({ children, className, max = 4 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const fine = useMedia('(hover: hover) and (pointer: fine)');
  useEffect(() => {
    const el = ref.current;
    if (!el || !fine || reducedMotion()) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5;
      py = (e.clientY - r.top) / r.height - 0.5;
      el.dataset.tilt = 'on';
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      delete el.dataset.tilt;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [fine, max]);
  return (
    <div ref={ref} className={cn(fine && 'kp-tilt', className)}>
      {children}
    </div>
  );
}

/** Moves its child up a little slower than the page (hero pictures; screens from 1024 px, with motion allowed). */
export function Parallax({ children, className, speed = 0.06 }: { children: ReactNode; className?: string; speed?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useMedia('(min-width: 1024px)');
  const on = wide && !reducedMotion();
  useScrollFrame(() => {
    const el = ref.current;
    if (!el) return;
    const y = Math.min(window.scrollY, window.innerHeight * 1.2);
    el.style.transform = `translate3d(0, ${(-y * speed).toFixed(1)}px, 0)`;
  }, on);
  useEffect(() => {
    if (!on && ref.current) ref.current.style.transform = '';
  }, [on]);
  return (
    <div ref={ref} className={cn(on && 'will-change-transform', className)}>
      {children}
    </div>
  );
}
