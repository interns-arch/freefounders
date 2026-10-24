/**
 * Kaampilot console → Logs (PLAN.md §21.9): the production log of every service (Platform, Tasks, Tasks worker,
 * Assets): server errors and key events (failed sign-in bursts, code send failures, payment webhooks, worker failures).
 * Entries are redacted on the server (no secrets, tokens, codes or request bodies) and kept 30 days. Filters, search,
 * auto-refresh, a detail drawer and Download.
 */
import { type ConsoleLogFilters, type ConsoleLogRow, consoleExports, type LogLevel, useConsoleLogs } from '@freefounders/core/billing';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { type Column, DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { DetailList } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Switch } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/utils';
import { HealthStrip } from './console-overview';
import { LevelBadge, SERVICE_LABELS } from './console-parts';

const RANGES = [
  { key: '1h', label: 'Last hour', ms: 3600_000 },
  { key: '24h', label: 'Last 24 hours', ms: 86400_000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 86400_000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 86400_000 },
] as const;

export function ConsoleLogsTab({ enabled }: { enabled: boolean }) {
  const [service, setService] = useState('');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [company, setCompany] = useState('');
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('24h');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [auto, setAuto] = useState(true);
  const [open, setOpen] = useState<ConsoleLogRow | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  // The time window moves with the clock (rounded to the minute so the query key stays stable between refreshes).
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const from = new Date(minute - RANGES.find((r) => r.key === range)!.ms).toISOString();
  const filters: ConsoleLogFilters = { service, level, company: company.trim(), from, q, page, pageSize: 50 };
  const logs = useConsoleLogs(filters, enabled, auto);
  const data = logs.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns: Column<ConsoleLogRow>[] = [
    { key: 'at', header: 'When', cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{formatDateTime(r.at)}</span> },
    { key: 'level', header: 'Level', cell: (r) => <LevelBadge level={r.level} /> },
    { key: 'service', header: 'Service', cell: (r) => SERVICE_LABELS[r.service] ?? r.service },
    {
      key: 'message',
      header: 'Message',
      cell: (r) => (
        <div className="min-w-48 max-w-xl">
          <p className="line-clamp-2 break-all text-sm">{r.message}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {[r.event, r.method && r.path ? `${r.method} ${r.path}` : r.path, r.status].filter(Boolean).join(' · ')}
            {r.count > 1 ? ` · ×${r.count}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'company', header: 'Company', hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.companyCode ?? '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <HealthStrip enabled={enabled} />
      <section aria-labelledby="console-logs" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="console-logs" className="text-lg font-semibold tracking-tight">
            Production log
          </h2>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-refresh every 15 seconds" />
            Auto-refresh
          </label>
          <DownloadMenu filename={fileSlug('production-log', service, level, todayStamp())} target={consoleExports.logs(filters)} empty={data?.total === 0} loading={!data} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SearchField value={search} onChange={setSearch} label="Search the log" placeholder="Message, path or event" className="w-full max-w-sm" />
          <div className="min-w-32 space-y-1.5">
            <Label htmlFor="log-service">Service</Label>
            <NativeSelect id="log-service" value={service} onChange={(e) => reset(() => setService(e.target.value))}>
              <option value="">All services</option>
              {(data?.services ?? ['platform', 'tasks', 'tasks-worker', 'assets']).map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s] ?? s}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-28 space-y-1.5">
            <Label htmlFor="log-level">Level</Label>
            <NativeSelect id="log-level" value={level} onChange={(e) => reset(() => setLevel(e.target.value as LogLevel | ''))}>
              <option value="">All levels</option>
              <option value="error">Errors</option>
              <option value="warn">Warnings</option>
              <option value="info">Info</option>
            </NativeSelect>
          </div>
          <div className="min-w-32 space-y-1.5">
            <Label htmlFor="log-range">Time</Label>
            <NativeSelect id="log-range" value={range} onChange={(e) => reset(() => setRange(e.target.value as (typeof RANGES)[number]['key']))}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="w-36 space-y-1.5">
            <Label htmlFor="log-company">Company code</Label>
            <Input id="log-company" value={company} onChange={(e) => reset(() => setCompany(e.target.value.toUpperCase()))} placeholder="Any" autoComplete="off" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {data ? `${data.total} entries · kept ${data.retentionDays} days · secrets, codes and request bodies are never stored` : ' '}
        </p>
        <DataTable
          columns={columns}
          rows={data?.rows}
          rowKey={(r) => String(r.id)}
          loading={logs.isLoading}
          fetching={logs.isFetching}
          error={logs.error}
          onRetry={() => void logs.refetch()}
          onRowClick={setOpen}
          empty="Nothing logged in this window."
        />
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </section>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent size="lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>Log entry</SheetTitle>
                <SheetDescription className="break-all">{open.message}</SheetDescription>
              </SheetHeader>
              <SheetBody className="space-y-5">
                <DetailList
                  items={[
                    { label: 'When', value: formatDateTime(open.at) },
                    { label: 'Level', value: <LevelBadge level={open.level} /> },
                    { label: 'Service', value: SERVICE_LABELS[open.service] ?? open.service },
                    { label: 'Version', value: open.version },
                    { label: 'Kind', value: open.kind === 'exception' ? 'Exception' : 'Event' },
                    { label: 'Event', value: open.event },
                    { label: 'Request', value: open.path ? `${open.method ?? ''} ${open.path}`.trim() : null },
                    { label: 'Status', value: open.status },
                    {
                      label: 'Company',
                      value: open.companyId ? (
                        <Link to={`/console/companies/${open.companyId}`} className="text-primary hover:underline">
                          {open.companyCode ?? open.companyId}
                        </Link>
                      ) : null,
                    },
                    { label: 'User id (in that service)', value: open.userId },
                    { label: 'Times', value: open.count > 1 ? `${open.count} (folded together)` : '1' },
                  ]}
                />
                {open.stack && (
                  <div className="space-y-1.5">
                    <p className="font-mono text-[11px] font-semibold tracking-wider text-foreground/75 uppercase">Stack (redacted, shortened)</p>
                    <pre className="max-h-96 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{open.stack}</pre>
                  </div>
                )}
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
