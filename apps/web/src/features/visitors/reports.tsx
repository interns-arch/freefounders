/**
 * Visitors → Reports (PLAN.md §22.10, visitors.view_all): the numbers for a period — visits per day and by hour,
 * purposes, hosts, companies, how visitors came, parcels, vehicles, contractors, material passes, incidents, patrol.
 * One series per chart (one theme colour); ranked lists are plain labelled bars; Download gives the same numbers.
 */
import { fileSlug } from '@freefounders/core/export';
import { type VisitorReport, formatMinutes, useVisitorReport, visitorExportsV3 } from '@freefounders/core/visitors';
import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { BarChart3 } from '@/components/icons';
import { Segmented } from '@/components/common/controls';
import { DownloadMenu } from '@/components/common/download-menu';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { barValueLabels, themeColour } from '@/features/tasks/general/charts';
import { cn, todayISO } from '@/lib/utils';

type Quick = '7' | '30' | '90' | 'custom';

export function ReportsPage() {
  const [quick, setQuick] = useState<Quick>('30');
  const [from, setFrom] = useState(todayISO(-29));
  const [to, setTo] = useState(todayISO());
  const range = { date_from: from, date_to: to };
  const q = useVisitorReport(range);
  const r = q.data;
  const pick = (v: Quick) => {
    setQuick(v);
    if (v !== 'custom') {
      setFrom(todayISO(-(Number(v) - 1)));
      setTo(todayISO());
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Visitor reports"
        description="Visits, time inside, who came and why, and everything else at the gate for a period."
        actions={<DownloadMenu filename={fileSlug('visitors-report', from, to)} target={visitorExportsV3.report(range)} empty={!r} loading={q.isLoading} />}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="Period"
          value={quick}
          onChange={pick}
          options={[
            ['7', '7 days'],
            ['30', '30 days'],
            ['90', '90 days'],
            ['custom', 'Custom'],
          ]}
        />
        <Input type="date" value={from} max={to} onChange={(e) => (setQuick('custom'), setFrom(e.target.value))} aria-label="From" className="w-auto" />
        <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => (setQuick('custom'), setTo(e.target.value))} aria-label="To" className="w-auto" />
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <PageLoader />
      ) : (
        <div className={cn('space-y-5', q.isFetching && 'opacity-70 transition-opacity')}>
          <Tiles r={r} />
          {r.totals.visits === 0 ? (
            <EmptyState icon={BarChart3} title="No visits in this period" description="Pick a longer period, or come back once the gate has checked visitors in." />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Visits per day" note="Visitors checked in each day.">
                  <Bars labels={r.per_day.map((d) => shortDay(d.date))} values={r.per_day.map((d) => d.visits)} what="visits" title="Visits per day" fullLabels={r.per_day.map((d) => longDay(d.date))} />
                </ChartCard>
                <ChartCard title="Busiest hours" note="Check-ins by hour of the day.">
                  <Bars labels={r.per_hour.map((h) => String(h.hour).padStart(2, '0'))} values={r.per_hour.map((h) => h.visits)} what="visits" title="Visits by hour" fullLabels={r.per_hour.map((h) => `${String(h.hour).padStart(2, '0')}:00–${String(h.hour).padStart(2, '0')}:59`)} />
                </ChartCard>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Ranked title="Purposes" rows={r.purposes} />
                <Ranked title="Most visited people" rows={r.hosts} />
                <Ranked title="Companies" rows={r.companies} empty="No company names given." />
                <Ranked title="How they came" rows={r.sources} />
                <Ranked title="Incidents by kind" rows={r.incidents_by_kind} empty="No incidents. Good." />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function shortDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function longDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Tiles({ r }: { r: VisitorReport }) {
  const t = r.totals;
  const tiles: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Visits', value: String(t.visits), note: `${t.people} people` },
    { label: 'Different visitors', value: String(t.unique_visitors), note: `${t.returning} came back` },
    { label: 'Average time inside', value: t.avg_minutes ? formatMinutes(t.avg_minutes) : '—' },
    { label: 'Overstays', value: String(t.overstays) },
    { label: 'Turned away / denied', value: String(t.turned_away) },
    { label: 'Invited', value: String(t.invited), note: `${t.no_shows} did not come` },
    { label: 'QR self sign-ins', value: String(t.qr_sign_ins) },
    { label: 'Parcels', value: String(t.parcels) },
    { label: 'Vehicles', value: String(t.vehicles) },
    { label: 'Contractor entries', value: String(t.contractor_entries) },
    { label: 'Material passes', value: String(t.material_passes) },
    { label: 'Incidents', value: String(t.incidents), note: `${t.incidents_open} open now` },
    { label: 'Patrol scans', value: String(t.patrol_scans), note: t.patrol_problems ? `${t.patrol_problems} with a problem` : 'no problems' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="report-tiles">
      {tiles.map((x) => (
        <Card key={x.label}>
          <CardContent className="pt-4">
            <p className="text-[13px] text-muted-foreground">{x.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">{x.value}</p>
            {x.note && <p className="text-[13px] text-muted-foreground">{x.note}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-[13px] text-muted-foreground">{note}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Theme colours read at run time, so the bars follow dark mode and the company's brand colour. */
function useChartColours() {
  const read = () => ({ bar: themeColour('primary'), text: themeColour('muted-foreground'), grid: themeColour('border') });
  const [c, setC] = useState(read);
  useEffect(() => {
    const update = () => setC(read());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-brand', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return c;
}

/** One series of vertical bars (Chart.js, like the Tasks dashboards), with a hover tooltip and an accessible summary. */
function Bars({ labels, values, fullLabels, what, title }: { labels: string[]; values: number[]; fullLabels: string[]; what: string; title: string }) {
  const c = useChartColours();
  const summary = values
    .map((v, i) => [fullLabels[i], v] as const)
    .filter(([, v]) => v > 0)
    .map(([l, v]) => `${l}: ${v}`)
    .join(', ');
  return (
    <div className="h-64" role="img" aria-label={`${title}. ${summary || 'none'}`}>
      <Bar
        plugins={[barValueLabels]}
        data={{ labels, datasets: [{ data: values, backgroundColor: c.bar, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 28, categoryPercentage: 0.85 }] }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 18 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { displayColors: false, callbacks: { title: (items) => fullLabels[items[0]?.dataIndex ?? 0], label: (ctx) => `${ctx.parsed.y} ${what}` } },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: c.text, maxRotation: 0, autoSkip: true, autoSkipPadding: 8, font: { size: 12 } } },
            y: { beginAtZero: true, ticks: { color: c.text, precision: 0, font: { size: 12 } }, grid: { color: c.grid }, border: { display: false } },
          },
        }}
      />
    </div>
  );
}

/** A ranked list as labelled horizontal bars (the number is always written; the bar only shows the size). */
function Ranked({ title, rows, empty = 'Nothing in this period.' }: { title: string; rows: Array<{ name: string; count: number }>; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.name} title={`${r.name}: ${r.count}${total ? ` (${Math.round((r.count / total) * 100)}%)` : ''}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{r.count}</span>
                </div>
                <div className="mt-1 h-2 rounded-sm bg-muted" aria-hidden>
                  <div className="h-2 rounded-sm bg-primary" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
