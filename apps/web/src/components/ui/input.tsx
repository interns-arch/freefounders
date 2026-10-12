import { Label as LabelPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Fields are 36 px on desktop and 44 px on phones (max-sm:), with 16 px text on phones so iOS does not zoom in when a
 * field gets focus. Labels are 14 px.
 */
const fieldBase =
  'w-full min-w-0 rounded-sm border border-input bg-card px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground hover:border-ring/50 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 max-sm:text-base';

/** Phone keyboards and autofill that match the field's type (every default can be overridden by a prop). */
const TYPE_DEFAULTS: Record<string, Partial<React.ComponentProps<'input'>>> = {
  email: { inputMode: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  tel: { inputMode: 'tel', autoComplete: 'tel' },
  number: { inputMode: 'decimal' },
  search: { enterKeyHint: 'search', autoComplete: 'off' },
  url: { inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  password: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
};

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const defaults = type ? TYPE_DEFAULTS[type] : undefined;
  return <input type={type} data-slot="input" className={cn(fieldBase, 'h-9 py-1 file:border-0 file:bg-transparent file:text-sm max-sm:h-11', className)} {...defaults} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />;
}

/** Native select — fast, accessible and keyboard friendly, with a visible chevron so it reads as a drop-down. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        fieldBase,
        // The chevron is drawn in index.css (select[data-slot='select']) in the theme's muted colour, so it follows dark mode.
        'h-9 cursor-pointer appearance-none pr-8 max-sm:h-11',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('flex items-center gap-1.5 text-sm font-semibold leading-none text-foreground/85 select-none peer-disabled:opacity-50', className)}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded border bg-muted px-1 font-mono text-[11px] font-medium text-foreground/80',
        className,
      )}
      {...props}
    />
  );
}
