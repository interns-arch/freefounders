/**
 * The feature tour (PLAN.md §24.2): one tab per module with its points and real screenshots. Tabs follow the WAI-ARIA
 * tabs pattern (arrow keys move between them); a module with more than one picture has small picture buttons.
 * Pictures load lazily and keep their space (width/height), so nothing jumps while they arrive. On phones the tabs are
 * one row that scrolls sideways with snap; the chosen tab is scrolled into view (the next one peeks out as a cue).
 * v3 motion: a marker slides under the chosen tab, the panel slides in from the side you moved to, its points rise one
 * after another, and pictures crossfade (ShotStage). Transform/opacity only; off with less motion.
 */
import { type CSSProperties, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import { type Shot, TOUR } from './content';
import { Tilt } from './motion';

export function FeatureTour() {
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [shot, setShot] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const marker = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const mod = TOUR[active]!;
  const pick = (i: number) => {
    if (i === active) return;
    setDir(i > active ? 1 : -1);
    setActive(i);
    setShot(0);
    // Keep the chosen tab fully visible in the sideways-scrolling row (phones); no-op where the row wraps.
    const el = tabs.current[i];
    const row = el?.parentElement;
    if (el && row && row.scrollWidth > row.clientWidth) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollTo({ left: el.offsetLeft - row.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TOUR.length - 1 : (active + step + TOUR.length) % TOUR.length;
    pick(next);
    tabs.current[next]?.focus();
  };

  // The marker sits under the chosen tab: translate + scaleX of a 100 px block (no width/left animation).
  useLayoutEffect(() => {
    const place = () => {
      const el = tabs.current[active];
      const m = marker.current;
      if (!el || !m) return;
      m.style.transform = `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0) scaleX(${el.offsetWidth / 100})`;
      m.style.height = `${el.offsetHeight}px`;
      m.style.opacity = '1';
      if (!placed.current) {
        // The first placement jumps (no slide in from the left edge).
        placed.current = true;
        m.style.transition = 'none';
        void m.offsetWidth;
        m.style.transition = '';
      }
    };
    place();
    const row = tabs.current[0]?.parentElement;
    if (!row || typeof ResizeObserver === 'undefined') return;
    // Tabs change width when the web font arrives or the screen turns: follow every tab, not only the row.
    const ro = new ResizeObserver(place);
    ro.observe(row);
    for (const t of tabs.current) if (t) ro.observe(t);
    void document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [active]);

  return (
    <div>
      <div role="tablist" aria-label="Modules" onKeyDown={onKey} className="no-scrollbar relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:snap-none sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
        <span ref={marker} aria-hidden className="kp-marker pointer-events-none absolute top-0 left-0 w-[100px] origin-left rounded-md bg-primary opacity-0" />
        {TOUR.map((m, i) => {
          const on = i === active;
          return (
            <button
              key={m.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`tour-tab-${m.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`tour-panel-${m.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(i)}
              className={cn(
                'kp-press relative inline-flex h-[2.75rem] shrink-0 cursor-pointer snap-start items-center gap-2 rounded-md border px-4 text-sm font-semibold transition-[color,border-color,background-color] duration-300 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                on ? 'border-primary bg-transparent text-primary-foreground' : 'bg-card text-foreground hover:border-primary/40 hover:bg-accent',
              )}
            >
              <m.icon className="size-4" /> {m.name}
            </button>
          );
        })}
      </div>

      <div
        key={mod.key}
        id={`tour-panel-${mod.key}`}
        role="tabpanel"
        aria-labelledby={`tour-tab-${mod.key}`}
        className={cn('mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-10 xl:gap-14', dir > 0 ? 'kp-in-right' : 'kp-in-left')}
      >
        <div className="lg:pt-4">
          <span className={cn('inline-grid size-11 place-items-center rounded-md', mod.tone)}>
            <mod.icon className="size-5" />
          </span>
          <h3 className="mt-4 max-w-xl text-2xl leading-tight font-bold tracking-tight text-balance">{mod.headline}</h3>
          <ul className="kp-stagger mt-5 max-w-xl space-y-3">
            {mod.points.map((p, i) => (
              <li key={p} style={{ '--i': i } as CSSProperties} className="flex gap-3 text-[15px] leading-snug">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm bg-success/12 text-success">
                  <Check className="size-3.5" />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {mod.shots.length > 1 && <ShotButtons shots={mod.shots} active={shot} onPick={setShot} className="mt-6" />}
        </div>
        <Tilt>
          <ShotStage shots={mod.shots} active={shot} />
        </Tilt>
      </div>
    </div>
  );
}

/** Small buttons that switch between a module's pictures. */
export function ShotButtons({ shots, active, onPick, className }: { shots: Shot[]; active: number; onPick: (i: number) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group" aria-label="Pictures">
      {shots.map((s, i) => (
        <button
          key={s.src}
          type="button"
          aria-pressed={i === active}
          onClick={() => onPick(i)}
          className={cn(
            'kp-press h-9 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:h-[2.75rem] pointer-coarse:h-[44px]',
            i === active ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Several pictures in one place; the active one crossfades in. All of them share one grid cell, so the stage keeps the
 * height of the tallest and nothing below moves. Phone pictures sit narrow in the middle.
 */
export function ShotStage({ shots, active, eager = false, className }: { shots: Shot[]; active: number; eager?: boolean; className?: string }) {
  return (
    <div className={cn('kp-stage', className)}>
      {shots.map((s, i) => {
        const on = i === active;
        return (
          <div key={s.src} data-off={on ? undefined : ''} aria-hidden={!on} className={cn('flex min-w-0 items-center justify-center', s.kind === 'phone' && 'px-4')}>
            <ShotFrame shot={s} eager={eager && i === 0} className={s.kind === 'phone' ? 'max-w-[min(180px,44vw)] sm:max-w-[30%]' : 'w-full'} still />
          </div>
        );
      })}
    </div>
  );
}

/** A screenshot in a plain browser or phone frame. `still`: no fade of its own (a ShotStage does the crossfade). */
export function ShotFrame({ shot, eager = false, className, still = false }: { shot: Shot; eager?: boolean; className?: string; still?: boolean }) {
  const fade = !still && 'kp-fade';
  if (shot.kind === 'phone') {
    return (
      <div className={cn('mx-auto w-full max-w-[min(290px,72vw)] rounded-[2rem] border-[6px] border-foreground/85 bg-card p-1 shadow-card-lg', fade, className)}>
        <img
          src={shot.src}
          alt={shot.alt}
          width={390}
          height={844}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          className="block h-auto w-full rounded-[1.5rem] bg-muted"
        />
      </div>
    );
  }
  return (
    <figure className={cn('overflow-hidden rounded-xl border bg-card shadow-card-lg', fade, className)}>
      <div className="flex h-8 items-center justify-center border-b bg-secondary px-3" aria-hidden>
        <span className="rounded-sm bg-card px-3 py-0.5 font-mono text-[11px] text-muted-foreground">kaampilot.com</span>
      </div>
      <img
        src={shot.src}
        alt={shot.alt}
        width={1440}
        height={900}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
        className="block h-auto w-full bg-muted"
      />
    </figure>
  );
}
