import { humanize } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search, Store, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, errorMessage, type Page } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { OrgEntity } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { ORG_META, type OrgKind } from './org-form';

const TITLES: Record<OrgKind, { title: string; description: string }> = {
  company: { title: 'Companies', description: 'Legal entities that own or hold assets.' },
  department: { title: 'Departments', description: 'Teams that can hold shared assets (printers, projectors, tools).' },
  location: { title: 'Locations', description: 'Sites, buildings, floors, rooms and stores / warehouses.' },
  vendor: { title: 'Vendors', description: 'Suppliers, lessors and service partners.' },
};

export default function OrgPage({ kind }: { kind: OrgKind }) {
  const meta = ORG_META[kind];
  const navigate = useNavigate();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const { values: f, set } = useUrlFilters({ page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useQuery({ queryKey: ['org', meta.path, f], queryFn: () => api.get<Page<OrgEntity>>(`/${meta.path}`, f) });
  const remove = useMutation({
    mutationFn: (row: OrgEntity) => api.del(`/${meta.path}/${row.id}`),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['org', meta.path] }), queryClient.invalidateQueries({ queryKey: ['lookup'] })]);
      toast.success(`${meta.label} deleted`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const assetsLink = (row: OrgEntity) =>
    kind === 'location' ? `/assets?locationId=${row.id}` : kind === 'company' ? `/assets?companyId=${row.id}` : kind === 'vendor' ? `/assets?vendorId=${row.id}` : `/assets?holderType=DEPARTMENT&holderId=${row.id}`;

  const count = (n: unknown) => <span className="tabular">{Number(n ?? 0)}</span>;
  const columns: Column<OrgEntity>[] = [
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      cell: (r) => (
        <div className="min-w-44">
          <div className="flex items-center gap-2 font-medium">
            {r.name}
            {kind === 'location' && r.isStore === true && (
              <Badge tone="violet">
                <Store /> Store
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.code && <span className="font-mono">{r.code}</span>}
            {typeof r.parentName === 'string' && ` · in ${r.parentName}`}
            {kind === 'location' && typeof r.type === 'string' && ` · ${humanize(r.type)}`}
          </div>
        </div>
      ),
    },
    ...(kind === 'department' || kind === 'location' ? [{ key: 'company', header: 'Company', hideOnMobile: true, cell: (r: OrgEntity) => <span className="text-muted-foreground">{(r.companyName as string) ?? '—'}</span> }] : []),
    ...(kind === 'vendor'
      ? [
          { key: 'contact', header: 'Contact', hideOnMobile: true, cell: (r: OrgEntity) => <span className="text-muted-foreground">{[r.contactName, r.email, r.phone].filter(Boolean).join(' · ') || '—'}</span> },
          { key: 'held', header: 'Holding', cell: (r: OrgEntity) => count(r.heldCount) },
        ]
      : []),
    ...(kind !== 'vendor' ? [{ key: 'employees', header: 'Employees', cell: (r: OrgEntity) => count(r.employeeCount) }] : []),
    {
      key: 'assets',
      header: kind === 'vendor' ? 'Supplied' : 'Assets',
      cell: (r) => (
        <button type="button" className="cursor-pointer tabular text-primary hover:underline" onClick={(e) => (e.stopPropagation(), navigate(assetsLink(r)))}>
          {Number(r.assetCount ?? 0)}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="icon-xs" variant="ghost" aria-label="Edit" onClick={() => quickAdd.open(kind, { record: r })}>
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete"
            onClick={async () => {
              const res = await confirm({ title: `Delete ${r.name}?`, description: 'Only possible when nothing references it.', destructive: true, confirmText: 'Delete' });
              if (res.confirmed) remove.mutate(r);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={TITLES[kind].title}
        description={TITLES[kind].description}
        actions={
          <Button size="sm" onClick={() => quickAdd.open(kind)}>
            <Plus /> Add {meta.label.toLowerCase()}
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${TITLES[kind].title.toLowerCase()}…`} className="pl-8" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(r) => quickAdd.open(kind, { record: r })}
          sort={{ key: f.sort ?? 'name', dir: (f.dir as 'asc' | 'desc') ?? 'asc' }}
          onSortChange={(s) => set({ sort: s.key, dir: s.dir }, { keepPage: true })}
          keyboard
          empty={<EmptyState title={`No ${TITLES[kind].title.toLowerCase()} yet`} action={<Button size="sm" onClick={() => quickAdd.open(kind)}><Plus /> Add {meta.label.toLowerCase()}</Button>} />}
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
    </div>
  );
}
