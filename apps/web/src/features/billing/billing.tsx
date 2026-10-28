/**
 * Admin → Billing (/billing, PLAN.md §20.6, §21.1, §24.1): the plan and its state, users, the plan picker (modules one by
 * one or Complete, with or without AI, users, a live total with GST), checkout through the payment page, GST details,
 * invoices, change users, cancel / resume, and the dev tools (billing clock) while BILLING_DEV_TOOLS is on. Owner, or a
 * role with "Manage billing".
 */
import { errorMessage, parseBuyNow } from '@kaampilot/core';
import {
  type BillingModuleKey,
  type BillingPricing,
  type BillingProfile,
  type BillingSummary,
  choiceName,
  daysUntil,
  formatInr,
  gstinMatchesState,
  INDIAN_STATES,
  isGstin,
  isPaidPlan,
  type Plan,
  planLabel,
  planMaxSeats,
  planMinSeats,
  quotePlan,
  useBilling,
  useBillingPricing,
  useCancelSubscription,
  useDevAdvance,
  useDevRenew,
  useEmailInvoice,
  billingExports,
  useInvoices,
  usePlans,
  useResumeSubscription,
  useSaveBillingProfile,
  useSetSeats,
  useStartCheckout,
  useSwitchToFree,
} from '@kaampilot/core/billing';
import { CalendarClock, Check, CheckSquare, CreditCard, FileText, Mail, Package, Sparkles, Timer, Wrench } from '@/components/icons';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { DownloadButton, DownloadMenu } from '@/components/common/download-menu';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Card, Checkbox, Switch } from '@/components/ui/primitives';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { SeatStepper, StateBadge } from './parts';

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
      {plansError ? <ErrorState error={plansError} /> : <ChoosePlan b={b} />}
      <GstDetails profile={b.profile} />
      <Invoices emailProblem={b.invoiceEmail} />
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
  // An older plan (Suite…) is no longer listed: the server's per-user price says it is paid (PLAN.md §24.1).
  const paid = ((b.perUser ?? 0) > 0 || (!!plan && isPaidPlan(plan))) && (b.state === 'active' || b.state === 'past_due' || b.state === 'cancelled');
  const [seats, setSeatCount] = useState(b.seats.paid);
  useEffect(() => setSeatCount(b.seats.paid), [b.seats.paid]);
  const minSeats = Math.max(plan ? planMinSeats(plan) : 1, b.seats.used);
  const trialLeft = daysUntil(b.trialEndsAt, b.now);

  const doCancel = async () => {
    const ok = await confirm({
      title: 'Cancel at the end of the period?',
      description: b.freeAvailable
        ? `Everything keeps working until ${formatDate(b.currentPeriodEnd)}. After that the company moves to Free if it fits (up to 3 users), otherwise it becomes read-only.`
        : `Everything keeps working until ${formatDate(b.currentPeriodEnd)}. After that the company becomes read-only (everyone can look and export) until a plan is paid again.`,
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
          <Fact label={b.cancelAtPeriodEnd ? 'Ends on' : b.paysEachPeriod ? 'Paid until' : 'Renews on'}>{formatDate(b.currentPeriodEnd)}</Fact>
        )}
        <Fact label="Users">
          <span className="font-mono tabular-nums">{b.seats.used}</span> used · <span className="font-mono tabular-nums">{b.seats.paid}</span> paid
          {b.seats.limit != null && <span className="block text-xs text-muted-foreground">{b.state === 'trialing' ? `The trial allows ${b.seats.limit}` : `Limit ${b.seats.limit}`}</span>}
        </Fact>
        {(b.perUser ?? 0) > 0 && (
          <Fact label="Per user">
            {formatInr(b.perUser)}
            <span className="block text-xs text-muted-foreground">per month{b.ai ? ', with AI' : ''}</span>
          </Fact>
        )}
        <Fact label={b.paysEachPeriod ? 'Next payment (you pay it here)' : 'Next charge'}>
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

// ─── choose a plan (PLAN.md §24.1) ──────────────────────────────────────────

const MODULE_ICONS: Record<BillingModuleKey, typeof CheckSquare> = { tasks: CheckSquare, attendance: CalendarClock, assets: Package };

/** What the current subscription has, as a starting choice: its modules, or Complete (also the trial and Suite). */
function initialChoice(b: BillingSummary): { complete: boolean; modules: BillingModuleKey[] } {
  if (b.plan === 'modules' && b.modules?.length) return { complete: false, modules: b.modules };
  if (b.plan === 'tasks' || b.plan === 'free') return { complete: false, modules: ['tasks', 'attendance'] };
  if (b.plan === 'assets') return { complete: false, modules: ['assets'] };
  return { complete: true, modules: ['tasks', 'attendance'] };
}

function ChoosePlan({ b }: { b: BillingSummary }) {
  const pricing = useBillingPricing();
  if (pricing.isLoading) return <Section id="choose-plan" title="Choose your plan"><PageLoader /></Section>;
  if (pricing.error || !pricing.data) return <ErrorState error={pricing.error} onRetry={() => void pricing.refetch()} />;
  return <PlanPicker b={b} p={pricing.data} />;
}

function PlanPicker({ b, p }: { b: BillingSummary; p: BillingPricing }) {
  const openCheckout = useOpenCheckout();
  const checkout = useStartCheckout();
  // "Upgrade now" in the trial banner (PLAN.md §24.4): /billing?buy=complete&users=3#choose-plan preselects the plan.
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const asked = useMemo(() => parseBuyNow(params), [params]);
  const start = useMemo(() => (asked ? { complete: asked.complete, modules: asked.complete ? (['tasks', 'attendance'] as BillingModuleKey[]) : asked.modules } : initialChoice(b)), [b, asked]);
  const [complete, setComplete] = useState(start.complete);
  const [modules, setModules] = useState<BillingModuleKey[]>(start.modules);
  const [ai, setAi] = useState(asked ? asked.ai : !!b.ai);
  const min = Math.max(p.minSeats, b.seats.used, 1);
  const [users, setUsers] = useState(() => Math.max(asked?.users ?? (b.seats.paid || 0), min));
  useEffect(() => {
    if (hash === '#choose-plan') document.getElementById('choose-plan')?.scrollIntoView({ block: 'start' });
  }, [hash]);
  useEffect(() => setUsers((u) => Math.max(min, u)), [min]);
  const q = quotePlan(p, { complete, modules, ai, users });
  const name = choiceName(p, { complete, modules, ai });
  const noModule = !complete && modules.length === 0;
  const sameAsNow =
    b.state === 'active' &&
    users === b.seats.paid &&
    ai === !!b.ai &&
    (complete ? b.plan === 'complete' : b.plan === 'modules' && [...modules].sort().join() === [...(b.modules ?? [])].sort().join());
  const needsReadOnlyCta = b.state === 'read_only' || b.state === 'suspended' || b.state === 'past_due';
  const toggle = (k: BillingModuleKey, on: boolean) => setModules((list) => (on ? [...new Set([...list, k])] : list.filter((x) => x !== k)));

  const go = () =>
    checkout.mutate(complete ? { plan: 'complete', ai, interval: 'month', seats: users } : { plan: 'modules', modules, ai, interval: 'month', seats: users }, {
      onSuccess: (r) => (r?.checkoutUrl ? openCheckout(r.checkoutUrl) : toast.success('Plan changed')),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const aiExtra = (price: number, aiPrice: number) => formatInr(aiPrice - price);
  const firstModule = p.modules[0];

  return (
    <Section
      id="choose-plan"
      title={b.state === 'trialing' || needsReadOnlyCta ? 'Choose your plan' : 'Change plan'}
      description={`Price per user per month. Pick the modules you need, or Complete for everything. GST ${p.gstPercent}% is added.`}
    >
      <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
        {[false, true].map((isComplete) => {
          const on = complete === isComplete;
          return (
            <button
              key={String(isComplete)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setComplete(isComplete)}
              className={cn(
                'flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border bg-card p-4 text-left transition outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40',
                on && 'border-primary ring-1 ring-primary',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-base font-bold">{isComplete ? p.complete.name : 'Pick modules'}</span>
                {on && <Check className="size-4 text-primary" aria-hidden />}
              </span>
              <span className="text-[22px] leading-tight font-bold tabular-nums">
                {isComplete ? formatInr(ai ? p.complete.aiPrice : p.complete.price) : `${formatInr(firstModule ? (ai ? firstModule.aiPrice : firstModule.price) : 0)}`}
                <span className="text-sm font-medium text-muted-foreground">{isComplete ? ' / user / month' : ' / module / user / month'}</span>
              </span>
              <span className="text-[13px] text-muted-foreground">
                {isComplete ? 'Every module: Tasks, Attendance, Assets, Visitors, Payroll and everything else.' : 'Tasks, Attendance, Assets: only the ones you need.'}
              </span>
            </button>
          );
        })}
      </div>

      {!complete && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-semibold">Modules</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {p.modules.map((m) => {
              const Icon = MODULE_ICONS[m.key] ?? CheckSquare;
              const checked = modules.includes(m.key);
              return (
                <label
                  key={m.key}
                  htmlFor={`module-${m.key}`}
                  className={cn('flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/40', checked && 'border-primary')}
                >
                  <Checkbox id={`module-${m.key}`} checked={checked} onCheckedChange={(v) => toggle(m.key, v === true)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Icon className="size-4 text-muted-foreground" aria-hidden /> {m.name}
                    </span>
                    <span className="block font-mono text-sm tabular-nums">{formatInr(ai ? m.aiPrice : m.price)} / user / month</span>
                    {m.description && <span className="block text-xs text-muted-foreground">{m.description}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {noModule && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-destructive">
              Choose at least one module.
            </p>
          )}
        </fieldset>
      )}

      <div className="mt-4 flex items-start gap-3 rounded-lg border bg-card p-3">
        <Switch id="plan-ai" checked={ai} onCheckedChange={setAi} className="mt-0.5" />
        <label htmlFor="plan-ai" className="min-w-0 cursor-pointer">
          <span className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden /> With AI
          </span>
          <span className="block text-xs text-muted-foreground">
            The AI helper for the whole subscription:{' '}
            {complete
              ? `${formatInr(p.complete.aiPrice)} instead of ${formatInr(p.complete.price)} per user`
              : firstModule
                ? `${aiExtra(firstModule.price, firstModule.aiPrice)} more per module per user`
                : ''}
            .
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-5 border-t pt-4 md:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="space-y-1.5">
          <Label htmlFor="checkout-seats">Users</Label>
          <SeatStepper id="checkout-seats" value={users} onChange={setUsers} min={min} max={null} />
          <p className="text-xs text-muted-foreground">At least {min} ({b.seats.used} in use). Paid monthly.</p>
          {q.completeIsCheaper && (
            <p className="mt-2 rounded-md border border-primary/30 bg-primary/8 px-3 py-2 text-sm">
              Complete costs less: {formatInr(ai ? p.complete.aiPrice : p.complete.price)} per user for every module.{' '}
              <button type="button" className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setComplete(true)}>
                Choose Complete
              </button>
            </p>
          )}
          {b.freeAvailable && <FreeChoice b={b} />}
        </div>
        <div className="rounded-lg border bg-muted/30 p-4" aria-labelledby="order-title" aria-live="polite">
          <h3 id="order-title" className="mb-2 text-sm font-semibold">
            Order summary
          </h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="min-w-0 text-muted-foreground">{name}</dt>
              <dd className="font-mono whitespace-nowrap tabular-nums">{formatInr(q.perUser)} / user</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                {users} user{users === 1 ? '' : 's'} × {formatInr(q.perUser)}
              </dt>
              <dd className="font-mono tabular-nums">{formatInr(q.monthly)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">GST {p.gstPercent}%</dt>
              <dd className="font-mono tabular-nums">{formatInr(q.gst)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
              <dt>Total per month</dt>
              <dd className="font-mono tabular-nums">{formatInr(q.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            CGST + SGST or IGST is worked out from your GST state on the payment page.
            {(b.perUser ?? 0) > 0 && (b.state === 'active' || b.state === 'cancelled') ? ' Unused time on your current plan comes off the price.' : ''}
            {b.checkoutGateway === 'cashfree' && ' Paid by UPI, card or net banking through Cashfree, one month at a time: nothing is charged by itself, you pay each month here.'}
          </p>
          {b.checkoutGateway === null && (
            <p role="status" className="mt-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs">
              Payments are not set up yet. Please try again later.
            </p>
          )}
          <Button
            variant="cta"
            allowReadOnly={needsReadOnlyCta}
            size="lg"
            className="mt-3 h-11 w-full"
            disabled={noModule || sameAsNow || b.checkoutGateway === null}
            loading={checkout.isPending}
            onClick={go}
          >
            <CreditCard /> {sameAsNow ? 'Your current plan' : 'Continue to payment'}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** The older Free plan, still offered to companies from before §24.1 (PLAN.md §21.7). */
function FreeChoice({ b }: { b: BillingSummary }) {
  const confirm = useConfirm();
  const toFree = useSwitchToFree();
  const [freeError, setFreeError] = useState<string | null>(null);
  const paidNow = (b.perUser ?? 0) > 0 && (b.state === 'active' || b.state === 'cancelled');
  const goFree = async () => {
    const limits = 'up to 3 users with Attendance and Tasks; the Assets app is switched off for the company (nothing is deleted, it comes back with a paid plan)';
    const ok = await confirm({
      title: 'Switch to the Free plan?',
      description: paidNow
        ? `Your ${b.planName ?? b.plan} plan keeps working until ${formatDate(b.currentPeriodEnd)} and is not renewed. Then the company moves to Free: ${limits}.`
        : b.state === 'trialing'
          ? `The trial ends now and the company moves to Free: ${limits}. No payment is needed.`
          : `The company moves to Free now and can be used again (read-only ends): ${limits}. No payment is needed.`,
      confirmText: 'Switch to Free',
    });
    if (!ok.confirmed) return;
    setFreeError(null);
    toFree.mutate(undefined, {
      onSuccess: (r) => toast.success(r?.freeFrom === 'period_end' ? `Moves to Free on ${formatDate(r.currentPeriodEnd)}` : 'You are on the Free plan'),
      onError: (e) => {
        setFreeError(errorMessage(e));
        toast.error(errorMessage(e));
      },
    });
  };
  return (
    <div className="mt-3 border-t pt-3 text-sm">
      <p className="text-muted-foreground">Your company can still use the Free plan (up to 3 users, Attendance and Tasks).</p>
      <Button variant="ghost" size="sm" className="mt-1 px-0" allowReadOnly disabled={b.cancelAtPeriodEnd} loading={toFree.isPending} onClick={() => void goFree()}>
        Switch to Free
      </Button>
      {freeError && (
        <p role="alert" className="mt-1 font-medium text-destructive">
          {freeError}
        </p>
      )}
    </div>
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

function Invoices({ emailProblem }: { emailProblem?: string | null }) {
  const navigate = useNavigate();
  const q = useInvoices();
  const email = useEmailInvoice();
  type Row = NonNullable<typeof q.data>[number];
  const columns: Column<Row>[] = [
    { key: 'number', header: 'Invoice', cell: (r) => <span className="font-mono font-semibold">{r.number}</span> },
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date ?? r.issuedAt) },
    { key: 'period', header: 'Period', hideOnMobile: true, cell: (r) => (r.periodStart ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : '—') },
    { key: 'total', header: 'Total', className: 'text-right', headerClassName: 'text-right', cell: (r) => <span className="font-mono tabular-nums">{formatInr(r.total, true)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <span className="capitalize">{r.status ?? 'paid'}</span> },
    {
      // PLAN.md §24.5: the invoice email (PDF attached) to the owner and the billing email.
      key: 'email',
      header: 'Email',
      hideOnMobile: true,
      cell: (r) =>
        r.emailedAt ? (
          <span className="text-sm" title={(r.emailedTo ?? []).join(', ')}>
            Sent {formatDateTime(r.emailedAt)}
          </span>
        ) : r.emailError ? (
          <span className="text-sm text-destructive" title={r.emailError}>
            Not sent
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'send',
      header: <span className="sr-only">Send again</span>,
      className: 'text-right',
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            allowReadOnly
            aria-label={`Email invoice ${r.number} again`}
            loading={email.isPending && email.variables === r.id}
            disabled={email.isPending}
            onClick={() =>
              email.mutate(r.id, {
                onSuccess: (res) => (res.sent ? toast.success(`Invoice sent to ${res.to.join(', ')}`) : toast.error(res.error ?? 'The invoice email was not sent')),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            <Mail /> Send again
          </Button>
        </span>
      ),
    },
    {
      key: 'pdf',
      header: <span className="sr-only">PDF</span>,
      className: 'text-right',
      cell: (r) => (
        // the row opens the invoice; the button only downloads
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DownloadButton filename={fileSlug('invoice', r.number)} target={billingExports.invoicePdf(r.id)} aria-label={`Download invoice ${r.number} as PDF`}>
            PDF
          </DownloadButton>
        </span>
      ),
    },
  ];
  return (
    <Section
      id="invoices"
      title="Invoices"
      description={
        emailProblem
          ? `GST tax invoices. Open one to print, or download it as PDF. Invoices are not emailed right now: ${emailProblem}.`
          : 'GST tax invoices, emailed with the PDF to the owner and the billing email. Open one to print, or download it as PDF.'
      }
      actions={<DownloadMenu filename={fileSlug('billing-invoices', todayStamp())} target={billingExports.invoices()} empty={q.data?.length === 0} loading={!q.data} />}
    >
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

