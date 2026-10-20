import { type ReactNode, useRef } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { useActiveInView } from './responsive';

/*
 * The three "pick one" controls every screen uses (PLAN.md §19.29), so they look and behave the same everywhere:
 *   TabBar     sections of a page (underline tabs; links or buttons; scrolls sideways on phones, never cut)
 *   Segmented  two to five views of the same list (muted track, the chosen one is a white card)
 *   FilterChip a filter in a row of chips (status with a count, quick filters); ChipRow scrolls sideways
 * Phone heights are fixed in rem (not Tailwind spacing, which is denser under 640 px), so every tap target is ≥ 40 px.
 */

// ─── TabBar ───────────────────────────────────────────────────────────────
export const tabClass =
  '-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13.5px] font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset max-sm:h-[2.75rem] [&_svg]:size-4';
export const tabActiveClass = 'border-primary text-primary hover:text-primary';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown after the label (a count). */
  extra?: ReactNode;
  /** A link instead of a button (the address keeps the tab). */
  to?: string;
}

/** Page sections as underline tabs. `aria-current="page"` marks the open one; the row keeps it in view on phones. */
export function TabBar<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  end,
}: {
  items: TabItem<T>[];
  value: T;
  onChange?: (v: T) => void;
  label: string;
  className?: string;
  /** Something at the right end of the row (a "More" menu). */
  end?: ReactNode;
}) {
  const row = useRef<HTMLElement>(null);
  useActiveInView(row, `${value}|${items.length}`);
  return (
    <nav ref={row} aria-label={label} className={cn('no-scrollbar -mx-4 flex gap-0.5 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0', className)}>
      {items.map((t) => {
        const active = t.value === value;
        const cls = cn(tabClass, active && tabActiveClass);
        return t.to ? (
          <Link key={t.value} to={t.to} aria-current={active ? 'page' : undefined} className={cls}>
            {t.label}
            {t.extra}
          </Link>
        ) : (
          <button key={t.value} type="button" aria-current={active ? 'page' : undefined} onClick={() => onChange?.(t.value)} className={cls}>
            {t.label}
            {t.extra}
          </button>
        );
      })}
      {end}
    </nav>
  );
}

// ─── Segmented ────────────────────────────────────────────────────────────
/** Two-to-five buttons that switch a view (Open / Done / All, 7 / 30 / 90 days). The chosen one is a white card in the accent colour. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  wrap = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, ReactNode]>;
  label: string;
  className?: string;
  /** Wrap onto a second line instead of scrolling sideways (many options). */
  wrap?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-0.5 rounded-md border bg-muted p-0.5',
        wrap ? 'flex-wrap' : 'no-scrollbar overflow-x-auto',
        className,
      )}
    >
      {options.map(([v, l], i) => (
        <button
          key={`${v}-${i}`}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:h-[2.375rem] max-sm:px-3.5 [&_svg]:size-3.5',
            value === v && 'bg-card text-primary shadow-card ring-1 ring-border hover:text-primary',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────
export const chipClass =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:h-[2.5rem] [&_svg]:size-3.5';
export const chipIdleClass = 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground';
export const chipActiveClass = 'border-primary/40 bg-primary/8 text-primary hover:text-primary';

/** A row of chips that scrolls sideways on phones (only the row, never the page). */
export function ChipRow({ children, className, label, role }: { children: ReactNode; className?: string; label?: string; role?: string }) {
  return (
    <div role={role} aria-label={label} className={cn('no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0', className)}>
      {children}
    </div>
  );
}

/** One chip: a filter that is on or off. `count` shows a small number after the label. */
export function FilterChip({
  active,
  onClick,
  children,
  count,
  className,
  ...rest
}: { active: boolean; onClick: () => void; children: ReactNode; count?: ReactNode; className?: string } & Omit<React.ComponentProps<'button'>, 'onClick' | 'children'>) {
  return (
    <button type="button" onClick={onClick} className={cn(chipClass, active ? chipActiveClass : chipIdleClass, className)} {...rest}>
      {children}
      {count !== undefined && <span className={cn('rounded-sm px-1.5 font-mono text-[11px] tabular', active ? 'bg-primary/10' : 'bg-muted')}>{count}</span>}
    </button>
  );
}
