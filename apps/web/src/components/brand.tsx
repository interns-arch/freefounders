/**
 * The Kaampilot logo (PLAN.md §19.35), drawn inline so it follows the theme: a K whose arm takes off as an arrow out of
 * its tile ("kaam" + "pilot"), and the monoline "kaampilot" wordmark. Light: indigo tile, white K, emerald arrowhead
 * and i-dot. Dark: lime tile, graphite K, lime arrowhead. Colours come from the theme tokens only; the SVG files in
 * public/brand/ (made by the same geometry) are for everything outside the app: favicon, Android icons, documents.
 */
import { type CSSProperties, useId } from 'react';
import { cn } from '@/lib/utils';

const TILE = 'M11 10H29A9 9 0 0 1 38 19V37A9 9 0 0 1 29 46H11A9 9 0 0 1 2 37V19A9 9 0 0 1 11 10Z';
const K = 'M13.5 19.5V36.5M13.5 35 32.6 15.9M21.6 26.9 30.5 36.5';
const HEAD = 'M45.5 3L40.9 17.5L38.78 9.72L31 7.6Z';
const WORD =
  'M2.5 8V40M2.5 33.5 14.5 21.5M8.6 27.4 15 40M46 20V40M46 30A10 10 0 1 1 26 30A10 10 0 1 1 46 30M77 20V40M77 30A10 10 0 1 1 57 30A10 10 0 1 1 77 30M88 40V20M88 27A6 6 0 0 1 100 27V40M100 27A6 6 0 0 1 112 27V40M123 20V50.5M143 30A10 10 0 1 1 123 30A10 10 0 1 1 143 30M154 20V40M165 8V40M196 30A10 10 0 1 1 176 30A10 10 0 1 1 196 30M210 11V33.5A6.5 6.5 0 0 0 216.5 40H218M207 20H217.5';
const DOT_COM = 'M33.1 23.3A10 10 0 1 0 33.1 36.7M64.1 30A10 10 0 1 1 44.1 30A10 10 0 1 1 64.1 30M75.1 40V20M75.1 27A6 6 0 0 1 87.1 27V40M87.1 27A6 6 0 0 1 99.1 27V40';
const WORD_W = 220.5;
const COM_W = 101.6;

/** The mark alone (square). Size it with `className` (e.g. `size-8`). Decorative unless `title` is given. */
export function BrandMark({ className, title, size }: { className?: string; title?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <mask id={`${id}-gap`} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="white" />
          <path d={HEAD} fill="black" stroke="black" strokeWidth="5" strokeLinejoin="round" />
        </mask>
      </defs>
      <path d={TILE} className="fill-primary" mask={`url(#${id}-gap)`} />
      <path d={K} fill="none" className="stroke-primary-foreground" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={HEAD} className="fill-cta stroke-cta dark:fill-primary dark:stroke-primary" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** "kaampilot" (+ ".com" when `domain`), drawn as strokes; its height follows `className` (e.g. `h-5`). */
export function BrandWordmark({ className, domain = false, height, style }: { className?: string; domain?: boolean; height?: number; style?: CSSProperties }) {
  const width = domain ? WORD_W + 4 + COM_W : WORD_W;
  return (
    <svg viewBox={`-3 4 ${width + 6} 50`} height={height} width={height ? Math.round((height * (width + 6)) / 50) : undefined} style={style} className={cn('shrink-0', className)} aria-hidden>
      <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d={WORD} className="stroke-foreground" />
        {domain && <path d={DOT_COM} transform={`translate(${WORD_W + 4} 0)`} className="stroke-muted-foreground" />}
      </g>
      <circle cx="154" cy="10.5" r="3.3" className="fill-cta dark:fill-primary" />
      {domain && <circle cx={WORD_W + 4 + 3.3} cy="36.7" r="3.3" className="fill-muted-foreground" />}
    </svg>
  );
}

/**
 * Mark + wordmark, named for screen readers ("Kaampilot", or "kaampilot.com" with `domain`). `size`: the mark's height
 * in px; the word is scaled and lowered so its x-height sits on the middle of the tile.
 */
export function BrandLockup({ className, size = 32, domain = false }: { className?: string; size?: number; domain?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} style={{ gap: Math.round(size * 0.22) }} role="img" aria-label={domain ? 'kaampilot.com' : 'Kaampilot'}>
      <BrandMark className="shrink-0" size={size} />
      <BrandWordmark domain={domain} height={Math.round(size * 0.82)} style={{ transform: `translateY(${(size * 0.066).toFixed(1)}px)` }} />
    </span>
  );
}
