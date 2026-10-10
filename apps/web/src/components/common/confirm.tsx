import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  destructive?: boolean;
  /** Ask for a note (e.g. reason). `required` makes it mandatory. */
  note?: { label: string; placeholder?: string; required?: boolean; minLength?: number };
}
type Resolver = (result: { confirmed: boolean; note: string }) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<{ confirmed: boolean; note: string }>) | null>(null);

/** `const confirm = useConfirm(); if ((await confirm({...})).confirmed) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const resolver = useRef<Resolver | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setNote('');
    setNoteError(null);
    return new Promise<{ confirmed: boolean; note: string }>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (confirmed: boolean) => {
    resolver.current?.({ confirmed, note: note.trim() });
    resolver.current = null;
    setOpts(null);
  };

  // The confirm button is never disabled: pressing it with a missing note says what is missing, next to the field.
  const minLength = opts?.note?.minLength ?? 1;
  const noteInvalid = !!opts?.note?.required && note.trim().length < minLength;
  const tryConfirm = () => {
    if (noteInvalid) {
      setNoteError(note.trim().length === 0 ? `${opts?.note?.label ?? 'A note'} is required.` : `Please write at least ${minLength} characters.`);
      noteRef.current?.focus();
      return;
    }
    close(true);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description && <DialogDescription asChild><div>{opts.description}</div></DialogDescription>}
          </DialogHeader>
          {opts?.note && (
            <div className="grid gap-1.5">
              <label className="text-sm font-semibold" htmlFor="confirm-note">
                {opts.note.label}
                {opts.note.required && <span className="text-destructive"> *</span>}
              </label>
              <Textarea
                id="confirm-note"
                ref={noteRef}
                autoFocus
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError(null);
                }}
                placeholder={opts.note.placeholder}
                rows={3}
                required={opts.note.required}
                aria-required={opts.note.required || undefined}
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteError ? 'confirm-note-error' : opts.note.minLength ? 'confirm-note-hint' : undefined}
              />
              {noteError ? (
                <p id="confirm-note-error" role="alert" className="text-sm font-medium text-destructive">
                  {noteError}
                </p>
              ) : opts.note.minLength ? (
                <p id="confirm-note-hint" className="text-xs text-muted-foreground">
                  At least {opts.note.minLength} characters
                </p>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={opts?.destructive ? 'destructive' : 'default'} onClick={tryConfirm} autoFocus={!opts?.note}>
              {opts?.confirmText ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
