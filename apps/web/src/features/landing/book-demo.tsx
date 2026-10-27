/**
 * "Book a demo" (PLAN.md §24.2): a small form (name, email; both optional) and then Calendly's booking pop-up with them
 * filled in. The event link is the Platform's `calendlyUrl` (GET /api/platform/public/pricing); while it is not set the
 * button writes an email to support instead. Used on the landing page and, signed in, in the account menu.
 */
import { usePublicPricing } from '@kaampilot/core';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, Mail } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { DEMO_MAILTO, isCalendlyUrl, openCalendly, SUPPORT_EMAIL } from '@/lib/calendly';

/** The dialog alone (controlled): the account menu opens it. */
export function BookDemoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pricing } = usePublicPricing();
  const url = isCalendlyUrl(pricing.calendlyUrl) ? pricing.calendlyUrl : null;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url) {
      window.location.href = DEMO_MAILTO;
      return;
    }
    setBusy(true);
    try {
      await openCalendly(url, { name, email });
      onOpenChange(false);
    } catch {
      toast.error(`The booking calendar could not be opened. Write to ${SUPPORT_EMAIL} and we will set up a time.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Book a demo</DialogTitle>
            <DialogDescription>
              {url
                ? 'A short video call: we show Kaampilot for your kind of team and answer your questions. Pick a time on the next screen; Calendly emails you the confirmation and a reminder.'
                : `Write to us at ${SUPPORT_EMAIL} and we will set up a time that suits you.`}
            </DialogDescription>
          </DialogHeader>
          {url && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="demo-name">Your name</Label>
                <Input id="demo-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="demo-email">Work email</Label>
                <Input id="demo-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {url ? <CalendarCheck className="size-4" /> : <Mail className="size-4" />}
              {url ? 'Choose a time' : 'Write an email'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the dialog. */
export function BookDemoButton({
  children = 'Book a demo',
  variant = 'outline',
  size = 'lg',
  className,
}: {
  children?: ReactNode;
  variant?: 'outline' | 'default' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <CalendarCheck className="size-4" /> {children}
      </Button>
      <BookDemoDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
