/**
 * /billing/pay/:sessionId: the payment step of a checkout (PLAN.md §21.1, §21.4).
 * - Razorpay (BILLING_GATEWAY=razorpay): the order summary and "Pay", which opens Razorpay Checkout (checkout.js is loaded
 *   only here). Success → POST billing/razorpay/verify (signature checked on the server; the webhook stays the source of
 *   truth). In the phone app Checkout runs in redirect mode and comes back here with ?result=paid|failed.
 * - FakePay · test mode (dev, open demo): looks like a hosted payment page but is clearly a test: no real brand, no card
 *   numbers asked. Pay / Simulate failure / Cancel → POST billing/fake/:id/complete, a signed webhook like Razorpay's.
 */
import { errorMessage } from '@freefounders/core';
import {
  type CheckoutSession,
  type FakeOutcome,
  formatInr,
  INTERVAL_LABELS,
  useCheckoutSession,
  useFakeComplete,
  useRazorpayVerify,
} from '@freefounders/core/billing';
import { AlertTriangle, CheckCircle2, CreditCard, Landmark, Lock, Smartphone, XCircle } from '@/components/icons';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/primitives';
import { isInApp } from '@/lib/native-bridge';
import { openRazorpay } from '@/lib/razorpay';
import { cn } from '@/lib/utils';

type Method = 'upi' | 'card' | 'netbanking';
const METHODS: Array<{ key: Method; label: string; icon: typeof CreditCard }> = [
  { key: 'upi', label: 'UPI', icon: Smartphone },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'netbanking', label: 'Net banking', icon: Landmark },
];

const PAID = new Set(['paid', 'succeeded', 'success', 'completed']);
const FAILED = new Set(['failed', 'failure']);
const CANCELLED = new Set(['cancelled', 'canceled', 'expired']);

const settledOf = (s: CheckoutSession | undefined): FakeOutcome | null =>
  s ? (PAID.has(s.status) ? 'success' : FAILED.has(s.status) ? 'failure' : CANCELLED.has(s.status) ? 'cancel' : null) : null;

export function PayPage() {
  const { sessionId } = useParams();
  const q = useCheckoutSession(sessionId);
  const s = q.data;
  const razorpay = s?.gateway === 'razorpay';

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-[480px] items-center justify-between gap-2 px-4">
          {razorpay || !s ? (
            <span className="flex items-center gap-2 text-sm font-bold">
              <Lock className="size-4 text-primary" aria-hidden />
              FreeFounders · Secure payment
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2 font-mono text-sm font-bold tracking-wide">
                <span className="grid size-7 place-items-center rounded-md border-2 border-dashed border-warning text-[11px] text-warning" aria-hidden>
                  FP
                </span>
                FakePay
              </span>
              <span className="rounded-sm border border-warning/50 bg-warning/12 px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-warning uppercase">Test mode</span>
            </>
          )}
        </div>
      </header>
      <main id="content" className="mx-auto w-full max-w-[480px] flex-1 px-4 py-6">
        {q.isLoading ? (
          <div className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24" />
            <Skeleton className="h-11" />
          </div>
        ) : !s || !sessionId ? (
          <div className="rounded-xl border bg-card p-6 text-center shadow-card" role="alert">
            <XCircle className="mx-auto mb-3 size-10 text-destructive" aria-hidden />
            <h1 className="text-xl font-bold">Payment link not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">{q.error ? errorMessage(q.error) : 'This payment session does not exist or has expired.'}</p>
            <Button asChild className="mt-5 w-full">
              <Link to="/billing">Back to FreeFounders</Link>
            </Button>
          </div>
        ) : razorpay ? (
          <RazorpayPay s={s} sessionId={sessionId} />
        ) : (
          <FakePay s={s} sessionId={sessionId} />
        )}
      </main>
      <footer className="pb-6 text-center font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        {razorpay ? 'Payments by Razorpay · GST invoice from FreeFounders' : s ? 'FakePay · simulated gateway for testing FreeFounders' : ''}
      </footer>
    </div>
  );
}

