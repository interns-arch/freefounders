/**
 * Uniform check before a check-in (PLAN.md §19.27). "remind": the company's message and "OK, punch in". "ask": the
 * same message with Yes / No; either answer continues the punch and is saved with the day. Cancel stops the punch.
 * The dialog is fully closed before the next step (location, browser camera, or the phone app's native camera) starts.
 */
import { UNIFORM_MESSAGE_DEFAULT, type UniformCheck } from '@freefounders/core/hr';
import { useRef } from 'react';
import { Shirt } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';

export function UniformPrompt({
  open,
  mode,
  message,
  onAnswer,
  onCancel,
}: {
  open: boolean;
  mode: Exclude<UniformCheck, 'off'>;
  message?: string;
  /** remind: always undefined; ask: the answer. Called once the dialog has finished closing. */
  onAnswer: (wearing: boolean | undefined) => void;
  onCancel: () => void;
}) {
  // The answer waits until the dialog has closed (focus returned), so nothing opens on top of it.
  const pending = useRef<{ wearing: boolean | undefined } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) onAnswer(p.wearing);
  };
  const answer = (wearing: boolean | undefined) => {
    pending.current = { wearing };
    onCancel(); // closes the dialog; the punch continues in finish()
    timer.current = setTimeout(finish, 400); // in case the close event does not come
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending.current && onCancel()}>
      <DialogContent
        className="max-w-sm gap-5 max-sm:p-5"
        aria-describedby="uniform-message"
        onCloseAutoFocus={(e) => {
          if (pending.current) e.preventDefault();
          finish();
        }}
      >
        <DialogHeader className="items-center pr-0 text-center">
          <span className="mb-2 flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
            <Shirt className="size-7" />
          </span>
          <DialogTitle>{mode === 'ask' ? 'Company uniform' : 'Uniform reminder'}</DialogTitle>
          <DialogDescription id="uniform-message" className="text-base text-foreground/85">
            {message?.trim() || UNIFORM_MESSAGE_DEFAULT}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-stretch">
          {mode === 'ask' ? (
            <>
              <Button variant="cta" size="lg" className="w-full" onClick={() => answer(true)}>
                Yes, I'm wearing it
              </Button>
              <Button variant="outline" size="lg" className="w-full" onClick={() => answer(false)}>
                No
              </Button>
            </>
          ) : (
            <Button variant="cta" size="lg" className="w-full" onClick={() => answer(undefined)}>
              OK, punch in
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
