import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';

/** Slide-over form shell: header, scrollable body, sticky footer. Ctrl/⌘+Enter submits. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitting,
  submitLabel = 'Save',
  secondaryAction,
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  onSubmit: (e: FormEvent) => void;
  submitting?: boolean;
  submitLabel?: string;
  secondaryAction?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size={size} onOpenAutoFocus={(e) => {
        // Focus the first field instead of the close button.
        e.preventDefault();
        const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea, button[role=combobox]');
        el?.focus();
      }}>
        <form
          className="flex h-full min-h-0 flex-col"
          onSubmit={onSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }
          }}
          noValidate
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <SheetBody className="space-y-6">{children}</SheetBody>
          <SheetFooter>
            <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd> to save
            </span>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {secondaryAction}
            <Button type="submit" loading={submitting}>
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
