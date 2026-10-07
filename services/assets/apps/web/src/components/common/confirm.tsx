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
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setNote('');
    return new Promise<{ confirmed: boolean; note: string }>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (confirmed: boolean) => {
    resolver.current?.({ confirmed, note: note.trim() });
    resolver.current = null;
    setOpts(null);
  };

  const noteInvalid = !!opts?.note?.required && note.trim().length < (opts.note.minLength ?? 1);

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
              <label className="text-[13px] font-medium" htmlFor="confirm-note">
                {opts.note.label}
                {opts.note.required && <span className="text-destructive"> *</span>}
              </label>
              <Textarea id="confirm-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={opts.note.placeholder} rows={3} />
              {opts.note.minLength && <p className="text-xs text-muted-foreground">At least {opts.note.minLength} characters</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={opts?.destructive ? 'destructive' : 'default'} disabled={noteInvalid} onClick={() => close(true)} autoFocus={!opts?.note}>
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
