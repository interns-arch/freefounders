import { ONBOARDING_STATUS_LABELS } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { EnumBadge } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Card, Progress } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ONBOARDING_TONE } from '@/lib/status';
import type { OnboardingListItem } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, daysUntil, formatDate } from '@/lib/utils';

export function JoinsIn({ date, className }: { date: string; className?: string }) {
  const d = daysUntil(date) ?? 0;
  return (
    <span className={cn('whitespace-nowrap text-xs font-medium', d < 0 ? 'text-red-600' : d <= 3 ? 'text-amber-600' : 'text-muted-foreground', className)}>
      {d < 0 ? `was due ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'Joins today' : d === 1 ? 'Joins tomorrow' : `Joins in ${d} days`}
    </span>
  );
}

const OPEN = ['DRAFT', 'SUBMITTED', 'APPROVED'];

/** Joiner list with status tabs and search; used by HR's New joiners page and IT's Requests → New joiners. */
export function OnboardingTable({ tabs, defaultStatus, empty }: { tabs: { value: string; label: string }[]; defaultStatus: string; empty: ReactNode }) {
  const navigate = useNavigate();
  const { values: f, set } = useUrlFilters({ status: defaultStatus, page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useQuery({ queryKey: ['onboarding', f], queryFn: () => api.get<Page<OnboardingListItem>>('/onboarding', { ...f, view: undefined }) });

  const columns: Column<OnboardingListItem>[] = [
    {
      key: 'joiner',
      header: 'New joiner',
      cell: (o) => (
        <div className="flex min-w-52 items-center gap-3">
          <Avatar name={o.employeeName} />
          <div className="min-w-0">
            <div className="truncate font-medium">{o.employeeName}</div>
            <div className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{o.employeeCode}</span>
              {o.designation ? ` · ${o.designation}` : ''}
              {o.departmentName ? ` · ${o.departmentName}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'join',
      header: 'Joining',
      cell: (o) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(o.joinDate)}</span>
          {OPEN.includes(o.status) ? <JoinsIn date={o.joinDate} /> : null}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      hideOnMobile: true,
      cell: (o) => {
        const done = o.itemsIssued + o.itemsSkipped;
        return o.itemsTotal ? (
          <div className="w-32">
            <div className="mb-1 text-xs text-muted-foreground">
              {o.itemsIssued} of {o.itemsTotal - o.itemsSkipped} assigned
            </div>
            <Progress value={(done / o.itemsTotal) * 100} indicatorClassName={done === o.itemsTotal ? 'bg-emerald-500' : undefined} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Nothing listed yet</span>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (o) => <EnumBadge value={o.status} tones={ONBOARDING_TONE} labels={ONBOARDING_STATUS_LABELS} /> },
    { key: 'case', header: 'Case', hideOnMobile: true, cell: (o) => <span className="font-mono text-xs text-muted-foreground">{o.caseNumber}</span> },
  ];

  return (
    <>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => set({ status: t.value })}
            className={cn(
              'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
              f.status === t.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, employee ID, case…" className="pl-8" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(o) => o.id}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(o) => navigate(`/onboarding/${o.id}`)}
          keyboard
          empty={empty}
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
    </>
  );
}

/** HR's page: add joiners and follow them until they join. */
export default function OnboardingPage() {
  const quickAdd = useQuickAdd();
  const { can } = useAuth();
  const newJoiner = can('onboarding:manage') && (
    <Button size="sm" onClick={() => quickAdd.open('onboarding')}>
      <Plus /> New joiner
    </Button>
  );
  return (
    <div>
      <PageHeader title="New joiners" description="Tell IT who is joining and what they need. IT approves it, assigns everything, and you mark them as joined on day 1." actions={newJoiner} />
      <OnboardingTable
        defaultStatus="DRAFT,SUBMITTED,APPROVED"
        tabs={[
          { value: 'DRAFT,SUBMITTED,APPROVED', label: 'Upcoming' },
          { value: 'DRAFT', label: 'Drafts' },
          { value: 'SUBMITTED', label: 'Waiting for IT' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'COMPLETED', label: 'Joined' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
        empty={<EmptyState icon={UserPlus} title="No one joining soon" description="Add a new joiner to get their things ready before day 1." action={newJoiner || undefined} />}
      />
    </div>
  );
}
