/**
 * "Finish payment" (PLAN.md §24.4): a company made with "Buy now" that has not paid yet. The app frame shows only this
 * screen (the apps are not set up until it is paid): the plan, Pay (continues the open payment or starts a new one) and
 * "Start the free trial instead" when the company never had a trial. Not paid within 7 days: the company is removed.
 */
import { errorMessage } from '@kaampilot/core';
import { formatInr, useBilling, useStartCheckout, useStartTrialInstead } from '@kaampilot/core/billing';
import { Clock, CreditCard } from '@/components/icons';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ErrorState, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';
import { useOpenCheckout } from './billing';

const GST = 0.18;

export function FinishPayment({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    return (
      <Card className="mx-auto mt-6 max-w-lg p-6 text-center">
        <h1 className="text-xl font-bold">Waiting for payment</h1>
        <p className="mt-2 text-sm text-muted-foreground">This company opens as soon as the owner pays for its plan.</p>
      </Card>
    );
  }
  return <FinishPaymentOwner />;
}

function FinishPaymentOwner() {
  const navigate = useNavigate();
  const summary = useBilling();
  const checkout = useStartCheckout();
  const trial = useStartTrialInstead();
  const openCheckout = useOpenCheckout();
  if (summary.isLoading) return <PageLoader />;
  const b = summary.data;
  if (summary.error || !b) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  const p = b.pending;
  if (!p) return <PageLoader />;
  const monthly = p.perUser * p.seats;
  const total = Math.round(monthly * (1 + GST));
  const busy = checkout.isPending || trial.isPending;

  const pay = () => {
    if (p.openCheckout) return void openCheckout(p.openCheckout.checkoutUrl);
    checkout.mutate(b.plan === 'modules' ? { plan: 'modules', modules: b.modules ?? [], ai: !!b.ai, interval: 'month', seats: p.seats } : { plan: b.plan, ai: !!b.ai, interval: 'month', seats: p.seats }, {
      onSuccess: (r) => openCheckout(r.checkoutUrl),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  const startTrial = () =>
    trial.mutate(undefined, {
      onSuccess: (r) => {
        if (r?.setupIncomplete) toast.warning('Your trial has started, but part of the app set-up has not finished. It finishes by itself in a few minutes.', { duration: 15_000 });
        navigate('/?home=1&welcome=1', { replace: true });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <div className="mx-auto max-w-xl space-y-4 py-2">
      <Card className="p-5 sm:p-6" role="region" aria-labelledby="finish-payment-title">
        <h1 id="finish-payment-title" className="text-[22px] font-bold tracking-tight">
          Finish your payment
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Your company is ready. Pay for your plan to open the apps.</p>
        <dl className="mt-5 space-y-1.5 rounded-md border bg-muted/30 p-4 text-sm" data-testid="finish-payment-plan">
          <div className="flex justify-between gap-3 font-semibold">
            <dt>{b.planName ?? b.plan}</dt>
            <dd className="tabular-nums">{formatInr(p.perUser)} / user / month</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {p.seats} {p.seats === 1 ? 'user' : 'users'}, one month
            </dt>
            <dd className="tabular-nums">{formatInr(monthly)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
            <dt>Total with GST</dt>
            <dd className="tabular-nums">{formatInr(total)}</dd>
          </div>
        </dl>
        {b.checkoutGateway === null && (
          <p role="status" className="mt-3 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
            Payments are not set up yet. Please try again later, or start the free trial.
          </p>
        )}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button variant="cta" allowReadOnly size="lg" className="h-11" loading={checkout.isPending} disabled={busy || b.checkoutGateway === null} onClick={pay}>
            <CreditCard /> {p.openCheckout ? 'Continue to payment' : 'Pay again'}
          </Button>
          {p.canStartTrial && (
            <Button variant="outline" allowReadOnly size="lg" className="h-11" loading={trial.isPending} disabled={busy} onClick={startTrial}>
              Start the free trial instead
            </Button>
          )}
        </div>
        {trial.isPending && <p className="mt-3 text-sm text-muted-foreground" role="status">Setting up your apps… this takes a few seconds.</p>}
        {p.payBy && (
          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Not paid by {formatDate(p.payBy)}: the company is removed (nothing is charged). You can sign up again any time.
          </p>
        )}
      </Card>
    </div>
  );
}
