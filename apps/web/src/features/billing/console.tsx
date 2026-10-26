/**
 * /console: the Kaampilot console for Kaampilot staff only (PLAN.md §20.6, §21.1, §21.9). Tabs: Overview (totals, sign-ups,
 * health), Companies (every company; extend a trial, give a plan, suspend / reactivate, each asked first and logged in
 * Recent actions), Users (every account and admin-made login), Billing (subscriptions, invoices, payments, revenue) and
 * Logs (the production log of every service). Everything but the existing company actions is read-only.
 */
import { errorMessage } from '@kaampilot/core';
import {
  type ConsoleAuditAction,
  type ConsoleAuditRow,
  type ConsoleCompany,
  type DashboardCompany,
  billingExports,
  formatInr,
  planLabel,
  STATE_LABELS,
  useConsoleAction,
  useConsoleAudit,
  useDashboardCompanies,
  usePlans,
} from '@kaampilot/core/billing';
import { ChevronLeft, ChevronRight, MoreHorizontal } from '@/components/icons';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page';
import { DownloadMenu } from '@/components/common/download-menu';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ConsoleBillingTab } from './console-billing';
import { ConsoleLogsTab } from './console-logs';
import { ConsoleOverviewTab } from './console-overview';
import { ago, useStaff } from './console-parts';
import { ConsoleUsersTab } from './console-users';
import { SeatStepper, StateBadge } from './parts';

const seatsOf = (c: ConsoleCompany) => (typeof c.seats === 'number' ? { used: c.seats, paid: c.seats } : c.seats);

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'companies', label: 'Companies' },
  { key: 'users', label: 'Users' },
  { key: 'billing', label: 'Billing' },
  { key: 'logs', label: 'Logs' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function ConsolePage() {
  const { ready, staff } = useStaff();
  const { tab: raw } = useParams();
  const navigate = useNavigate();
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : 'overview';
  if (ready && !staff) return <Navigate to="/" replace />;
  if (raw && raw !== tab) return <Navigate to="/console" replace />;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Kaampilot console" description="Kaampilot staff only. Every company and every user; every view of a company and every action is logged." className="mb-2" />
      <Tabs value={tab} onValueChange={(v) => navigate(v === 'overview' ? '/console' : `/console/${v}`)}>
        <TabsList aria-label="Console sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'overview' && <ConsoleOverviewTab enabled={staff} />}
      {tab === 'companies' && <CompaniesTab enabled={staff} />}
      {tab === 'users' && <ConsoleUsersTab enabled={staff} />}
      {tab === 'billing' && <ConsoleBillingTab enabled={staff} />}
      {tab === 'logs' && <ConsoleLogsTab enabled={staff} />}
    </div>
  );
}

type CompanySort = 'created' | 'name' | 'users' | 'mrr' | 'activity';
const STATE_FILTERS = ['trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'] as const;

