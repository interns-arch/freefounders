/**
 * /console/companies/:id (PLAN.md §21.9): one company for Kaampilot staff: people (name, login, role, active, last
 * sign-in), subscription, invoices, payments, plan changes and staff actions. Read-only; opening it writes a
 * `view.company` row in the staff audit log. The existing staff actions stay on the Companies tab; the company's own
 * trial (days, users; PLAN.md §24.1) is set here, and so are a "Buy now" company waiting for payment (mark paid, more
 * days; §24.4), the billing email and "Send again" for an invoice (§24.5).
 */
import { errorMessage } from '@kaampilot/core';
import { type DashboardCompany, formatInr, planLabel, STATE_LABELS, useConsoleAction, useDashboardCompany, usePlans } from '@kaampilot/core/billing';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AlertTriangle, ChevronLeft, Mail } from '@/components/icons';
import { useConfirm } from '@/components/common/confirm';
import { DataTable } from '@/components/common/data-table';
import { BACK_LINK, DetailList, DETAIL_TITLE, ErrorState, PageLoader } from '@/components/common/page';
import { Badge } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ACTION_LABELS, auditSummary } from './console';
import { ago, Section, StatTile, useStaff } from './console-parts';
import { StateBadge } from './parts';

/**
 * This company's trial (PLAN.md §24.1): its length in days from its start and how many users it allows, instead of the
 * defaults. A trial that ended read-only without any payment starts again when the new end is later.
 */
function TrialOverride({ company: c, trialStart }: { company: DashboardCompany; trialStart: string }) {
  const act = useConsoleAction();
  const [days, setDays] = useState('');
  const [users, setUsers] = useState(c.trialMaxUsers != null ? String(c.trialMaxUsers) : '');
  const d = days ? Number(days) : undefined;
  const u = users ? Number(users) : undefined;
  const ok = (d === undefined || (Number.isInteger(d) && d >= 1 && d <= 365)) && (u === undefined || (Number.isInteger(u) && u >= 1)) && (d !== undefined || u !== undefined);
  return (
    <Section id="company-trial" title="Trial">
      <p className="mb-3 text-sm text-muted-foreground">
        Overrides the default trial for this company only. Days count from the start ({formatDate(trialStart)}); a trial that ended read-only without a payment starts again.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          act.mutate(
            { id: c.id, kind: 'trialOverride', days: d, maxUsers: u },
            { onSuccess: () => (setDays(''), toast.success('Trial saved')), onError: (err) => toast.error(errorMessage(err)) },
          );
        }}
      >
        <div className="w-32 space-y-1.5">
          <Label htmlFor="co-trial-days">Days from start</Label>
          <Input id="co-trial-days" type="number" inputMode="numeric" min={1} max={365} value={days} placeholder="unchanged" onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="w-32 space-y-1.5">
          <Label htmlFor="co-trial-users">Users</Label>
          <Input id="co-trial-users" type="number" inputMode="numeric" min={1} value={users} onChange={(e) => setUsers(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={!ok} loading={act.isPending}>
          Save trial
        </Button>
      </form>
    </Section>
  );
}

/** PLAN.md §24.4: a "Buy now" company that has not paid: mark it paid (paid outside the gateway) or give it more days. */
function PendingPayment({ company: c }: { company: DashboardCompany }) {
  const act = useConsoleAction();
  const confirm = useConfirm();
  const [days, setDays] = useState('7');
  const d = Number(days);
  const ok = Number.isInteger(d) && d >= 1 && d <= 60;
  const markPaid = async () => {
    const r = await confirm({
      title: 'Mark this company paid?',
      description: `${c.planName ?? c.plan} starts now for one month without a gateway payment (e.g. paid by bank transfer), and its apps are set up. No invoice is made.`,
      confirmText: 'Mark paid',
    });
    if (r.confirmed) act.mutate({ id: c.id, kind: 'markPaid' }, { onSuccess: () => toast.success('Marked paid: plan active'), onError: (err) => toast.error(errorMessage(err)) });
  };
  return (
    <Section id="company-pending" title="Waiting for payment">
      <p className="mb-3 text-sm text-muted-foreground">
        Chose {c.planName ?? c.plan} with Buy now and has not paid. Removed on {formatDate(c.payBy ?? null)} if still unpaid and nothing but the owner is in it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" loading={act.isPending && act.variables?.kind === 'markPaid'} disabled={act.isPending} onClick={() => void markPaid()}>
          Mark paid
        </Button>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) act.mutate({ id: c.id, kind: 'extendPending', days: d }, { onSuccess: () => toast.success(`${d} more days to pay`), onError: (err) => toast.error(errorMessage(err)) });
          }}
        >
          <div className="w-28 space-y-1.5">
            <Label htmlFor="co-pending-days">More days</Label>
            <Input id="co-pending-days" type="number" inputMode="numeric" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={!ok || act.isPending} loading={act.isPending && act.variables?.kind === 'extendPending'}>
            Extend
          </Button>
        </form>
      </div>
    </Section>
  );
}

