import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto scrollbar-thin">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
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
  return <tr className={cn('border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/6', className)} {...props} />;
}
export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn('h-10 whitespace-nowrap bg-muted/50 px-3 text-left align-middle text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase first:pl-4 last:pr-4', className)}
      {...props}
    />
  );
}
export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle first:pl-4 last:pr-4', className)} {...props} />;
}
