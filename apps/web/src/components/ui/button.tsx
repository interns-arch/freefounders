import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from '@/components/icons';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Variants (PLAN.md §19.22, flat style): default = the blue primary action; cta = the orange call to action, used for
 * the ONE most important action on a screen (Punch in / out, Add task, Add asset, Add person, Apply for leave);
 * outline / secondary / ghost for everything else; destructive for deleting; success for approving.
 * Sizes: the desktop height comes first, then the phone height (max-sm:), so every button is a comfortable thumb
 * target on a phone (44 px for the normal sizes, 40 px for the small in-row ones) without changing the desktop look.
 * Text is never smaller than 14 px. Red and green buttons use dark text in dark mode (white on the lighter dark-mode
 * red/green is under 4.5:1); the orange CTA uses white text in light mode and navy text in dark mode (--cta-foreground).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:brightness-95 active:brightness-90',
        cta: 'bg-cta text-cta-foreground shadow-xs hover:brightness-95 active:brightness-90 focus-visible:ring-cta/35',
        destructive: 'bg-destructive text-white shadow-xs hover:brightness-95 focus-visible:ring-destructive/30 dark:text-background',
        outline: 'border border-input bg-card text-foreground shadow-xs hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-foreground/85 hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-white shadow-xs hover:brightness-95 dark:text-background',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3 max-sm:h-11',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5 max-sm:h-10',
        xs: 'h-7 gap-1 rounded-sm px-2 has-[>svg]:px-1.5 max-sm:h-10 max-sm:px-3',
        lg: 'h-10 px-5 text-[15px] has-[>svg]:px-4 max-sm:h-11',
        icon: 'size-9 max-sm:size-11',
        'icon-sm': 'size-8 max-sm:size-10',
        'icon-xs': 'size-7 rounded-sm max-sm:size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** A CTA that still works in a read-only company (renewing, paying). */
  allowReadOnly?: boolean;
}

/**
 * Read-only company (PLAN.md §21.1: the subscription ended): the app frame sets this, and every CTA (the one main
 * create action of a screen) is disabled with the reason as its tooltip. The APIs refuse writes with 402 anyway.
 */
export const ReadOnlyContext = React.createContext(false);
const READ_ONLY_TITLE = 'Read-only: the subscription has ended';

export function Button({ className, variant, size, asChild = false, loading = false, allowReadOnly = false, disabled, children, title, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  const readOnly = React.useContext(ReadOnlyContext) && variant === 'cta' && !allowReadOnly;
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading || readOnly}
      aria-busy={loading || undefined}
      title={readOnly ? READ_ONLY_TITLE : title}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}
