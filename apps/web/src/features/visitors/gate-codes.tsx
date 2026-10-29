/**
 * The gate's V4 parts (PLAN.md §22.11): the big "Visitor code" box (4-digit check-in code), the dialog that shows
 * whose visit it is before anything happens (Approve check-in / Turn away), Approve check-out / Hold on a visitor in
 * "Waiting to leave" (V4.1: no check-out code), and the host's answer on a visit card (where to wait, "Sent to …",
 * "No answer yet" + Call host).
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { type CodeHit, type Visit, type VisitorConfig, useAcceptVisit, useApproveCheckout, useFindByCode, useHoldCheckout, useRejectVisit, useSentToPlace, useVisitPhoto } from '@kaampilot/core/visitors';
import { type FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Hand, Hash, LogIn, LogOut, MapPin, Phone, ShieldAlert, UserRoundX } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, CardContent } from '@/components/ui/primitives';
import { PhotoField, PrivatePhoto, WatchNote, clock, formatMinutes, hostName } from './parts';

/** The big code box at the top of the gate (works on a phone: numeric keyboard, 4 big digits, looks up at 4). */
export function CodeEntry({ onHit }: { onHit: (hit: CodeHit) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const find = useFindByCode();
  const ref = useRef<HTMLInputElement>(null);
  const go = async (value: string) => {
    if (value.length !== 4 || find.isPending) return;
    setError('');
    try {
      const hit = await find.mutateAsync(value);
      setCode('');
      onHit(hit);
    } catch (e) {
      setError(e instanceof ApiError && e.errors?.code ? e.errors.code : errorMessage(e));
      ref.current?.select();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void go(code);
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" data-testid="code-entry">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor="visitor-code" className="flex items-center gap-1.5 text-[15px] font-semibold">
              <Hash className="size-4 text-primary" aria-hidden /> Visitor code
            </label>
            <p className="text-[13px] text-muted-foreground">The 4-digit check-in code on the visitor’s phone.</p>
            <Input
              id="visitor-code"
              ref={ref}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCode(v);
                setError('');
                if (v.length === 4) void go(v);
              }}
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="0000"
              aria-invalid={!!error}
              aria-describedby={error ? 'visitor-code-error' : undefined}
              className="h-16 max-w-56 text-center font-mono text-4xl font-bold tracking-[0.5em]"
            />
          </div>
          <Button type="submit" size="lg" className="h-16 px-6" loading={find.isPending} disabled={code.length !== 4}>
            Find
          </Button>
          {error && (
            <p id="visitor-code-error" role="alert" className="w-full text-[13px] font-medium text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** "Waiting to leave" (V4.1): the visitor tapped Check out on their phone; the guard approves or holds (with a note
 * the visitor sees on their phone). No code. */
export function LeavingActions({ visit: v }: { visit: Visit }) {
  const approveOut = useApproveCheckout();
  const hold = useHoldCheckout();
  const confirm = useConfirm();
  const out = async () => {
    try {
      const done = await approveOut.mutateAsync(v.id);
      toast.success(`${done.name} checked out · ${formatMinutes(done.minutes_inside)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const holdIt = async () => {
    const r = await confirm({
      title: `Hold ${v.name}'s check-out?`,
      description: 'They stay inside. Their phone shows “The guard asked you to wait” with your note.',
      confirmText: 'Hold',
      note: { label: 'Note for the visitor (e.g. please come to the gate desk)' },
    });
    if (!r.confirmed) return;
    try {
      await hold.mutateAsync({ id: v.id, note: r.note });
      toast.success(`${v.name}: check-out held`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <Button size="lg" variant="success" onClick={() => void out()} loading={approveOut.isPending} data-testid={`approve-checkout-${v.id}`}>
        <LogOut /> Approve check-out
      </Button>
      <Button size="lg" variant="outline" onClick={() => void holdIt()} disabled={approveOut.isPending || hold.isPending}>
        <Hand /> Hold
      </Button>
    </>
  );
}

/** Whose visit the code is: details + photo first, then the guard approves (or turns away). */
export function CodeDialog({ hit, config, gate, onClose }: { hit: CodeHit | null; config: VisitorConfig; gate: number | null; onClose: () => void }) {
  const v = hit?.visit;
  const photo = useVisitPhoto(v?.has_photo ? v.id : null);
  const [shot, setShot] = useState<string | null>(null);
  const [blocked, setBlocked] = useState('');
  const accept = useAcceptVisit();
  const reject = useRejectVisit();
  const confirm = useConfirm();
  if (!hit || !v) return null;
  const needPhoto = config.photo_visitor === 'required' && !v.has_photo;
  const close = () => {
    setShot(null);
    setBlocked('');
    onClose();
  };

  const approveIn = async (watchOk = false): Promise<void> => {
    if (needPhoto && !shot) return void toast.error("Take the visitor's photo first.");
    try {
      const done = await accept.mutateAsync({ id: v.id, via: 'code', location: v.location?.id ?? gate, ...(shot ? { photo: shot } : {}), ...(watchOk ? { watch_ok: true } : {}) });
      toast.success(`${done.name} checked in · pass ${done.pass_no}`);
      close();
    } catch (e) {
      const errs = e instanceof ApiError ? e.errors : undefined;
      if (errs?.watchlist) return void setBlocked(errs.watchlist);
      if (errs?.watchlist_warn && !watchOk) {
        const r = await confirm({ title: 'Watchlist', description: errs.watchlist_warn, confirmText: 'Let them in', destructive: true });
        if (r.confirmed) await approveIn(true);
        return;
      }
      toast.error(errorMessage(e));
    }
  };
  const turnAway = async () => {
    const r = await confirm({ title: `Turn ${v.name} away?`, description: 'They are not let in. This is recorded.', confirmText: 'Turn away', destructive: true, note: { label: 'Reason (optional)' } });
    if (!r.confirmed) return;
    try {
      await reject.mutateAsync({ id: v.id, reason: r.note });
      toast.success(`${v.name} turned away`);
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const facts: Array<[string, string]> = [
    ['To meet', hostName(v)],
    ['Purpose', v.purpose],
    ['From', v.company],
    ['Mobile', v.mobile],
    ['People', v.people > 1 ? String(v.people) : ''],
    ['Vehicle', v.vehicle_no],
    ['Items', v.items],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" data-testid="code-dialog">
        <DialogHeader>
          <DialogTitle>{`Check in ${v.name}?`}</DialogTitle>
          <DialogDescription>Check the person matches the photo and the details.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <PrivatePhoto query={photo} alt={v.name} className="size-28 shrink-0" />
          <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-sm">
            {facts
              .filter(([, x]) => x)
              .map(([k, x]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{x}</dd>
                </div>
              ))}
          </dl>
        </div>
        <WatchNote note={v.watch_note} />
        {blocked && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {blocked}
          </p>
        )}
        {needPhoto && (
          <Field label="Visitor photo" required>
            <PhotoField label="Visitor photo" value={shot} onChange={setShot} required testId="code-photo" />
          </Field>
        )}
        <div className="flex flex-wrap gap-2 max-sm:[&>button]:flex-1">
          <Button size="lg" variant="success" onClick={() => void approveIn()} loading={accept.isPending}>
            <LogIn /> Approve check-in
          </Button>
          <Button size="lg" variant="outline" onClick={() => void turnAway()} disabled={accept.isPending}>
            <UserRoundX /> Turn away
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}

/** tel: link from a stored WhatsApp number (10 digits = India). */
const telOf = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return `tel:+${d.length === 10 ? `91${d}` : d}`;
};

const SAID: Record<string, string> = { coming: 'is coming to the gate', unavailable: 'is not available' };

/** On a visit card inside: what the host said (or "No answer yet" + Call host), and "Sent to <place>". */
export function HostAnswerLine({ visit: v }: { visit: Visit }) {
  const sent = useSentToPlace();
  if (v.status !== 'inside') return null;
  const host = v.host?.name.split(' ')[0] || hostName(v);
  if (v.host_answer) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/8 px-2.5 py-1.5 text-[13px]" data-testid={`host-answer-${v.id}`}>
        <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="font-semibold">
          {host}: {v.host_answer === 'place' ? `wait at ${v.host_place}` : SAID[v.host_answer]}
        </span>
        {v.host_note && <span className="text-muted-foreground">· {v.host_note}</span>}
        {v.host_answer === 'place' &&
          (v.sent_to_place_at ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Check className="size-4" aria-hidden /> Sent {clock(v.sent_to_place_at)}
            </span>
          ) : (
            <Button
              size="xs"
              variant="outline"
              loading={sent.isPending}
              onClick={() =>
                void sent.mutateAsync(v.id).then(
                  () => toast.success(`${v.name} sent to ${v.host_place}`),
                  (e: unknown) => toast.error(errorMessage(e)),
                )
              }
            >
              Sent to {v.host_place}
            </Button>
          ))}
      </div>
    );
  }
  if (v.host_no_answer) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning" data-testid={`host-no-answer-${v.id}`}>
        <span className="font-semibold">No answer yet from {host}</span>
        {v.host_phone && (
          <Button asChild size="xs" variant="outline">
            <a href={telOf(v.host_phone)}>
              <Phone /> Call host
            </a>
          </Button>
        )}
      </div>
    );
  }
  if (v.host_notified_at) return <p className="text-[13px] text-muted-foreground">Asked {host} where to wait…</p>;
  return null;
}
