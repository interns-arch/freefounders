import { MoveHorizontal } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A table that scrolls sideways when it is wider than the screen, with a visible "swipe" hint while it overflows
 * (phones) so nobody misses the columns off to the right.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const table = el.querySelector('table');
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative w-full">
      {overflows && (
        <p className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-foreground/80" aria-hidden>
          <MoveHorizontal className="size-3.5" /> Swipe sideways to see every column
        </p>
      )}
      <div ref={ref} className="relative w-full overflow-x-auto scrollbar-thin" tabIndex={overflows ? 0 : undefined} aria-label={overflows ? 'Table, scrolls sideways' : undefined}>
        <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
      </div>
    </div>
  );
}
export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}
export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-muted/40 focus-visible:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset data-[state=selected]:bg-primary/6',
        className,
      )}
      {...props}
    />
  );
}
export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn('h-10 whitespace-nowrap bg-muted/50 px-3 text-left align-middle text-xs font-bold tracking-[0.05em] text-foreground/80 uppercase first:pl-4 last:pr-4', className)}
      {...props}
    />
  );
}
export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle first:pl-4 last:pr-4', className)} {...props} />;
}
