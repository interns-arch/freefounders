import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Printer, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EmployeeStatusBadge } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, Card } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDepartments } from '@/lib/queries';
import type { Employee } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, daysUntil, formatDate, formatNumber } from '@/lib/utils';

const TABS: { value: string; label: string }[] = [
  { value: '', label: 'Current' },
  { value: 'JOINING', label: 'Joining' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'NOTICE_PERIOD', label: 'Notice period' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'EXITED', label: 'Exited' },
];

export default function EmployeesPage() {
  const navigate = useNavigate();
  const quickAdd = useQuickAdd();
  const { can } = useAuth();
  const { values: f, set, clear } = useUrlFilters({ page: '1', pageSize: '25', sort: 'name', dir: 'asc' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const departments = useDepartments();
  const q = useQuery({ queryKey: ['employees', f], queryFn: () => api.get<Page<Employee>>('/employees', f) });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const contactsView = f.view === 'contacts';
  const nameColumn: Column<Employee> = {
    key: 'name',
    header: 'Employee',
    sortKey: 'name',
    cell: (e) => (
      <div className="flex min-w-48 items-center gap-3">
        <Avatar name={e.fullName} />
        <div className="min-w-0">
          <div className="truncate font-medium">{e.fullName}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{e.employeeCode}</div>
        </div>
      </div>
    ),
  };
  const contactColumns: Column<Employee>[] = [
    nameColumn,
    { key: 'phone', header: 'Official phone', cell: (e) => <ContactLink kind="tel" value={e.phone} /> },
    {
      key: 'sims',
      header: 'Company SIM',
     
      cell: (e) =>
        e.companySims?.length ? (
          <div className="flex flex-col">
            {e.companySims.map((n) => (
              <ContactLink key={n} kind="tel" value={n} />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'email', header: 'Official email', cell: (e) => <ContactLink kind="mailto" value={e.email} /> },
    { key: 'personalPhone', header: 'Personal phone', cell: (e) => <ContactLink kind="tel" value={e.personalPhone} /> },
    { key: 'personalEmail', header: 'Personal email', cell: (e) => <ContactLink kind="mailto" value={e.personalEmail} /> },
  ];

  const detailColumns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Employee',
      sortKey: 'name',
      cell: (e) => (
        <div className="flex min-w-52 items-center gap-3">
          <Avatar name={e.fullName} />
          <div className="min-w-0">
            <div className="truncate font-medium">{e.fullName}</div>
            <div className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{e.employeeCode}</span>
              {e.email ? ` · ${e.email}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'designation', header: 'Designation', hideOnMobile: true, cell: (e) => <span className="text-muted-foreground">{e.designation ?? '—'}</span> },
    { key: 'department', header: 'Department', hideOnMobile: true, cell: (e) => e.departmentName ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (e) => {
        const d = daysUntil(e.lastWorkingDate);
        return (
          <div className="flex flex-col gap-0.5">
            <EmployeeStatusBadge status={e.status} />
            {e.status === 'NOTICE_PERIOD' && e.lastWorkingDate && (
              <span className={cn('text-[11px]', d !== null && d <= 3 ? 'font-medium text-amber-600' : 'text-muted-foreground')}>LWD {formatDate(e.lastWorkingDate)}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'assets',
      header: 'Assets',
      cell: (e) => (
        <span className={cn('tabular', e.assetCount === 0 ? 'text-muted-foreground' : 'font-medium')}>
          {e.assetCount}
          {e.status === 'NOTICE_PERIOD' && e.assetCount > 0 && <span className="ml-1 text-xs font-normal text-amber-600">to recover</span>}
        </span>
      ),
    },
  ];
  const columns = contactsView ? contactColumns : detailColumns;

  return (
    <div>
      <PageHeader
        title="Employees"
        description={q.data ? `${formatNumber(q.data.total)} ${f.status ? EMPLOYEE_STATUS_LABELS[f.status as EmployeeStatus]?.toLowerCase() : 'current'} employees` : 'People who can hold company assets.'}
        actions={
          <>
            {!!q.data?.items.length && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/id-cards?ids=${(selected.size ? [...selected] : q.data!.items.map((x) => x.id)).join(',')}`)}>
                <Printer /> {selected.size ? `Print ${selected.size} ID cards` : 'Print ID cards'}
              </Button>
            )}
            {can('employee:manage') && (
              <Button size="sm" onClick={() => quickAdd.open('employee')}>
                <Plus /> Add employee
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {TABS.map((t) => {
          const active = (f.status ?? '') === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ status: t.value || null, includeExited: null })}
              className={cn(
                'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          );
        })}
        <div className="ml-auto flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
          {[
            { value: null, label: 'Details' },
            { value: 'contacts', label: 'Phones & emails' },
          ].map((v) => (
            <button
              key={v.label}
              type="button"
              onClick={() => set({ view: v.value }, { keepPage: true })}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition',
                (f.view ?? null) === v.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, employee ID, phone, email…" className="pl-8" />
          </div>
          <NativeSelect className="w-auto min-w-40" value={f.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" className="accent-[var(--primary)]" checked={f.hasAssets === '1'} onChange={(e) => set({ hasAssets: e.target.checked ? '1' : null })} />
            Holding assets
          </label>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <Button size="xs" variant="outline" onClick={() => navigate(`/id-cards?ids=${[...selected].join(',')}`)}>
              <Printer /> Print ID cards
            </Button>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(e) => e.id}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          sort={{ key: f.sort, dir: f.dir as 'asc' | 'desc' }}
          onSortChange={(s) => set({ sort: s.key, dir: s.dir }, { keepPage: true })}
          keyboard
          empty={
            <EmptyState
              icon={Users}
              title="No employees found"
              action={
                f.search || f.departmentId ? (
                  <Button variant="outline" size="sm" onClick={() => clear(['status'])}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {q.data && q.data.total > 0 && (
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} onPageSizeChange={(s) => set({ pageSize: s })} />
        )}
      </Card>
    </div>
  );
}

function ContactLink({ kind, value }: { kind: 'tel' | 'mailto'; value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={`${kind}:${kind === 'tel' ? value.replace(/[^\d+]/g, '') : value}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-primary hover:underline">
      {value}
    </a>
  );
}
