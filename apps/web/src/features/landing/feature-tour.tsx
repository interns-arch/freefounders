/**
 * The feature tour (PLAN.md §24.2): one tab per module with its points and real screenshots. Tabs follow the WAI-ARIA
 * tabs pattern (arrow keys move between them); a module with more than one picture has small picture buttons.
 * Pictures load lazily and keep their space (width/height), so nothing jumps while they arrive.
 */
import { type KeyboardEvent, useRef, useState } from 'react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import { type Shot, TOUR } from './content';

export function FeatureTour() {
  const [active, setActive] = useState(0);
  const [shot, setShot] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const mod = TOUR[active]!;
  const pick = (i: number) => {
    setActive(i);
    setShot(0);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TOUR.length - 1 : (active + step + TOUR.length) % TOUR.length;
    pick(next);
    tabs.current[next]?.focus();
  };
  const current = mod.shots[Math.min(shot, mod.shots.length - 1)]!;

  return (
    <div>
      <div role="tablist" aria-label="Modules" onKeyDown={onKey} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
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
                'inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:border-primary/40 hover:bg-accent',
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
        className="mt-8 grid items-start gap-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-12"
      >
        <div className="lg:pt-4">
          <span className={cn('inline-grid size-11 place-items-center rounded-md', mod.tone)}>
            <mod.icon className="size-5" />
          </span>
          <h3 className="mt-4 text-2xl leading-tight font-bold tracking-tight text-balance">{mod.headline}</h3>
          <ul className="mt-5 space-y-3">
            {mod.points.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-snug">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm bg-success/12 text-success">
                  <Check className="size-3.5" />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {mod.shots.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Pictures">
              {mod.shots.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  aria-pressed={i === shot}
                  onClick={() => setShot(i)}
                  className={cn(
                    'h-9 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:h-11',
                    i === shot ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ShotFrame shot={current} key={current.src} />
      </div>
    </div>
  );
}

/** A screenshot in a plain browser or phone frame. */
export function ShotFrame({ shot, eager = false, className }: { shot: Shot; eager?: boolean; className?: string }) {
  if (shot.kind === 'phone') {
    return (
      <div className={cn('mx-auto w-full max-w-[290px] rounded-[2rem] border-[6px] border-foreground/85 bg-card p-1 shadow-card-lg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300', className)}>
        <img
          src={shot.src}
          alt={shot.alt}
          width={390}
          height={844}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="block h-auto w-full rounded-[1.5rem] bg-muted"
        />
      </div>
    );
  }
  return (
    <figure className={cn('overflow-hidden rounded-xl border bg-card shadow-card-lg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300', className)}>
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
