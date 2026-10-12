import { Search, X } from 'lucide-react';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A search box that filters as you type: magnifier, accessible name, a clear (×) button once there is text, and the
 * "search" key on phone keyboards. Esc clears it too.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
  inputClassName,
  onKeyDown,
  ...rest
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (also the placeholder when none is given). */
  label: string;
  inputClassName?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
          onKeyDown?.(e);
        }}
        {...rest}
        className={cn('pr-9 pl-8 [&::-webkit-search-cancel-button]:appearance-none max-sm:pr-11', inputClassName)}
      />
      {value && (
        <button
          type="button"
          className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none max-sm:size-10"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
