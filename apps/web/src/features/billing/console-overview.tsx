/** Kaampilot console → Overview (PLAN.md §21.9): totals, sign-ups per day, health of every service. */
import { type ConsoleHealthService, type ConsoleOverview, formatInr, useConsoleHealth, useConsoleOverview } from '@kaampilot/core/billing';
import { ErrorState } from '@/components/common/page';
import { Badge } from '@/components/ui/primitives';
import { cn, formatDateTime, formatNumber } from '@/lib/utils';
import { ago, Section, SERVICE_LABELS, StatTile } from './console-parts';

export function ConsoleOverviewTab({ enabled }: { enabled: boolean }) {
  const overview = useConsoleOverview(enabled);
  const o = overview.data;
  const loading = overview.isLoading;
  if (overview.error && !o) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const c = o?.companies;
  return (
    <div className="space-y-6">
      <HealthStrip enabled={enabled} />
      <Section id="console-companies-totals" title="Companies">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="All companies" value={c?.total} loading={loading} />
          <StatTile label="Paid, active" value={c?.active} loading={loading} />
          <StatTile label="On trial" value={c?.trialing} loading={loading} />
          <StatTile label="Free" value={c?.free} loading={loading} hint={c ? `${c.complimentary} complimentary` : undefined} />
          <StatTile label="Past due / read-only" value={c ? `${c.pastDue} / ${c.readOnly}` : undefined} loading={loading} tone={c && c.pastDue + c.readOnly > 0 ? 'warning' : undefined} />
          <StatTile label="Suspended" value={c?.suspended} loading={loading} tone={c && c.suspended > 0 ? 'danger' : undefined} />
        </dl>
      </Section>
      <Section id="console-people-totals" title="People">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="People in companies" value={o ? formatNumber(o.people.total) : undefined} loading={loading} hint={o ? `${formatNumber(o.people.active)} active` : undefined} />
          <StatTile label="Accounts" value={o ? formatNumber(o.people.accounts) : undefined} loading={loading} hint={o ? `${formatNumber(o.people.adminLogins)} admin-made logins` : undefined} />
          <StatTile label="Active today" value={o?.activeUsers.today} loading={loading} />
          <StatTile label="Active 7 days" value={o?.activeUsers.d7} loading={loading} />
          <StatTile label="Active 30 days" value={o?.activeUsers.d30} loading={loading} />
          <StatTile label="Punch-ins today" value={o ? (o.punchesToday.total ?? '—') : undefined} loading={loading} hint={o?.punchesToday.at ? `counted ${ago(o.punchesToday.at)}` : 'waiting for the Tasks worker'} />
        </dl>
      </Section>
      <Section id="console-money-totals" title="Money and codes">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="MRR" value={o ? formatInr(o.billing.mrr) : undefined} loading={loading} />
          <StatTile label="Revenue this month" value={o ? formatInr(o.billing.revenueMonth) : undefined} loading={loading} hint={o ? `${o.billing.paymentsMonth} payments` : undefined} />
          <StatTile label="Paid users" value={o?.billing.paidSeats} loading={loading} hint={o ? `${formatNumber(o.billing.seatsUsed)} in use` : undefined} />
          <StatTile label="Failed payments" value={o?.billing.failedMonth} loading={loading} hint={o ? `${o.billing.failed30d} in 30 days` : undefined} tone={o && o.billing.failedMonth > 0 ? 'warning' : undefined} />
          <StatTile label="Codes sent today" value={o?.otpToday.sent} loading={loading} />
          <StatTile label="Codes failed today" value={o?.otpToday.failed} loading={loading} tone={o && o.otpToday.failed > 0 ? 'danger' : undefined} hint={o ? `${o.errorsToday} server errors today` : undefined} />
        </dl>
      </Section>
      <Section id="console-signups" title="Sign-ups, last 30 days">
        {o ? <SignupsChart days={o.signups} /> : <div className="h-48 animate-pulse rounded-xl bg-muted" />}
      </Section>
    </div>
  );
}

/** New accounts (bar) and new companies (inner bar) per day; every bar has its numbers as a label and a tooltip. */
function SignupsChart({ days }: { days: ConsoleOverview['signups'] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.accounts, d.companies)));
  const totals = days.reduce((s, d) => ({ accounts: s.accounts + d.accounts, companies: s.companies + d.companies }), { accounts: 0, companies: 0 });
  return (
    <figure className="rounded-xl border bg-card p-4 shadow-card">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-primary" aria-hidden /> Accounts ({totals.accounts})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-cta" aria-hidden /> Companies ({totals.companies})
        </span>
      </figcaption>
      <div className="flex h-40 items-end gap-[2px] sm:gap-1" role="img" aria-label={`Sign-ups in the last 30 days: ${totals.accounts} accounts, ${totals.companies} companies`}>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${d.day}: ${d.accounts} accounts, ${d.companies} companies`}>
            <div className="w-1/2 rounded-t-sm bg-primary" style={{ height: `${(d.accounts / max) * 100}%`, minHeight: d.accounts ? 2 : 0 }} />
            <div className="w-1/2 rounded-t-sm bg-cta" style={{ height: `${(d.companies / max) * 100}%`, minHeight: d.companies ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{days[0]?.day.slice(5)}</span>
        <span>{days[Math.floor(days.length / 2)]?.day.slice(5)}</span>
        <span>today</span>
      </div>
    </figure>
  );
}

/** Each service up / down, its version and the Tasks worker's last pass (refreshes every 30 s). */
export function HealthStrip({ enabled }: { enabled: boolean }) {
  const health = useConsoleHealth(enabled);
  const services = health.data?.services;
  return (
    <section aria-labelledby="console-health" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="console-health" className="text-lg font-semibold tracking-tight">
          Health
        </h2>
        {health.data && <span className="ml-auto text-xs text-muted-foreground">Checked {formatDateTime(health.data.checkedAt)}</span>}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(services ?? [null, null, null, null]).map((s, i) => (
          <li key={s?.service ?? i} className="min-w-0 rounded-xl border bg-card p-3 shadow-card">
            {s ? <ServiceCard s={s} /> : <div className="h-14 animate-pulse rounded-md bg-muted" />}
          </li>
        ))}
      </ul>
      {health.error && !services && <ErrorState error={health.error} onRetry={() => void health.refetch()} />}
    </section>
  );
}

function ServiceCard({ s }: { s: ConsoleHealthService }) {
  const state = s.up === null ? { text: s.note ?? 'Unknown', tone: 'neutral' as const } : s.up ? { text: 'Up', tone: 'green' as const } : { text: 'Down', tone: 'red' as const };
  return (
    <div className="space-y-1" aria-label={`${s.label}: ${state.text}`}>
      <div className="flex items-center gap-2">
        <p className="truncate font-semibold">{SERVICE_LABELS[s.service] ?? s.label}</p>
        <Badge tone={state.tone} className="ml-auto">
          {state.text}
        </Badge>
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {s.version ? `v ${s.version}` : 'version not set'}
        {s.ms !== null && s.service !== 'platform' ? ` · ${s.ms} ms` : ''}
      </p>
      <p className={cn('truncate text-xs', s.errors24h > 0 ? 'text-destructive' : 'text-muted-foreground')}>
        {s.errors24h} errors in 24 h{s.service === 'tasks-worker' ? ` · last pass ${ago(s.lastRun)}` : ''}
        {s.up === false && s.note ? ` · ${s.note}` : ''}
      </p>
    </div>
  );
}