/** PLAN.md §24.5: invoices go to the owner and to this address. */
function BillingEmail({ company: c, current }: { company: DashboardCompany; current: string | null }) {
  const act = useConsoleAction();
  const [email, setEmail] = useState(current ?? '');
  const valid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        act.mutate({ id: c.id, kind: 'billingEmail', email: email.trim() || null }, { onSuccess: () => toast.success('Billing email saved'), onError: (err) => toast.error(errorMessage(err)) });
      }}
    >
      <div className="w-72 max-w-full space-y-1.5">
        <Label htmlFor="co-billing-email">Billing email</Label>
        <Input id="co-billing-email" type="email" value={email} placeholder="Only the owner" onChange={(e) => setEmail(e.target.value)} aria-invalid={valid ? undefined : true} />
      </div>
      <Button type="submit" variant="outline" disabled={!valid || act.isPending} loading={act.isPending && act.variables?.kind === 'billingEmail'}>
        Save
      </Button>
    </form>
  );
}

export function ConsoleCompanyPage() {
  const { ready, staff } = useStaff();
  const { id } = useParams();
  const detail = useDashboardCompany(id, staff);
  const plans = usePlans();
  const act = useConsoleAction();
  if (ready && !staff) return <Navigate to="/" replace />;
  if (detail.isLoading || !ready) return <PageLoader />;
  if (detail.error || !detail.data) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const { company: c, people, subscription: s, invoices, payments, planChanges, audit, billingProfile, errors7d } = detail.data;
  const active = people.filter((p) => p.active).length;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/console/companies" className={BACK_LINK}>
        <ChevronLeft /> Companies
      </Link>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className={DETAIL_TITLE}>{c.name}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{c.code}</p>
        </div>
        <div className="ml-auto">
          <StateBadge state={c.state} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Plan" value={c.planName ?? planLabel(c.plan, plans.data)} hint={s ? (s.interval === 'year' ? 'yearly' : 'monthly') : undefined} />
        <StatTile label="Users used / paid" value={`${c.seats.used} / ${c.seats.paid || '—'}`} hint={`${active} of ${people.length} people active`} />
        <StatTile label="MRR" value={formatInr(c.mrr)} />
        <StatTile label="Server errors, 7 days" value={errors7d} tone={errors7d > 0 ? 'danger' : undefined} hint={`last activity ${ago(c.lastActivity)}`} />
      </dl>
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <DetailList
          columns={3}
          items={[
            { label: 'Owner', value: c.owner },
            { label: 'Created', value: formatDate(c.createdAt) },
            { label: 'Apps', value: (c.apps ?? []).map((a) => (a === 'tasks' ? 'Tasks' : a === 'assets' ? 'Assets' : a)).join(', ') },
            { label: 'Plan modules', value: c.modules ? c.modules.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ') : 'Every module' },
            { label: 'AI', value: c.ai ? 'Yes' : 'No' },
            { label: 'Trial users', value: c.trialMaxUsers != null ? String(c.trialMaxUsers) : null },
            { label: 'Modules switched off', value: c.modulesOff.join(', ') },
            { label: 'State', value: STATE_LABELS[c.state] ?? c.state },
            { label: 'Trial ends', value: s?.trialEndsAt ? formatDate(s.trialEndsAt) : null },
            { label: 'Period', value: s?.currentPeriodStart ? `${formatDate(s.currentPeriodStart)} – ${formatDate(s.currentPeriodEnd)}` : null },
            { label: 'Cancels at period end', value: s ? (s.cancelAtPeriodEnd ? 'Yes' : 'No') : null },
            { label: 'Gateway', value: s?.gateway === 'cashfree' ? 'Cashfree' : s?.gateway === 'fake' ? 'FakePay' : s?.gateway },
            { label: 'Pay by (Buy now)', value: c.state === 'pending_payment' ? formatDate(c.payBy ?? null) : null },
            { label: 'GST details', value: billingProfile ? `${billingProfile.legalName}${billingProfile.gstin ? ` · ${billingProfile.gstin}` : ''} · ${billingProfile.state}` : null, full: true },
          ]}
        />
      </div>
      {c.state === 'pending_payment' && <PendingPayment company={c} />}
      <TrialOverride company={c} trialStart={c.createdAt} />
      <Section id="company-people" title={`People (${people.length})`}>
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (p) =>
                p.accountId ? (
                  <Link to={`/console/users/account/${p.accountId}`} className="font-semibold text-primary hover:underline">
                    {p.name}
                  </Link>
                ) : (
                  <Link to={`/console/users/login/${p.id}`} className="font-semibold text-primary hover:underline">
                    {p.name}
                  </Link>
                ),
            },
            { key: 'login', header: 'Sign-in', cell: (p) => <span className="break-all font-mono text-xs">{p.login ?? '—'}</span> },
            { key: 'role', header: 'Role', cell: (p) => <span className="capitalize">{p.role}</span> },
            { key: 'active', header: 'Active', cell: (p) => <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'Active' : 'Switched off'}</Badge> },
            { key: 'apps', header: 'Apps', hideOnMobile: true, cell: (p) => p.apps.join(', ') || '—' },
            { key: 'last', header: 'Last sign-in', cell: (p) => <span className="whitespace-nowrap">{ago(p.lastSignIn)}</span> },
          ]}
          rows={people}
          rowKey={(p) => p.id}
          empty="No people."
        />
      </Section>
      <Section id="company-invoices" title="Invoices">
        {detail.data.invoiceEmail && (
          <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Invoice emails are not sent: {detail.data.invoiceEmail}.
          </p>
        )}
        <div className="mb-4">
          <BillingEmail key={billingProfile?.email ?? ''} company={c} current={billingProfile?.email ?? null} />
        </div>
        <DataTable
          columns={[
            { key: 'number', header: 'Number', cell: (i) => <span className="font-mono">{i.number}</span> },
            { key: 'issued', header: 'Issued', cell: (i) => formatDate(i.issuedAt) },
            { key: 'period', header: 'Period', hideOnMobile: true, cell: (i) => (i.periodStart ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : '—') },
            { key: 'total', header: 'Total', className: 'text-right', headerClassName: 'text-right', cell: (i) => <span className="font-mono tabular-nums">{formatInr(i.total)}</span> },
            { key: 'status', header: 'Status', cell: (i) => <Badge tone={i.status === 'paid' ? 'green' : 'gray'}>{i.status}</Badge> },
            {
              key: 'email',
              header: 'Email',
              hideOnMobile: true,
              cell: (i) =>
                i.emailedAt ? (
                  <span className="text-sm">
                    Sent {formatDateTime(i.emailedAt)}
                    <span className="block break-all text-xs text-muted-foreground">{(i.emailedTo ?? []).join(', ')}</span>
                  </span>
                ) : i.emailError ? (
                  <span className="text-sm text-destructive">{i.emailError}</span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'send',
              header: <span className="sr-only">Send again</span>,
              className: 'text-right',
              cell: (i) => (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Email invoice ${i.number} again`}
                  disabled={act.isPending}
                  loading={act.isPending && act.variables?.kind === 'emailInvoice' && act.variables.invoiceId === i.id}
                  onClick={() =>
                    act.mutate(
                      { id: c.id, kind: 'emailInvoice', invoiceId: i.id },
                      {
                        onSuccess: (r) => {
                          const res = r as { sent?: boolean; error?: string | null };
                          if (res.sent) toast.success('Invoice emailed');
                          else toast.error(res.error ?? 'Not sent');
                          void detail.refetch();
                        },
                        onError: (err) => toast.error(errorMessage(err)),
                      },
                    )
                  }
                >
                  <Mail /> Send again
                </Button>
              ),
            },
          ]}
          rows={invoices}
          rowKey={(i) => i.id}
          empty="No invoices yet."
        />
      </Section>
      <Section id="company-payments" title="Payments">
        <DataTable
          columns={[
            { key: 'at', header: 'When', cell: (p) => <span className="whitespace-nowrap">{formatDateTime(p.at)}</span> },
            { key: 'gateway', header: 'Gateway', cell: (p) => (p.gateway === 'cashfree' ? 'Cashfree' : p.gateway === 'fake' ? 'FakePay' : p.gateway) },
            { key: 'amount', header: 'Amount', className: 'text-right', headerClassName: 'text-right', cell: (p) => <span className="font-mono tabular-nums">{formatInr(p.amount)}</span> },
            { key: 'status', header: 'Status', cell: (p) => <Badge tone={p.status === 'captured' ? 'green' : 'red'}>{p.status === 'captured' ? 'Paid' : 'Failed'}</Badge> },
            { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (p) => p.reason ?? '—' },
          ]}
          rows={payments}
          rowKey={(p) => p.id}
          empty="No payments yet."
        />
      </Section>
      <Section id="company-plan-changes" title="Plan changes">
        <DataTable
          columns={[
            { key: 'at', header: 'When', cell: (p) => <span className="whitespace-nowrap">{formatDateTime(p.at)}</span> },
            { key: 'what', header: 'What', cell: (p) => p.text },
            { key: 'status', header: 'Status', cell: (p) => p.status },
            { key: 'amount', header: 'Amount', className: 'text-right', headerClassName: 'text-right', cell: (p) => <span className="font-mono tabular-nums">{formatInr(p.amount)}</span> },
          ]}
          rows={planChanges}
          rowKey={(p) => `${p.kind}-${p.at}-${p.text}`}
          empty="No checkouts or user changes yet."
        />
      </Section>
      <Section id="company-audit" title="Staff actions and views">
        <DataTable
          columns={[
            { key: 'at', header: 'When', cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.at)}</span> },
            { key: 'action', header: 'Action', cell: (a) => <span className="font-medium">{ACTION_LABELS[a.action as keyof typeof ACTION_LABELS] ?? a.action}</span> },
            { key: 'details', header: 'Details', cell: (a) => <span className="text-sm">{auditSummary({ action: a.action, details: a.details })}</span> },
            { key: 'staff', header: 'Staff', cell: (a) => <span className="break-all">{a.staffEmail ?? '—'}</span> },
          ]}
          rows={audit}
          rowKey={(a) => a.id}
          empty="No staff actions yet."
        />
      </Section>
    </div>
  );
}
