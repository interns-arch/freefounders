/**
 * "A day with Kaampilot" (PLAN.md §24.2 v3): one working day told in six moments, each with a real screen.
 * - From 1024 px: a sticky scroll story. The text steps scroll by on the left; the picture on the right stays put and
 *   crossfades to the step in the middle of the screen; a line fills as you read and the clock shows the step's time.
 * - Below 1024 px: a click-through (time buttons, Back / Next, swipe on the picture), so the page stays short on phones.
 * Pictures load lazily and share one grid cell (no layout jumps). Transform/opacity only; off with less motion.
 */
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { STORY } from './content';
import { ShotStage } from './feature-tour';
import { useInView, useMedia, useScrollFrame } from './motion';

const SHOTS = STORY.map((s) => s.shot);

export function DayStory() {
  const wide = useMedia('(min-width: 1024px)');
  return wide ? <StickyStory /> : <ClickStory />;
}

function StepText({ i, className }: { i: number; className?: string }) {
  const s = STORY[i]!;
  return (
    <div className={className}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-0.5 font-mono text-[12px] font-semibold text-accent-foreground tabular-nums">
          <Clock className="size-3.5" /> {s.time}
        </span>
        {s.who}
      </p>
      <h3 className="mt-3 text-xl leading-tight font-bold tracking-tight text-balance sm:text-2xl">{s.title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground sm:text-base">{s.text}</p>
      <ul className="mt-4 space-y-2">
        {s.points.map((p) => (
          <li key={p} className="flex gap-2.5 text-[15px] leading-snug">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm bg-success/12 text-success">
              <Check className="size-3.5" />
            </span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StickyStory() {
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  // The line on the left fills with the reading position through the steps.
  useScrollFrame(() => {
    const el = wrap.current;
    const f = fill.current;
    if (!el || !f) return;
    const r = el.getBoundingClientRect();
    const mid = window.innerHeight / 2;
    const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
    f.style.transform = `scaleY(${p.toFixed(3)})`;
  });
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] gap-12 xl:gap-16">
      <div ref={wrap} className="relative pl-8">
        <div aria-hidden className="absolute top-0 bottom-0 left-[7px] w-0.5 rounded-sm bg-border">
          <div ref={fill} className="kp-fill h-full w-full origin-top rounded-sm bg-primary" style={{ transform: 'scaleY(0)' }} />
        </div>
        <ol>
          {STORY.map((s, i) => (
            <Step key={s.title} i={i} active={i === active} onActive={() => setActive(i)} />
          ))}
        </ol>
      </div>
      <div className="relative">
        <div className="sticky top-[max(6rem,calc(50vh-17rem))] py-2">
          <div className="mb-4 flex items-center justify-between gap-4 text-sm">
            <span key={active} className="kp-fade inline-flex items-center gap-2 font-semibold">
              <Clock className="size-4 text-primary" />
              <span className="font-mono tabular-nums">{STORY[active]!.time}</span>
              <span className="font-normal text-muted-foreground">· {STORY[active]!.shot.label}</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-hidden>
              {active + 1} / {STORY.length}
            </span>
          </div>
          <ShotStage shots={SHOTS} active={active} />
        </div>
      </div>
    </div>
  );
}

/** One step on the left; it becomes active when it crosses the middle band of the screen. */
function Step({ i, active, onActive }: { i: number; active: boolean; onActive: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useInView(ref, (v) => v && onActive(), '-45% 0px -45% 0px');
  return (
    <li ref={ref} aria-current={active ? 'step' : undefined} className="relative flex min-h-[62vh] items-center py-10 first:min-h-[50vh] first:pt-0 last:min-h-[55vh]">
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 -left-8 grid size-4 -translate-y-1/2 place-items-center rounded-sm border-2 bg-background transition-colors duration-300',
          active ? 'border-primary bg-primary' : 'border-border',
        )}
      />
      <StepText i={i} className={cn('transition-opacity duration-500', active ? 'opacity-100' : 'opacity-40')} />
    </li>
  );
}

function ClickStory() {
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const row = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const go = (i: number) => {
    const next = Math.max(0, Math.min(STORY.length - 1, i));
    if (next === active) return;
    setDir(next > active ? 1 : -1);
    setActive(next);
    const b = row.current?.children[next] as HTMLElement | undefined;
    const r = row.current;
    if (b && r && r.scrollWidth > r.clientWidth) r.scrollTo({ left: b.offsetLeft - r.offsetLeft - 16, behavior: 'smooth' });
  };
  return (
    <div>
      <div ref={row} role="group" aria-label="Moments of the day" className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1">
        {STORY.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-pressed={i === active}
            onClick={() => go(i)}
            className={cn(
              'kp-press inline-flex h-11 shrink-0 cursor-pointer snap-start items-center gap-1.5 rounded-md border px-3.5 font-mono text-[13px] font-semibold tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              i === active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground',
            )}
          >
            {s.time}
          </button>
        ))}
      </div>
      {/* Progress: one segment per moment, filled up to this one. */}
      <div aria-hidden className="mt-3 flex gap-1">
        {STORY.map((s, i) => (
          <span key={s.title} className="h-1 flex-1 overflow-hidden rounded-sm bg-border">
            <span className={cn('kp-seg block h-full origin-left bg-primary', i <= active ? 'scale-x-100' : 'scale-x-0')} />
          </span>
        ))}
      </div>
      <div
        className="mt-6"
        onTouchStart={(e) => {
          touch.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (start == null || end == null || Math.abs(end - start) < 50) return;
          go(active + (end < start ? 1 : -1));
        }}
      >
        <ShotStage shots={SHOTS} active={active} />
      </div>
      <div aria-live="polite" key={active} className={cn('mt-6', dir > 0 ? 'kp-in-right' : 'kp-in-left')}>
        <StepText i={active} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => go(active - 1)} disabled={active === 0} className="kp-press h-11">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {active + 1} / {STORY.length}
        </span>
        <Button variant="outline" onClick={() => go(active + 1)} disabled={active === STORY.length - 1} className="kp-press h-11">
          Next <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