/** Companies: search, filter by plan / state, sort; click a row for its detail; the existing staff actions per row. */
function CompaniesTab({ enabled }: { enabled: boolean }) {
  const companies = useDashboardCompanies(enabled);
  const plans = usePlans();
  const act = useConsoleAction();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [state, setState] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [planFor, setPlanFor] = useState<ConsoleCompany | null>(null);
  const planOptions = useMemo(() => [...new Set((companies.data ?? []).map((c) => c.plan))].sort(), [companies.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (companies.data ?? []).filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q) || (c.owner ?? '').toLowerCase().includes(q)) &&
        (!plan || c.plan === plan) &&
        (!state || c.state === state),
    );
    const val = (c: DashboardCompany): string | number => {
      const k = sort.key as CompanySort;
      if (k === 'name') return c.name.toLowerCase();
      if (k === 'users') return seatsOf(c).used;
      if (k === 'mrr') return c.mrr;
      if (k === 'activity') return c.lastActivity ?? '';
      return c.createdAt;
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [companies.data, search, plan, state, sort]);

  const run = async (c: ConsoleCompany, kind: 'trial7' | 'trial14' | 'suspend' | 'reactivate') => {
    const what = {
      trial7: { title: `Extend ${c.name}’s trial by 7 days?`, text: 'Extend trial', a: { kind: 'trial' as const, days: 7 } },
      trial14: { title: `Extend ${c.name}’s trial by 14 days?`, text: 'Extend trial', a: { kind: 'trial' as const, days: 14 } },
      suspend: { title: `Suspend ${c.name}?`, text: 'Suspend', a: { kind: 'status' as const, status: 'suspended' } },
      reactivate: { title: `Reactivate ${c.name}?`, text: 'Reactivate', a: { kind: 'status' as const, status: 'active' } },
    }[kind];
    const ok = await confirm({
      title: what.title,
      description: kind === 'suspend' ? 'Only the owner can sign in, straight to Billing. Everyone else is refused.' : undefined,
      confirmText: what.text,
      destructive: kind === 'suspend',
    });
    if (!ok.confirmed) return;
    act.mutate({ id: c.id, ...what.a }, { onSuccess: () => toast.success('Done'), onError: (e) => toast.error(errorMessage(e)) });
  };

  const columns: Column<DashboardCompany>[] = [
    {
      key: 'name',
      header: 'Company',
      sortKey: 'name',
      cell: (c) => (
        <div className="min-w-36">
          <p className="truncate font-semibold">{c.name}</p>
          {c.code && <p className="font-mono text-xs text-muted-foreground">{c.code}</p>}
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', hideOnMobile: true, cell: (c) => <span className="break-all text-sm">{c.owner ?? '—'}</span> },
    { key: 'plan', header: 'Plan', cell: (c) => c.planName ?? planLabel(c.plan, plans.data) },
    { key: 'state', header: 'State', cell: (c) => <StateBadge state={c.state} /> },
    {
      key: 'seats',
      header: 'Users',
      sortKey: 'users',
      cell: (c) => {
        const x = seatsOf(c);
        return (
          <span className="font-mono tabular-nums">
            {x.used} / {x.paid || '—'}
          </span>
        );
      },
    },
    { key: 'mrr', header: 'MRR', sortKey: 'mrr', className: 'text-right', headerClassName: 'text-right', cell: (c) => <span className="font-mono tabular-nums">{formatInr(c.mrr)}</span> },
    {
      key: 'apps',
      header: 'Apps',
      hideOnMobile: true,
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {(c.apps ?? []).map((a) => (
            <Badge key={a} tone="gray">
              {a === 'tasks' ? 'Tasks' : a === 'assets' ? 'Assets' : a}
            </Badge>
          ))}
          {c.modulesOff.length > 0 && <span className="text-xs text-muted-foreground">{c.modulesOff.length} off</span>}
        </div>
      ),
    },
    { key: 'activity', header: 'Last activity', sortKey: 'activity', hideOnMobile: true, cell: (c) => <span className="whitespace-nowrap">{ago(c.lastActivity)}</span> },
    { key: 'created', header: 'Created', sortKey: 'created', hideOnMobile: true, cell: (c) => formatDate(c.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (c) => (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/console/companies/${c.id}`)}>Open details</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void run(c, 'trial7')}>Extend trial +7 days</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run(c, 'trial14')}>Extend trial +14 days</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPlanFor(c)}>Set plan…</DropdownMenuItem>
              <DropdownMenuSeparator />
              {c.state === 'suspended' ? (
                <DropdownMenuItem onSelect={() => void run(c, 'reactivate')}>Reactivate</DropdownMenuItem>
              ) : (
                <DropdownMenuItem destructive onSelect={() => void run(c, 'suspend')}>
                  Suspend
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField value={search} onChange={setSearch} label="Search companies" placeholder="Name, code or owner" className="w-full max-w-sm" />
        <div className="min-w-36 space-y-1.5">
          <Label htmlFor="co-plan">Plan</Label>
          <NativeSelect id="co-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">All plans</option>
            {planOptions.map((p) => (
              <option key={p} value={p}>
                {planLabel(p, plans.data)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-36 space-y-1.5">
          <Label htmlFor="co-state">State</Label>
          <NativeSelect id="co-state" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {STATE_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s] ?? s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DownloadMenu
          className="ml-auto"
          filename={fileSlug('console-companies', search.trim(), todayStamp())}
          rows={() => ({
            title: 'Companies',
            header: ['Company', 'Code', 'Owner', 'Plan', 'State', 'Users used', 'Users paid', 'MRR (Rs.)', 'Apps', 'Modules off', 'Last activity', 'Trial ends', 'Created'],
            rows: rows.map((c) => {
              const x = seatsOf(c);
              return [
                c.name,
                c.code ?? '',
                c.owner ?? '',
                c.planName ?? planLabel(c.plan, plans.data),
                STATE_LABELS[c.state] ?? c.state,
                x.used,
                x.paid,
                c.mrr / 100,
                (c.apps ?? []).join(', '),
                c.modulesOff.join(', '),
                c.lastActivity ? new Date(c.lastActivity) : null,
                c.trialEndsAt ? new Date(c.trialEndsAt) : null,
                new Date(c.createdAt),
              ];
            }),
          })}
          empty={companies.data !== undefined && rows.length === 0}
          loading={!companies.data}
        />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {companies.data ? `${rows.length} of ${companies.data.length} companies` : ' '}
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={companies.isLoading}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        onRowClick={(c) => navigate(`/console/companies/${c.id}`)}
        sort={sort}
        onSortChange={setSort}
        empty="No companies match."
      />
      <RecentActions companies={companies.data ?? []} enabled={enabled} />
      {planFor && <SetPlanDialog company={planFor} onClose={() => setPlanFor(null)} />}
    </div>
  );
}

export const ACTION_LABELS: Record<ConsoleAuditAction, string> = {
  'trial.extend': 'Extended trial',
  'plan.set': 'Set plan',
  'company.suspend': 'Suspended',
  'company.reactivate': 'Reactivated',
  'view.company': 'Viewed company',
  'view.user': 'Viewed user',
  'view.users': 'Downloaded users',
  'view.billing': 'Viewed billing',
  'view.logs': 'Viewed logs',
};

/** One line on what changed: from the row's `{input, before, after}` (PLAN.md §21.7). */
export function auditSummary(r: Pick<ConsoleAuditRow, 'action' | 'details'>): string {
  const { input = {}, before, after } = r.details ?? {};
  if (r.action.startsWith('view.')) {
    const d = (r.details ?? {}) as Record<string, unknown>;
    if (d.export) return `Download (${String(d.export)}${d.sheet ? `, ${String(d.sheet)}` : ''})`;
    if (d.kind) return `${d.kind === 'account' ? 'Account' : 'Admin-made login'} ${String(d.id ?? '').slice(0, 8)}`;
    return 'Opened';
  }
  if (r.action === 'trial.extend') return `+${String(input.days ?? '?')} days · trial ends ${formatDate((after?.trialEndsAt as string | null) ?? null)}`;
  if (r.action === 'plan.set') return `${String(before?.plan ?? '—')} → ${String(after?.plan ?? input.plan ?? '—')}${after?.seats ? `, ${String(after.seats)} users` : ''}`;
  return `${String(before?.state ?? '—')} → ${String(after?.state ?? '—')}`;
}

/** "Recent actions": the staff audit log, newest first, filtered by company and action, 25 a page. */
function RecentActions({ companies, enabled }: { companies: ConsoleCompany[]; enabled: boolean }) {
  const [company, setCompany] = useState('');
  const [action, setAction] = useState<ConsoleAuditAction | ''>('');
  const [page, setPage] = useState(1);
  const audit = useConsoleAudit({ company, action, page, pageSize: 25 }, enabled);
  const data = audit.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const columns: Column<ConsoleAuditRow>[] = [
    { key: 'at', header: 'When', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { key: 'action', header: 'Action', cell: (r) => <span className="font-medium">{ACTION_LABELS[r.action as ConsoleAuditAction] ?? r.action}</span> },
    {
      key: 'company',
      header: 'Company',
      cell: (r) => (
        <div className="min-w-32">
          <p className="truncate">{r.companyName ?? '—'}</p>
          {r.companyCode && <p className="font-mono text-xs text-muted-foreground">{r.companyCode}</p>}
        </div>
      ),
    },
    { key: 'details', header: 'Details', cell: (r) => <span className="text-sm">{auditSummary(r)}</span> },
    { key: 'staff', header: 'Staff', cell: (r) => <span className="break-all">{r.staffEmail ?? '—'}</span> },
    { key: 'ip', header: 'IP', hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
  ];
  return (
    <section aria-labelledby="recent-actions" className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <h2 id="recent-actions" className="text-lg font-semibold tracking-tight">
          Recent actions
        </h2>
        <DownloadMenu
          className="ml-auto"
          filename={fileSlug('console-actions', action, todayStamp())}
          target={billingExports.audit({ company, action })}
          empty={data?.total === 0}
          loading={!data}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 space-y-1.5">
          <Label htmlFor="audit-company">Company</Label>
          <NativeSelect
            id="audit-company"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.code ? ` (${c.code})` : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-40 space-y-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <NativeSelect
            id="audit-action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value as ConsoleAuditAction | '');
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            {(Object.keys(ACTION_LABELS) as ConsoleAuditAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={audit.isLoading}
        fetching={audit.isFetching}
        error={audit.error}
        onRetry={() => void audit.refetch()}
        empty="No console actions yet."
      />
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {data.total} actions
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
  );
}

function SetPlanDialog({ company, onClose }: { company: ConsoleCompany; onClose: () => void }) {
  const plans = usePlans();
  const act = useConsoleAction();
  const [plan, setPlan] = useState(company.plan || 'complimentary');
  const [seats, setSeats] = useState(Math.max(1, seatsOf(company).paid || seatsOf(company).used || 5));
  const options = [...(plans.data ?? []).map((p) => ({ key: p.key, name: p.name }))];
  if (!options.some((o) => o.key === 'complimentary')) options.push({ key: 'complimentary', name: 'Complimentary' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set plan for {company.name}</DialogTitle>
          <DialogDescription>Applies at once without payment (for complimentary or manual deals). Current state: {STATE_LABELS[company.state] ?? company.state}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="console-plan">Plan</Label>
            <NativeSelect id="console-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="console-seats">Users</Label>
            <SeatStepper id="console-seats" value={seats} onChange={setSeats} min={1} />
          </div>
          {act.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(act.error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={act.isPending}
            onClick={() => act.mutate({ id: company.id, kind: 'plan', plan, seats }, { onSuccess: () => (toast.success('Plan set'), onClose()) })}
          >
            Set plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
