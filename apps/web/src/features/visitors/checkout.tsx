/**
 * The check-out QR (PLAN.md §22.11): /v/<company code>/<checkout token>/out. No sign-in. The page finds the visitor's
 * visit only from this phone's device secret (kept at check-in): optional feedback (1–5 + a comment), then "Check out"
 * gives a 4-digit check-out code for the guard, who approves it. Another phone sees only "open this on the phone you
 * checked in with".
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { useDeviceState, usePublicCheckout, useRequestCheckout } from '@kaampilot/core/visitors';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, Clock, LogOut, ShieldCheck, Smartphone, Star } from '@/components/icons';
import { Field } from '@/components/common/form';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BigCode, PublicCard, PublicShell, readDevice, until, usePublicBrand } from './public-parts';

const RATINGS = ['Poor', 'Could be better', 'Okay', 'Good', 'Excellent'];

export function PublicCheckoutPage() {
  const { code = '', token = '' } = useParams();
  const page = usePublicCheckout(code, token);
  const [device] = useState(() => readDevice(code));
  const state = useDeviceState(code, device, !!page.data);
  const request = useRequestCheckout(code, token);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const p = page.data;
  const company = p?.company || 'Visitor check-out';
  usePublicBrand(p?.colour);
  useEffect(() => {
    document.title = `${company} · Visitor check-out`;
  }, [company]);

  if (page.isLoading || (p && state.isLoading)) return <PageLoader />;
  if (page.error || !p) {
    return (
      <PublicShell company="" kicker="Visitor check-out" title="This link is not valid">
        <PublicCard role="alert" className="space-y-2 text-center">
          <ShieldCheck className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <p className="text-[15px]">Please ask the guard at the gate to check you out.</p>
        </PublicCard>
      </PublicShell>
    );
  }
  const s = state.data ?? p.visit;
  const first = s.first_name ?? '';

  const go = async () => {
    setError('');
    try {
      await request.mutateAsync({ device, rating, comment: comment.trim() || undefined });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Open this on the phone you checked in with, or ask the guard.' : errorMessage(e));
    }
  };

  const shell = (title: string, subtitle: string | undefined, body: React.ReactNode) => (
    <PublicShell company={company} logoUrl={p.logo_url} kicker="Visitor check-out" title={title} subtitle={subtitle}>
      {body}
    </PublicShell>
  );

  if (s.state === 'out') {
    return shell(
      `Thank you for visiting${first ? `, ${first}` : ''}!`,
      'You are checked out. Have a safe journey.',
      <PublicCard className="space-y-2 text-center" role="status" data-testid="checkout-done">
        <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
        <p className="text-[15px] text-muted-foreground">We hope to see you again.</p>
      </PublicCard>,
    );
  }
  if (s.state === 'leaving' && s.code) {
    return shell(
      `Almost done${first ? `, ${first}` : ''}`,
      'Show this code to the guard on your way out.',
      <PublicCard className="space-y-4" role="status" data-testid="checkout-pending">
        <BigCode code={s.code} label="Your check-out code" testId="checkout-code" />
        <p className="text-center text-[17px] font-semibold">Show this to the guard</p>
        {s.expires_at && (
          <p className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <Clock className="size-4" aria-hidden /> Works until {until(s.expires_at)}
          </p>
        )}
      </PublicCard>,
    );
  }
  if (s.state === 'pending' && s.code) {
    return shell(
      'You are not checked in yet',
      'Show your check-in code to the guard first.',
      <PublicCard>
        <BigCode code={s.code} label="Your check-in code" />
      </PublicCard>,
    );
  }
  if (s.state !== 'inside' && s.state !== 'held') {
    return shell(
      'Check out',
      undefined,
      <PublicCard role="alert" className="space-y-3 text-center" data-testid="checkout-other-device">
        <Smartphone className="mx-auto size-10 text-primary" aria-hidden />
        <p className="text-[17px] font-semibold">Open this on the phone you checked in with, or ask the guard.</p>
        <p className="text-[13px] text-muted-foreground">For your privacy, only that phone can check you out.</p>
      </PublicCard>,
    );
  }
  return shell(
    `Thank you for visiting${first ? `, ${first}` : ''}!`,
    'Tell us how it went, then check out.',
    <PublicCard className="space-y-5">
      {s.state === 'held' && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[15px] font-medium text-warning">
          The guard asked you to wait. Please speak to the guard, then check out again.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-[15px] font-semibold">How was your visit? (optional)</legend>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Rating">
          {RATINGS.map((label, i) => {
            const n = i + 1;
            const on = rating != null && n <= rating;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n}: ${label}`}
                onClick={() => setRating(rating === n ? null : n)}
                data-testid={`rating-${n}`}
                className={cn(
                  'flex h-14 cursor-pointer flex-col items-center justify-center rounded-md border text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted',
                )}
              >
                <Star className="size-5" aria-hidden />
                {n}
              </button>
            );
          })}
        </div>
        {rating != null && <p className="text-center text-[13px] text-muted-foreground">{RATINGS[rating - 1]}</p>}
      </fieldset>
      <Field label="Anything to tell us? (optional)">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 300))} rows={3} className="text-base" name="comment" />
      </Field>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      )}
      <Button variant="cta" size="lg" className="h-13 w-full text-base" onClick={() => void go()} loading={request.isPending}>
        <LogOut /> Check out
      </Button>
    </PublicCard>,
  );
}