/** Plan, lines, GST and the amount (both gateways). */
function OrderSummary({ s }: { s: CheckoutSession }) {
  return (
    <div className="border-b p-5">
      <p className="text-sm text-muted-foreground">Paying</p>
      <h1 className="text-lg font-bold">FreeFounders</h1>
      <p className="text-sm text-muted-foreground">
        {s.planName ?? s.plan} · {INTERVAL_LABELS[s.interval] ?? s.interval} · {s.seats} users · for {s.companyName}
      </p>
      <dl className="mt-4 space-y-1 text-sm">
        {s.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">{l.description}</dt>
            <dd className="font-mono tabular-nums">{formatInr(l.amount, true)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t pt-1">
          <dt className="text-muted-foreground">Taxable value</dt>
          <dd className="font-mono tabular-nums">{formatInr(s.subtotal, true)}</dd>
        </div>
        {s.igst > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">IGST 18%</dt>
            <dd className="font-mono tabular-nums">{formatInr(s.igst, true)}</dd>
          </div>
        ) : (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">CGST 9%</dt>
              <dd className="font-mono tabular-nums">{formatInr(s.cgst, true)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">SGST 9%</dt>
              <dd className="font-mono tabular-nums">{formatInr(s.sgst, true)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between gap-3 border-t pt-1.5 text-base font-bold">
          <dt>Amount</dt>
          <dd className="font-mono tabular-nums">{formatInr(s.total, true)}</dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Razorpay ───────────────────────────────────────────────────────────────

type Note = { kind: 'error' | 'info'; text: string };

function RazorpayPay({ s, sessionId }: { s: CheckoutSession; sessionId: string }) {
  const verify = useRazorpayVerify();
  const [params] = useSearchParams();
  const [opening, setOpening] = useState(false);
  const [note, setNote] = useState<Note | null>(() =>
    params.get('result') === 'failed' ? { kind: 'error', text: 'The payment did not go through. If money was taken it is refunded by Razorpay; you can try again.' } : null,
  );
  const settled = settledOf(s);
  if (settled) return <Result outcome={settled} total={s.total} test={false} />;
  const o = s.razorpay;
  const interval = s.interval === 'year' ? 'year' : 'month';

  const pay = async () => {
    if (!o) return;
    setNote(null);
    setOpening(true);
    try {
      await openRazorpay(
        o,
        {
          onPaid: (response) =>
            verify.mutate(
              { id: sessionId, response },
              { onError: (e) => setNote({ kind: 'error', text: `${errorMessage(e)} If money was taken, the plan turns active here within a few minutes.` }) },
            ),
          onFailed: (message) => setNote({ kind: 'error', text: `${message} Nothing was charged. You can try again.` }),
          onDismiss: () => setNote((n) => n ?? { kind: 'info', text: 'Payment window closed. Nothing was charged.' }),
        },
        { redirect: isInApp() },
      );
    } catch (e) {
      setNote({ kind: 'error', text: (e as Error).message });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <OrderSummary s={s} />
      <div className="space-y-3 p-5">
        {o?.keyId.startsWith('rzp_test_') && (
          <p className="flex items-start gap-2 rounded-md border border-dashed border-warning/50 bg-warning/8 px-3 py-2 text-[13px]" role="note">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Razorpay test mode: use Razorpay&apos;s test cards or UPI IDs. No real money moves.
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Pay by UPI, card or net banking. This sets up AutoPay: after this payment, Razorpay charges the plan each {interval} until you cancel in
          Billing. Your GST invoice comes from FreeFounders.
        </p>
        {!o && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            Payments are not set up yet. Please try again later.
          </p>
        )}
        {note && (
          <p
            role={note.kind === 'error' ? 'alert' : 'status'}
            className={cn('rounded-md border px-3 py-2 text-sm', note.kind === 'error' ? 'border-destructive/20 bg-destructive/8 text-destructive' : 'bg-muted/50 text-foreground')}
          >
            {note.text}
          </p>
        )}
        <Button variant="cta" allowReadOnly size="lg" className="h-12 w-full text-base" loading={opening || verify.isPending} disabled={!o || opening || verify.isPending} onClick={() => void pay()}>
          <Lock /> Pay {formatInr(s.total, true)}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link to="/billing">Back to Billing</Link>
        </Button>
      </div>
    </div>
  );
}

// ─── FakePay · test mode ────────────────────────────────────────────────────

function FakePay({ s, sessionId }: { s: CheckoutSession; sessionId: string }) {
  const complete = useFakeComplete();
  const [method, setMethod] = useState<Method>('upi');
  const [result, setResult] = useState<FakeOutcome | null>(null);

  const run = (outcome: FakeOutcome) => complete.mutate({ id: sessionId, outcome }, { onSuccess: () => setResult(outcome) });
  const settled = result ?? settledOf(s);

  return (
    <>
      <p className="mb-4 flex items-start gap-2 rounded-md border border-dashed border-warning/50 bg-warning/8 px-3 py-2 text-[13px]" role="note">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        This is a test payment page. No money moves and no card or bank details are asked for.
      </p>
      {settled ? (
        <Result outcome={settled} total={s.total} test />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <OrderSummary s={s} />
          <div className="p-5">
            <div role="tablist" aria-label="Payment method" className="mb-4 grid grid-cols-3 gap-1 rounded-md border bg-muted/50 p-0.5">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={method === m.key}
                  aria-controls="pay-method"
                  onClick={() => setMethod(m.key)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-1 text-[13px] font-semibold text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    method === m.key && 'bg-card text-foreground shadow-xs',
                  )}
                >
                  <m.icon className="size-4" aria-hidden />
                  {m.label}
                </button>
              ))}
            </div>
            <div id="pay-method" role="tabpanel" className="space-y-3">
              {method === 'upi' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fake-upi">UPI ID</Label>
                  <Input id="fake-upi" disabled placeholder="test@fakepay (not needed in test mode)" />
                </div>
              )}
              {method === 'card' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fake-card">Card</Label>
                  <Input id="fake-card" disabled placeholder="•••• •••• •••• •••• (not collected)" />
                  <p className="text-xs text-muted-foreground">Test mode never asks for a real card number.</p>
                </div>
              )}
              {method === 'netbanking' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fake-bank">Bank</Label>
                  <Input id="fake-bank" disabled placeholder="Test Bank (simulated)" />
                </div>
              )}
            </div>
            {complete.isError && (
              <p role="alert" className="mt-3 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {errorMessage(complete.error)}
              </p>
            )}
            <div className="mt-5 space-y-2">
              <Button variant="cta" allowReadOnly size="lg" className="h-12 w-full text-base" loading={complete.isPending && complete.variables?.outcome === 'success'} disabled={complete.isPending} onClick={() => run('success')}>
                <Lock /> Pay {formatInr(s.total, true)}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={complete.isPending} onClick={() => run('failure')}>
                  Simulate failure
                </Button>
                <Button variant="ghost" disabled={complete.isPending} onClick={() => run('cancel')}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Result({ outcome, total, test }: { outcome: FakeOutcome; total: number; test: boolean }) {
  const ok = outcome === 'success';
  return (
    <div className="rounded-xl border bg-card p-6 text-center shadow-card" role="status" aria-live="polite">
      {ok ? <CheckCircle2 className="mx-auto mb-3 size-12 text-success" aria-hidden /> : <XCircle className="mx-auto mb-3 size-12 text-destructive" aria-hidden />}
      <h1 className="text-xl font-bold">{ok ? 'Payment successful' : outcome === 'failure' ? 'Payment failed' : 'Payment cancelled'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {ok
          ? `${formatInr(total, true)} paid${test ? ' (test)' : ''}. Your plan is active.`
          : outcome === 'failure'
            ? test
              ? 'The test payment was declined. Nothing was charged.'
              : 'The payment did not go through. Nothing was charged.'
            : test
              ? 'You cancelled. Nothing was charged.'
              : 'This payment link has closed. Nothing was charged: start again from Billing.'}
      </p>
      <Button asChild size="lg" className="mt-5 h-11 w-full">
        <Link to="/billing">Back to FreeFounders</Link>
      </Button>
    </div>
  );
}
