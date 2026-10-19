/**
 * Admin → Billing (/billing, PLAN.md §20.6, §21.1): the plan and its state, seats, plans with monthly / yearly prices,
 * an order summary with GST, checkout through the payment page, GST details, invoices, change seats, cancel / resume,
 * and the dev tools (billing clock) while BILLING_DEV_TOOLS is on. Owner, or a role with "Manage billing".
 */
import { errorMessage } from '@freefounders/core';
import {
  type BillingInterval,
  type BillingProfile,
  type BillingSummary,
  daysUntil,
  formatInr,
  GST_RATE,
  gstinMatchesState,
  INDIAN_STATES,
  isGstin,
  isPaidPlan,
  type Plan,
  planLabel,
  planMaxSeats,
  planMinSeats,
  planPrice,
  useBilling,
  useCancelSubscription,
  useDevAdvance,
  useDevRenew,
  useInvoices,
  usePlans,
  useResumeSubscription,
  useSaveBillingProfile,
  useSetSeats,
  useStartCheckout,
} from '@freefounders/core/billing';
import { APP_NAMES } from '@freefounders/core/admin';
import { Check, CreditCard, FileText, Timer, Wrench } from '@/components/icons';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Card } from '@/components/ui/primitives';
import { cn, formatDate } from '@/lib/utils';
import { SeatStepper, StateBadge } from './parts';

const appsText = (apps: Plan['apps']) => apps.map((a) => (a === 'tasks' ? 'Attendance + Tasks' : APP_NAMES[a] ?? a)).join(' · ');

/** Opens the payment page the server named: our own pages in-app, anything else as a full page. */
export function useOpenCheckout() {
  const navigate = useNavigate();
  return (url: string) => {
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin) return navigate(u.pathname + u.search);
    } catch {
      /* not a URL: fall through */
    }
    window.location.assign(url);
  };
}

export function BillingPage() {
  const summary = useBilling();
  const plans = usePlans();
  if (summary.isLoading || plans.isLoading) return <PageLoader />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  return <Billing b={summary.data} plans={plans.data ?? []} plansError={plans.error} />;
}

function Billing({ b, plans, plansError }: { b: BillingSummary; plans: Plan[]; plansError: unknown }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Billing" description="Your plan, users, GST details and invoices." />
      <CurrentPlan b={b} plans={plans} />
      {b.devTools && <DevTools b={b} />}
      {plansError ? <ErrorState error={plansError} /> : <ChoosePlan b={b} plans={plans} />}
      <GstDetails profile={b.profile} />
      <Invoices />
    </div>
  );
}

