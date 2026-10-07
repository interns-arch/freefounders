import { useQuery } from '@tanstack/react-query';
import { Boxes, CheckCircle2, ClipboardList, LifeBuoy, LogOut, UserPlus, Users } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, PageLoader, StatCard } from '@/components/common/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useUrlFilters } from '@/lib/url-state';
import { cn, formatNumber, relativeTime } from '@/lib/utils';

interface Leadership {
  days: number;
  headline: { headcount: number; joiners: number; leavers: number; upcomingJoiners: number; onNotice: number; assetsInUse: number; assetsAvailable: number };
  service: {
    ticketsOpened: number;
    ticketsResolved: number;
    ticketsOpen: number;
    ticketsStale: number;
    avgResolutionHours: number | null;
    requestsRaised: number;
    requestsFulfilled: number;
    requestsWaiting: number;
    avgFulfilDays: number | null;
    handovers: number;
    exitsCompleted: number;
    itemsRecovered: number;
    itemsWrittenOff: number;
    onboardingsCompleted: number;
    onboardingsOnTime: number;
  };
  team: {
    id: string;
    name: string;
    roleName: string;
    ticketsResolved: number;
    ticketsOpen: number;
    avgResolutionHours: number | null;
    handovers: number;
    returns: number;
    requestsFulfilled: number;
    onboardingItems: number;
    lastActive: string | null;
  }[];
  departments: { id: string; name: string; headcount: number; onNotice: number; assetsHeld: number; pendingRecovery: number }[];
}

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const hours = (h: number | null) => (h === null ? '—' : h < 24 ? `${h} h` : `${(h / 24).toFixed(1)} days`);

export default function LeadershipPage() {
  const { values: f, set } = useUrlFilters({ days: '30' });
  const q = useQuery({ queryKey: ['leadership', f.days], queryFn: () => api.get<Leadership>('/leadership', { days: f.days }) });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { headline: h, service: s, team, departments } = q.data;
  const period = PERIODS.find((p) => p.value === String(q.data.days))?.label ?? `${q.data.days} days`;
  const onTime = s.onboardingsCompleted ? Math.round((s.onboardingsOnTime / s.onboardingsCompleted) * 100) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leadership overview"
        description={`How the organisation and the IT team did in the last ${period}.`}
        actions={
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => set({ days: p.value })}
                className={cn('cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition', (f.days ?? '30') === p.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="People" value={formatNumber(h.headcount)} hint={`${h.joiners} joined · ${h.leavers} left · ${h.onNotice} on notice`} icon={Users} tone="blue" />
        <StatCard label="Joining soon" value={h.upcomingJoiners} hint="Being onboarded" icon={UserPlus} tone="violet" />
        <StatCard label="Assets in use" value={formatNumber(h.assetsInUse)} hint={`${formatNumber(h.assetsAvailable)} available`} icon={Boxes} tone="green" />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>IT service</CardTitle>
            <CardDescription>Last {period}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={LifeBuoy}
            title="Tickets"
            value={`${s.ticketsResolved} resolved`}
            lines={[`${s.ticketsOpened} raised · ${s.ticketsOpen} open now`, `Typical fix time: ${hours(s.avgResolutionHours)}`]}
            warn={s.ticketsStale ? `${s.ticketsStale} open for over a week` : undefined}
          />
          <Metric
            icon={ClipboardList}
            title="Asset requests"
            value={`${s.requestsFulfilled} fulfilled`}
            lines={[`${s.requestsRaised} raised · ${s.requestsWaiting} waiting`, `Typical wait: ${s.avgFulfilDays === null ? '—' : `${s.avgFulfilDays} days`}`]}
          />
          <Metric icon={CheckCircle2} title="Handovers" value={`${s.handovers} assets handed over`} lines={[`${s.onboardingsCompleted} joiners onboarded${onTime === null ? '' : ` · ${onTime}% ready on day 1`}`]} />
          <Metric
            icon={LogOut}
            title="Exits"
            value={`${s.exitsCompleted} completed`}
            lines={[`${s.itemsRecovered} assets recovered`]}
            warn={s.itemsWrittenOff ? `${s.itemsWrittenOff} written off as missing` : undefined}
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>IT team</CardTitle>
            <CardDescription>What each person handled in the last {period}</CardDescription>
          </div>
        </CardHeader>
        {team.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Tickets resolved</TH>
                <TH className="text-right">Open tickets</TH>
                <TH className="text-right">Typical fix time</TH>
                <TH className="text-right">Handovers</TH>
                <TH className="text-right">Returns</TH>
                <TH className="text-right">Requests fulfilled</TH>
                <TH className="text-right">Joiner items</TH>
                <TH>Last active</TH>
              </TR>
            </THead>
            <TBody>
              {team.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.roleName}</div>
                  </TD>
                  <TD className="text-right tabular">{m.ticketsResolved}</TD>
                  <TD className={cn('text-right tabular', m.ticketsOpen > 5 && 'font-medium text-amber-600')}>{m.ticketsOpen}</TD>
                  <TD className="text-right tabular">{hours(m.avgResolutionHours)}</TD>
                  <TD className="text-right tabular">{m.handovers}</TD>
                  <TD className="text-right tabular">{m.returns}</TD>
                  <TD className="text-right tabular">{m.requestsFulfilled}</TD>
                  <TD className="text-right tabular">{m.onboardingItems}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{m.lastActive ? relativeTime(m.lastActive) : 'Never'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No IT team members yet" description="People with the IT / Asset Manager role appear here." />
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Departments</CardTitle>
            <CardDescription>People and the assets they hold</CardDescription>
          </div>
        </CardHeader>
        {departments.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Department</TH>
                <TH className="text-right">People</TH>
                <TH className="text-right">Assets held</TH>
                <TH className="text-right">On notice</TH>
                <TH className="text-right">To recover</TH>
              </TR>
            </THead>
            <TBody>
              {departments.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">{d.name}</TD>
                  <TD className="text-right tabular">{d.headcount}</TD>
                  <TD className="text-right tabular">{d.assetsHeld}</TD>
                  <TD className="text-right tabular">{d.onNotice || '—'}</TD>
                  <TD className={cn('text-right tabular', d.pendingRecovery > 0 && 'font-medium text-amber-600')}>{d.pendingRecovery || '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No departments yet" />
        )}
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, title, value, lines, warn }: { icon: typeof Users; title: string; value: string; lines: string[]; warn?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" /> {title}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      {lines.map((l) => (
        <p key={l} className="text-xs text-muted-foreground">
          {l}
        </p>
      ))}
      {warn && <p className="mt-1 text-xs font-medium text-amber-600">{warn}</p>}
    </div>
  );
}
