import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Minus } from 'lucide-react';
import { Avatar as AvatarPrimitive, Checkbox as CheckboxPrimitive, Progress as ProgressPrimitive, Separator as SeparatorPrimitive, Switch as SwitchPrimitive, Tabs as TabsPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn, initials } from '@/lib/utils';

// ─── Card ─────────────────────────────────────────────────────────────────
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-lg border bg-card text-card-foreground shadow-card', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 pb-3', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-[15px] font-bold tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

// ─── Badge ────────────────────────────────────────────────────────────────
export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold leading-[1.5] [&>svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        gray: 'border-border bg-muted text-foreground',
        blue: 'border-info/20 bg-info/10 text-info',
        indigo: 'border-primary/20 bg-primary/10 text-primary',
        violet: 'border-app-attendance/20 bg-app-attendance/10 text-app-attendance',
        green: 'border-success/20 bg-success/10 text-success',
        amber: 'border-warning/20 bg-warning/10 text-warning',
        orange: 'border-warning/20 bg-warning/10 text-warning',
        red: 'border-destructive/20 bg-destructive/10 text-destructive',
        cyan: 'border-info/20 bg-info/10 text-info',
        outline: 'border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({ className, tone, dot, children, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

// ─── Skeleton / Separator / Progress ─────────────────────────────────────
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted/80', className)} {...props} />;
}

export function Separator({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative
      orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}

export function Progress({ value, className, indicatorClassName }: { value: number; className?: string; indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} value={value}>
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full bg-gradient-to-r from-brand-2 to-primary transition-all duration-500', indicatorClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

// ─── Checkbox / Switch ───────────────────────────────────────────────────
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // The box stays 16 px; on phones an invisible pseudo-element widens the tap area to about 44 px without moving anything.
        "peer relative size-4 shrink-0 cursor-pointer rounded-[4px] border border-input bg-card shadow-xs outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground max-sm:before:absolute max-sm:before:-inset-3.5 max-sm:before:content-['']",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input hover:data-[state=unchecked]:bg-input/80 max-sm:before:absolute max-sm:before:-inset-3 max-sm:before:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('no-scrollbar inline-flex h-10 w-full items-center gap-1 overflow-x-auto overflow-y-hidden border-b max-sm:h-11', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset data-[state=active]:border-primary data-[state=active]:text-primary max-sm:h-11 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────
export const TooltipProvider = TooltipPrimitive.Provider;

// ─── Avatar ───────────────────────────────────────────────────────────────
// Theme colours only, so dark mode and the brand colour follow automatically.
const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-app-assets/15 text-app-assets',
  'bg-warning/15 text-warning',
  'bg-app-attendance/15 text-app-attendance',
  'bg-info/15 text-info',
  'bg-success/15 text-success',
  'bg-app-admin/15 text-app-admin',
];

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const n = name ?? '?';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return (
    <AvatarPrimitive.Root className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-current/10 ring-inset', className)}>
      <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn('flex size-full items-center justify-center text-xs font-bold', AVATAR_COLORS[h % AVATAR_COLORS.length])}>
        {initials(n)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
