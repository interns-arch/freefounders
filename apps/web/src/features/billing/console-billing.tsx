/**
 * Kaampilot console → Billing (PLAN.md §21.9): every subscription, invoice and payment (FakePay and Cashfree), failures
 * and revenue by month, each with a Download of every row (xlsx / csv, PLAN.md §19.31). Read-only.
 */
import { type ConsoleBilling, consoleExports, formatInr, useConsoleBilling } from '@kaampilot/core/billing';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import { useState } from 'react';
import { Link } from 'react-router';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { ErrorState } from '@/components/common/page';
import { Label, NativeSelect } from '@/components/ui/input';
import { Badge } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Section, StatTile } from './console-parts';
import { StateBadge } from './parts';

const gatewayName = (g: string | null | undefined) => (g === 'cashfree' ? 'Cashfree' : g === 'fake' ? 'FakePay' : (g ?? '—'));
const CompanyLink = ({ id, name, code }: { id?: string; name?: string; code?: string }) =>
  id ? (
    <Link to={`/console/companies/${id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
      {name} <span className="font-mono text-xs text-muted-foreground">{code}</span>
    </Link>
  ) : (
    <span>—</span>
  );

export function ConsoleBillingTab({ enabled }: { enabled: boolean }) {
  const billing = useConsoleBilling(enabled);
  const [payState, setPayState] = useState<'' | 'captured' | 'failed'>('');
  const [gateway, setGateway] = useState('');
  const b = billing.data;
  if (billing.error && !b) return <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />;
  const payments = (b?.payments ?? []).filter((p) => (!payState || p.status === payState) && (!gateway || p.gateway === gateway));
  const thisMonth = b?.months[b.months.length - 1];
  const dl = (sheet: 'subscriptions' | 'invoices' | 'payments' | 'months', empty: boolean) => (
    <DownloadMenu filename={fileSlug('console', sheet, todayStamp())} target={consoleExports.billing(sheet)} empty={empty} loading={!b} size="sm" />
  );
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Revenue this month" value={thisMonth ? formatInr(thisMonth.revenue) : undefined} loading={!b} hint={thisMonth ? `${thisMonth.payments} payments` : undefined} />
        <StatTile label="Invoiced this month" value={thisMonth ? formatInr(thisMonth.invoiced) : undefined} loading={!b} />
        <StatTile label="Failed this month" value={thisMonth?.failed} loading={!b} tone={thisMonth && thisMonth.failed > 0 ? 'warning' : undefined} />
        <StatTile label="Subscriptions" value={b?.subscriptions.length} loading={!b} hint="not counting complimentary" />
      </dl>
      <Section id="billing-months" title="Revenue by month" actions={dl('months', false)}>
        {b ? <RevenueBars months={b.months} /> : <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      </Section>
      <Section id="billing-subscriptions" title="Subscriptions" actions={dl('subscriptions', b?.subscriptions.length === 0)}>
        <DataTable
          columns={[
            { key: 'company', header: 'Company', cell: (s) => <CompanyLink id={s.id} name={s.name} code={s.code} /> },
            { key: 'plan', header: 'Plan', cell: (s) => `${s.planName ?? s.plan}${s.interval === 'year' ? ' · yearly' : ''}` },
            { key: 'state', header: 'State', cell: (s) => <StateBadge state={s.state} /> },
            { key: 'seats', header: 'Users', cell: (s) => <span className="font-mono tabular-nums">{s.seats.used} / {s.seats.paid || '—'}</span> },
            { key: 'mrr', header: 'MRR', className: 'text-right', headerClassName: 'text-right', cell: (s) => <span className="font-mono tabular-nums">{formatInr(s.mrr)}</span> },
            { key: 'ends', header: 'Trial / period ends', hideOnMobile: true, cell: (s) => formatDate(s.state === 'trialing' ? s.trialEndsAt : (s.currentPeriodEnd ?? null)) },
          ]}
          rows={b?.subscriptions}
          rowKey={(s) => s.id}
          loading={billing.isLoading}
          empty="No subscriptions."
        />
      </Section>
      <Section id="billing-payments" title="Payments" actions={dl('payments', b?.payments.length === 0)}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-36 space-y-1.5">
            <Label htmlFor="pay-state">Result</Label>
            <NativeSelect id="pay-state" value={payState} onChange={(e) => setPayState(e.target.value as '' | 'captured' | 'failed')}>
              <option value="">All</option>
              <option value="captured">Paid</option>
              <option value="failed">Failed</option>
            </NativeSelect>
          </div>
          <div className="min-w-36 space-y-1.5">
            <Label htmlFor="pay-gateway">Gateway</Label>
            <NativeSelect id="pay-gateway" value={gateway} onChange={(e) => setGateway(e.target.value)}>
              <option value="">All</option>
              <option value="fake">FakePay</option>
              <option value="cashfree">Cashfree</option>
            </NativeSelect>
          </div>
        </div>
        <DataTable
          columns={[
            { key: 'at', header: 'When', cell: (p) => <span className="whitespace-nowrap">{formatDateTime(p.at)}</span> },
            { key: 'company', header: 'Company', cell: (p) => <CompanyLink id={p.companyId} name={p.companyName} code={p.companyCode} /> },
            { key: 'gateway', header: 'Gateway', cell: (p) => gatewayName(p.gateway) },
            { key: 'amount', header: 'Amount', className: 'text-right', headerClassName: 'text-right', cell: (p) => <span className="font-mono tabular-nums">{formatInr(p.amount)}</span> },
            { key: 'status', header: 'Result', cell: (p) => <Badge tone={p.status === 'captured' ? 'green' : 'red'}>{p.status === 'captured' ? 'Paid' : 'Failed'}</Badge> },
            { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (p) => <span className="text-sm">{p.reason ?? '—'}</span> },
          ]}
          rows={payments}
          rowKey={(p) => p.id}
          loading={billing.isLoading}
          empty="No payments match."
        />
        <p className="text-xs text-muted-foreground">Refunds are made in the payment gateway's dashboard; there is no refund flow in Kaampilot yet.</p>
      </Section>
      <Section id="billing-invoices" title="Invoices" actions={dl('invoices', b?.invoices.length === 0)}>
        <DataTable
          columns={[
            { key: 'number', header: 'Number', cell: (i) => <span className="font-mono">{i.number}</span> },
            { key: 'issued', header: 'Issued', cell: (i) => formatDate(i.issuedAt) },
            { key: 'company', header: 'Company', cell: (i) => <CompanyLink id={i.companyId} name={i.companyName} code={i.companyCode} /> },
            { key: 'tax', header: 'GST', hideOnMobile: true, className: 'text-right', headerClassName: 'text-right', cell: (i) => <span className="font-mono tabular-nums">{formatInr(i.tax)}</span> },
            { key: 'total', header: 'Total', className: 'text-right', headerClassName: 'text-right', cell: (i) => <span className="font-mono tabular-nums">{formatInr(i.total)}</span> },
            { key: 'status', header: 'Status', cell: (i) => <Badge tone={i.status === 'paid' ? 'green' : 'gray'}>{i.status === 'paid' ? 'Paid' : i.status}</Badge> },
          ]}
          rows={b?.invoices}
          rowKey={(i) => i.id}
          loading={billing.isLoading}
          empty="No invoices yet."
        />
      </Section>
    </div>
  );
}

function RevenueBars({ months }: { months: ConsoleBilling['months'] }) {
  const max = Math.max(1, ...months.map((m) => m.revenue));
  return (
    <figure className="rounded-xl border bg-card p-4 shadow-card">
      <div className="flex h-36 items-end gap-1 sm:gap-2" role="img" aria-label={`Revenue for the last 12 months, this month ${formatInr(months[months.length - 1]?.revenue ?? 0)}`}>
        {months.map((m) => (
          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.month}: ${formatInr(m.revenue)}, ${m.payments} payments, ${m.failed} failed`}>
            <div className="w-full rounded-t-sm bg-primary" style={{ height: `${(m.revenue / max) * 100}%`, minHeight: m.revenue ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 font-mono text-[10px] text-muted-foreground sm:gap-2">
        {months.map((m) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center">
            {m.month.slice(5)}
          </span>
        ))}
      </div>
    </figure>
  );
}
