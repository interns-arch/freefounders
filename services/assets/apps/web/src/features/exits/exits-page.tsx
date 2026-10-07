import { useQuery } from '@tanstack/react-query';
import { LogOut, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { EnumBadge } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { EmptyState, PageHeader, StatCard } from '@/components/common/page';
import { Input } from '@/components/ui/input';
import { Avatar, Badge, Card, Progress } from '@/components/ui/primitives';
import { api, type Page } from '@/lib/api';
import { EXIT_CASE_TONE } from '@/lib/status';
import type { ExitCaseListItem } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, daysUntil, formatDate } from '@/lib/utils';

const TABS = [
  { value: 'OPEN', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: '', label: 'All' },
];

export function DaysLeft({ date, className }: { date: string; className?: string }) {
  const d = daysUntil(date) ?? 0;
  return (
    <span className={cn('whitespace-nowrap text-xs font-medium', d < 0 ? 'text-red-600' : d <= 3 ? 'text-amber-600' : 'text-muted-foreground', className)}>
      {d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'Last day today' : `${d} day${d === 1 ? '' : 's'} left`}
    </span>
  );
}

export default function ExitsPage() {
  const navigate = useNavigate();
  const { values: f, set } = useUrlFilters({ status: 'OPEN', page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useQuery({ queryKey: ['exits', f], queryFn: () => api.get<Page<ExitCaseListItem>>('/exit-cases', f) });
  const open = useQuery({ queryKey: ['exits', 'open-summary'], queryFn: () => api.get<Page<ExitCaseListItem>>('/exit-cases', { status: 'OPEN', pageSize: 200 }) });
  const openItems = open.data?.items ?? [];
  const pending = openItems.reduce((n, x) => n + x.pending + x.missing, 0);
  const overdue = openItems.filter((x) => (daysUntil(x.lastWorkingDate) ?? 0) < 0 && x.pending + x.missing > 0).length;
  const dueSoon = openItems.filter((x) => {
    const d = daysUntil(x.lastWorkingDate) ?? 0;
    return d >= 0 && d <= 7;
  }).length;

  const columns: Column<ExitCaseListItem>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (x) => (
        <div className="flex min-w-52 items-center gap-3">
          <Avatar name={x.employeeName} />
          <div className="min-w-0">
            <div className="truncate font-medium">{x.employeeName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {x.employeeCode} · {x.designation ?? '—'}
              {x.departmentName ? ` · ${x.departmentName}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'case', header: 'Case', hideOnMobile: true, cell: (x) => <span className="font-mono text-xs">{x.caseNumber}</span> },
    {
      key: 'lwd',
      header: 'Last working day',
      cell: (x) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(x.lastWorkingDate)}</span>
          {x.status === 'OPEN' && <DaysLeft date={x.lastWorkingDate} />}
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Recovery',
      cell: (x) => {
        const cleared = x.returned + x.damaged;
        return (
          <div className="w-44">
            <div className="flex justify-between text-xs">
              <span className="tabular">
                {cleared}/{x.total} cleared
              </span>
              <span className="flex gap-1">
                {x.pending > 0 && <Badge tone="amber">{x.pending} pending</Badge>}
                {x.missing > 0 && <Badge tone="red">{x.missing} missing</Badge>}
              </span>
            </div>
            <Progress value={x.total ? (cleared / x.total) * 100 : 100} className="mt-1.5" indicatorClassName={x.pending + x.missing ? 'bg-amber-500' : 'bg-emerald-500'} />
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (x) => (
        <div className="flex flex-col gap-0.5">
          <EnumBadge value={x.status} tones={EXIT_CASE_TONE} />
          {x.overridden && <span className="text-[11px] text-red-600">Overridden</span>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Employee exits" description="Asset recovery for people on notice. Exits can’t complete until every asset is cleared." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Exits in progress" value={openItems.length} icon={LogOut} tone="amber" loading={open.isLoading} />
        <StatCard label="Assets still to recover" value={pending} tone={pending ? 'red' : 'default'} loading={open.isLoading} hint="Pending + missing" />
        <StatCard label="Leaving within 7 days" value={dueSoon} hint={overdue ? `${overdue} overdue with items outstanding` : 'None overdue'} loading={open.isLoading} />
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => set({ status: t.value || 'ALL' })}
            className={cn(
              'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
              (f.status === 'ALL' ? '' : f.status) === t.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee or case number…" className="pl-8" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(x) => x.id}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(x) => navigate(`/exits/${x.id}`)}
          keyboard
          empty={<EmptyState icon={LogOut} title={f.status === 'OPEN' ? 'No exits in progress' : 'No exit cases'} description="When HR moves someone to Notice Period, their asset recovery checklist appears here automatically." />}
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
    </div>
  );
}