function Section({ title, description, children, id, actions }: { title: string; description?: ReactNode; children: ReactNode; id: string; actions?: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5" aria-labelledby={id} role="region">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] font-semibold tracking-wider text-foreground/75 uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

// ─── current plan ───────────────────────────────────────────────────────────

function CurrentPlan({ b, plans }: { b: BillingSummary; plans: Plan[] }) {
  const confirm = useConfirm();
  const cancel = useCancelSubscription();
  const resume = useResumeSubscription();
  const setSeats = useSetSeats();
  const plan = plans.find((p) => p.key === b.plan);
  const paid = !!plan && isPaidPlan(plan) && (b.state === 'active' || b.state === 'past_due' || b.state === 'cancelled');
  const [seats, setSeatCount] = useState(b.seats.paid);
  useEffect(() => setSeatCount(b.seats.paid), [b.seats.paid]);
  const minSeats = Math.max(plan ? planMinSeats(plan) : 1, b.seats.used);
  const trialLeft = daysUntil(b.trialEndsAt, b.now);

  const doCancel = async () => {
    const ok = await confirm({
      title: 'Cancel at the end of the period?',
      description: `Everything keeps working until ${formatDate(b.currentPeriodEnd)}. After that the company moves to Free if it fits (up to 3 users), otherwise it becomes read-only.`,
      confirmText: 'Cancel subscription',
      destructive: true,
    });
    if (ok.confirmed) cancel.mutate(undefined, { onSuccess: () => toast.success('Cancelled at the end of the period'), onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <Section
      id="current-plan"
      title="Current plan"
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{b.planName ?? planLabel(b.plan, plans)}</span>
          <StateBadge state={b.state} />
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Fact label="Billing">{b.interval && paid ? (b.interval === 'year' ? 'Yearly' : 'Monthly') : '—'}</Fact>
        {b.state === 'trialing' ? (
          <Fact label="Trial ends">
            {formatDate(b.trialEndsAt)}
            {trialLeft != null && <span className="block text-xs text-muted-foreground">{trialLeft} days left</span>}
          </Fact>
        ) : (
          <Fact label={b.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}>{formatDate(b.currentPeriodEnd)}</Fact>
        )}
        <Fact label="Users">
          <span className="font-mono tabular-nums">{b.seats.used}</span> used · <span className="font-mono tabular-nums">{b.seats.paid}</span> paid
          {b.seats.limit != null && <span className="block text-xs text-muted-foreground">Limit {b.seats.limit}</span>}
        </Fact>
        <Fact label="Next charge">
          {b.nextCharge ? (
            <>
              {formatInr(b.nextCharge.total)}
              <span className="block text-xs text-muted-foreground">on {formatDate(b.nextCharge.date)} incl. GST</span>
            </>
          ) : (
            '—'
          )}
        </Fact>
      </dl>
      {b.cancelAtPeriodEnd && (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-sm">Cancelled: it stops at the end of the period ({formatDate(b.currentPeriodEnd)}).</p>
      )}
      {paid && (
        <div className="mt-5 flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor="current-seats">Paid users</Label>
            <div className="flex flex-wrap items-center gap-2">
              <SeatStepper id="current-seats" value={seats} onChange={setSeatCount} min={minSeats} max={plan ? planMaxSeats(plan) : null} />
              <Button
                variant="outline"
                disabled={seats === b.seats.paid}
                loading={setSeats.isPending}
                onClick={() =>
                  setSeats.mutate(seats, {
                    onSuccess: () => toast.success(seats > b.seats.paid ? 'Users added: the extra days are on the next invoice' : 'Users reduced from the next period'),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              >
                Change users
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">More users: charged for the rest of this period on the next invoice. Fewer: from the next period.</p>
          </div>
          {b.cancelAtPeriodEnd ? (
            <Button variant="outline" loading={resume.isPending} onClick={() => resume.mutate(undefined, { onSuccess: () => toast.success('Subscription resumed'), onError: (e) => toast.error(errorMessage(e)) })}>
              Resume subscription
            </Button>
          ) : (
            <Button variant="ghost" className="text-destructive hover:text-destructive" loading={cancel.isPending} onClick={() => void doCancel()}>
              Cancel at period end
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

// ─── choose a plan ──────────────────────────────────────────────────────────

function ChoosePlan({ b, plans }: { b: BillingSummary; plans: Plan[] }) {
  const openCheckout = useOpenCheckout();
  const checkout = useStartCheckout();
  const shown = useMemo(() => plans.filter((p) => p.public !== false && p.selfServe !== false && p.key !== 'complimentary'), [plans]);
  const [interval, setBillingInterval] = useState<BillingInterval>(b.interval ?? 'month');
  const [selected, setSelected] = useState<string>(() => {
    const cur = shown.find((p) => p.key === b.plan && isPaidPlan(p));
    return cur?.key ?? shown.find((p) => p.key === 'suite')?.key ?? shown.find(isPaidPlan)?.key ?? shown[0]?.key ?? '';
  });
  const plan = shown.find((p) => p.key === selected);
  const min = plan ? Math.max(planMinSeats(plan), isPaidPlan(plan) ? b.seats.used : 1) : 1;
  const max = plan ? planMaxSeats(plan) : null;
  const [seats, setSeats] = useState(() => Math.max(b.seats.paid || 0, b.seats.used, 5));
  useEffect(() => setSeats((s) => Math.max(min, max != null ? Math.min(max, s) : s)), [min, max]);

  const isCurrent = (p: Plan) => p.key === b.plan && (b.state === 'active' || (p.key === 'free' && b.state !== 'trialing')) && (!isPaidPlan(p) || b.interval === interval);
  const price = plan ? planPrice(plan, interval) : 0;
  const subtotal = plan && isPaidPlan(plan) ? price * seats : 0;
  const gst = Math.round((subtotal * GST_RATE) / 100);
  const tooMany = !!plan && max != null && b.seats.used > max;
  const needsReadOnlyCta = b.state === 'read_only' || b.state === 'suspended' || b.state === 'past_due';

  const go = () => {
    if (!plan) return;
    checkout.mutate(
      { plan: plan.key, interval, seats: isPaidPlan(plan) ? seats : Math.max(1, b.seats.used) },
      {
        onSuccess: (r) => (r?.checkoutUrl ? openCheckout(r.checkoutUrl) : toast.success('Plan changed')),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Section
      id="choose-plan"
      title={b.state === 'trialing' ? 'Choose a plan' : 'Plans'}
      description="Price per user. Yearly = 2 months free. GST 18% is added."
      actions={
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-md border bg-muted/50 p-0.5">
          {(['month', 'year'] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setBillingInterval(i)}
              className={cn(
                'min-h-9 cursor-pointer rounded-sm px-3 text-sm font-semibold text-muted-foreground transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:min-h-10',
                interval === i && 'bg-card text-foreground shadow-xs',
              )}
            >
              {i === 'month' ? 'Monthly' : 'Yearly'}
              {i === 'year' && <span className="ml-1 text-xs font-medium text-success">−2 months</span>}
            </button>
          ))}
        </div>
      }
    >
      <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((p) => {
          const on = p.key === selected;
          const pp = planPrice(p, interval);
          const pMax = planMaxSeats(p);
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(p.key)}
              className={cn(
                'relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border bg-card p-4 text-left transition outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40',
                on && 'border-primary ring-1 ring-primary',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-base font-bold">{p.name}</span>
                {isCurrent(p) ? (
                  <span className="rounded-sm bg-success/10 px-1.5 py-0.5 text-xs font-semibold text-success">Current</span>
                ) : on ? (
                  <Check className="size-4 text-primary" aria-hidden />
                ) : null}
              </span>
              <span className="text-[22px] leading-tight font-bold tabular-nums">
                {isPaidPlan(p) ? formatInr(pp) : '₹0'}
                <span className="text-sm font-medium text-muted-foreground"> {isPaidPlan(p) ? `/ user / ${interval === 'year' ? 'year' : 'month'}` : 'forever'}</span>
              </span>
              <span className="text-[13px] text-muted-foreground">{appsText(p.apps) || '—'}</span>
              <span className="text-[13px] text-muted-foreground">
                {pMax != null ? `Up to ${pMax} users` : `From ${planMinSeats(p)} users`}
              </span>
              {p.description && <span className="text-[13px] text-muted-foreground">{p.description}</span>}
            </button>
          );
        })}
      </div>

      {plan && (
        <div className="mt-5 grid gap-5 border-t pt-4 md:grid-cols-[1fr_minmax(0,22rem)]">
          <div className="space-y-1.5">
            {isPaidPlan(plan) ? (
              <>
                <Label htmlFor="checkout-seats">Users</Label>
                <SeatStepper id="checkout-seats" value={seats} onChange={setSeats} min={min} max={max} />
                <p className="text-xs text-muted-foreground">
                  At least {min} ({b.seats.used} in use{planMinSeats(plan) > 1 ? `, plan minimum ${planMinSeats(plan)}` : ''}).
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {plan.name} is free for up to {max ?? '—'} users{plan.apps.length ? ` with ${appsText(plan.apps)}` : ''}.
                {tooMany && <span className="mt-1 block font-medium text-destructive">You have {b.seats.used} users: switch some off first, or choose a paid plan.</span>}
              </p>
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-4" aria-labelledby="order-title">
            <h3 id="order-title" className="mb-2 text-sm font-semibold">
              Order summary
            </h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">
                  {plan.name} · {isPaidPlan(plan) ? `${seats} × ${formatInr(price)}` : 'free'}
                </dt>
                <dd className="font-mono tabular-nums">{formatInr(subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">GST {GST_RATE}%</dt>
                <dd className="font-mono tabular-nums">{formatInr(gst)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
                <dt>Total {isPaidPlan(plan) ? `per ${interval === 'year' ? 'year' : 'month'}` : ''}</dt>
                <dd className="font-mono tabular-nums">{formatInr(subtotal + gst)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">CGST + SGST or IGST is worked out from your GST state on the payment page.</p>
            <Button
              variant="cta"
              allowReadOnly={needsReadOnlyCta}
              size="lg"
              className="mt-3 h-11 w-full"
              disabled={(isCurrent(plan) && (!isPaidPlan(plan) || seats === b.seats.paid)) || tooMany}
              loading={checkout.isPending}
              onClick={go}
            >
              <CreditCard /> {isPaidPlan(plan) ? 'Continue to payment' : `Switch to ${plan.name}`}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── GST details ────────────────────────────────────────────────────────────

function GstDetails({ profile }: { profile: BillingProfile | null }) {
  const save = useSaveBillingProfile();
  // Every field as text: a profile made from a sign-up by mobile number has no email (null), which broke Save.
  const [v, setV] = useState<BillingProfile>(() => ({
    legalName: profile?.legalName ?? '',
    gstin: profile?.gstin ?? '',
    state: profile?.state ?? '',
    address: profile?.address ?? '',
    email: profile?.email ?? '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof BillingProfile, string>>>({});
  const set = (k: keyof BillingProfile, value: string) => {
    setV((x) => ({ ...x, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const gstin = (v.gstin ?? '').trim().toUpperCase();
    const next: typeof errors = {
      legalName: v.legalName.trim() ? undefined : 'Enter the legal name for invoices.',
      state: v.state ? undefined : 'Choose the state.',
      gstin: !gstin ? undefined : !isGstin(gstin) ? 'A GSTIN has 15 characters, like 27AAPFU0939F1ZV.' : !gstinMatchesState(gstin, v.state) ? 'The first two digits must be the code of the chosen state.' : undefined,
      email: !v.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) ? undefined : 'Enter a valid email.',
    };
    setErrors(next);
    const first = (Object.keys(next) as Array<keyof BillingProfile>).find((k) => next[k]);
    if (first) return document.getElementById(`gst-${first}`)?.focus();
    save.mutate(
      { legalName: v.legalName.trim(), gstin: gstin || null, state: v.state, address: v.address.trim(), email: v.email.trim() },
      { onSuccess: () => toast.success('GST details saved'), onError: (err) => toast.error(errorMessage(err)) },
    );
  };
  const field = (k: keyof BillingProfile, label: string, input: ReactNode, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`gst-${k}`}>{label}</Label>
      {input}
      {errors[k] ? (
        <p id={`gst-${k}-error`} role="alert" className="text-[13px] font-medium text-destructive">
          {errors[k]}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
  const aria = (k: keyof BillingProfile) => ({ id: `gst-${k}`, 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `gst-${k}-error` : undefined });
  return (
    <Section id="gst-details" title="GST details" description="Printed on your tax invoices. The GSTIN is optional (for input tax credit).">
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {field('legalName', 'Legal name', <Input {...aria('legalName')} value={v.legalName} onChange={(e) => set('legalName', e.target.value)} autoComplete="organization" />)}
        {field('gstin', 'GSTIN (optional)', <Input {...aria('gstin')} value={v.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} className="font-mono uppercase" autoCapitalize="characters" />)}
        {field(
          'state',
          'State',
          <NativeSelect {...aria('state')} value={v.state} onChange={(e) => set('state', e.target.value)}>
            <option value="">Choose…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code}>{s.name}</option>
            ))}
          </NativeSelect>,
        )}
        {field('email', 'Billing email', <Input {...aria('email')} type="email" value={v.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />, 'Invoices are sent here.')}
        <div className="sm:col-span-2">{field('address', 'Address', <Textarea {...aria('address')} rows={2} value={v.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />)}</div>
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending} allowReadOnly>
            Save GST details
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ─── invoices ───────────────────────────────────────────────────────────────

function Invoices() {
  const navigate = useNavigate();
  const q = useInvoices();
  type Row = NonNullable<typeof q.data>[number];
  const columns: Column<Row>[] = [
    { key: 'number', header: 'Invoice', cell: (r) => <span className="font-mono font-semibold">{r.number}</span> },
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date ?? r.issuedAt) },
    { key: 'period', header: 'Period', hideOnMobile: true, cell: (r) => (r.periodStart ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : '—') },
    { key: 'total', header: 'Total', className: 'text-right', headerClassName: 'text-right', cell: (r) => <span className="font-mono tabular-nums">{formatInr(r.total, true)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <span className="capitalize">{r.status ?? 'paid'}</span> },
  ];
  return (
    <Section id="invoices" title="Invoices" description="GST tax invoices. Open one to print or save it as PDF.">
      <DataTable
        columns={columns}
        rows={q.data}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => navigate(`/billing/invoices/${r.id}`)}
        empty={<p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><FileText className="size-4" aria-hidden /> No invoices yet.</p>}
      />
    </Section>
  );
}

// ─── dev tools ──────────────────────────────────────────────────────────────

function DevTools({ b }: { b: BillingSummary }) {
  const advance = useDevAdvance();
  const renew = useDevRenew();
  const busy = advance.isPending || renew.isPending;
  const done = (what: string) => ({ onSuccess: () => toast.success(what), onError: (e: unknown) => toast.error(errorMessage(e)) });
  return (
    <section aria-labelledby="dev-tools" className="rounded-xl border border-dashed border-warning/50 bg-warning/5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="dev-tools" className="flex items-center gap-2 text-base font-semibold">
          <Wrench className="size-4 text-warning" aria-hidden /> Dev tools · test mode only
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Timer className="size-4" aria-hidden /> Billing clock: <span className="font-mono font-semibold text-foreground">{formatDate(b.now)}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Advance billing clock:</span>
        {[1, 7, 30].map((d) => (
          <Button key={d} size="sm" variant="outline" allowReadOnly disabled={busy} onClick={() => advance.mutate(d, done(`Clock moved ${d} day${d === 1 ? '' : 's'}`))}>
            +{d} day{d === 1 ? '' : 's'}
          </Button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Next renewal:</span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => renew.mutate('success', done('Renewal succeeded'))}>
          Succeed now
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => renew.mutate('failure', done('Renewal failed (payment failed)'))}>
          Fail now
        </Button>
      </div>
    </section>
  );
}

