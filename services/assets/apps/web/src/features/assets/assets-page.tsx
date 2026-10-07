import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  CONDITIONS,
  formatAttributeValue,
  HOLDER_TYPE_LABELS,
  ASSIGNABLE_HOLDERS,
  humanize,
  OWNERSHIP_TYPES,
} from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Boxes, LayoutGrid, List, Plus, Printer, ScanLine, Search, Tags, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AssetStatusBadge, HolderLabel } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Combobox } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { queryClient, useAssetType, useAssetTypes, useCategories } from '@/lib/queries';
import type { AssetDetail, AssetListItem, AssetListResponse } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, daysUntil, formatDate, formatNumber, relativeTime } from '@/lib/utils';
import { BulkDialog, type BulkKind } from './bulk-dialog';
import { AttributeFilters } from './attribute-filters';

const STATUS_TABS: (AssetStatus | 'ALL')[] = ['ALL', 'AVAILABLE', 'ASSIGNED', 'IN_INVENTORY', 'IN_MAINTENANCE', 'RETURNED', 'PURCHASED', 'RECEIVED', 'LOST', 'RETIRED', 'DISPOSED'];

function useView() {
  const [view, setView] = useState<'table' | 'cards'>(() => {
    try {
      return (localStorage.getItem('eam-assets-view') as 'table' | 'cards') || (window.innerWidth < 640 ? 'cards' : 'table');
    } catch {
      return 'table';
    }
  });
  return [
    view,
    (v: 'table' | 'cards') => {
      setView(v);
      try {
        localStorage.setItem('eam-assets-view', v);
      } catch {
        /* ignore */
      }
    },
  ] as const;
}

export default function AssetsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const quickAdd = useQuickAdd();
  const { values: f, set, clear } = useUrlFilters({ page: '1', pageSize: '25', sort: 'createdAt', dir: 'desc' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const [view, setView] = useView();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const categories = useCategories();
  const types = useAssetTypes();
  const selectedType = useAssetType(f.assetTypeId && !f.assetTypeId.includes(',') ? f.assetTypeId : null);
  const seesAll = can('asset:view');

  const query = useQuery({
    queryKey: ['assets', f],
    queryFn: () => api.get<AssetListResponse>('/assets', f),
  });
  const data = query.data;
  const counts = data?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const typeOptions = (types.data ?? [])
    .filter((t) => !f.categoryId || t.categoryId === f.categoryId)
    .map((t) => ({ value: t.id, label: t.name, description: t.categoryName, icon: <AssetIcon icon={t.icon ?? t.categoryIcon} color={t.categoryColor} size="sm" /> }));

  const customColumns = useMemo(() => (selectedType.data?.fields ?? []).filter((fd) => fd.showInTable).slice(0, 6), [selectedType.data]);

  const columns: Column<AssetListItem>[] = [
    {
      key: 'asset',
      header: 'Asset',
      sortKey: 'name',
      cell: (a) => (
        <div className="flex min-w-56 items-center gap-3">
          <AssetIcon icon={a.typeIcon ?? a.categoryIcon} color={a.categoryColor} />
          <div className="min-w-0">
            <div className="truncate font-medium">{a.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{a.assetTag}</span>
              {a.serialNumber && <> · {a.serialNumber}</>}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sortKey: 'type', hideOnMobile: true, cell: (a) => <span className="whitespace-nowrap text-muted-foreground">{a.typeName}</span> },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (a) => (
        <div className="flex flex-col gap-0.5">
          <AssetStatusBadge status={a.status} />
          {a.trackingMode === 'QUANTITY' && (
            <span className="text-[11px] text-muted-foreground tabular">
              {a.consumable ? `${a.availableQuantity} left` : `${a.availableQuantity} of ${a.quantity} free`}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'holder',
      header: 'Assigned to',
      sortKey: 'holderName',
      cell: (a) =>
        a.trackingMode === 'QUANTITY' ? (
          <span className="text-muted-foreground">{a.quantity - a.availableQuantity > 0 ? `${a.quantity - a.availableQuantity} units issued` : '—'}</span>
        ) : (
          <HolderLabel type={a.holderType} name={a.holderName} className="max-w-52" />
        ),
    },
    ...customColumns.map<Column<AssetListItem>>((fd, i) => ({
      key: `f-${fd.key}`,
      header: fd.label,
      hideOnMobile: i > 0,
      cell: (a) => <span className="whitespace-nowrap">{fd.type === 'date' && typeof a.attributes[fd.key] === 'string' ? formatDate(a.attributes[fd.key] as string) : formatAttributeValue(fd, a.attributes[fd.key])}</span>,
    })),
    {
      key: 'warranty',
      header: 'Warranty',
      sortKey: 'warrantyExpiry',
      hideOnMobile: true,
      cell: (a) => {
        const d = daysUntil(a.warrantyExpiry);
        if (d === null) return <span className="text-muted-foreground">—</span>;
        return <span className={cn('whitespace-nowrap', d < 0 ? 'text-muted-foreground line-through' : d <= 30 ? 'font-medium text-amber-600' : '')}>{formatDate(a.warrantyExpiry)}</span>;
      },
    },
    { key: 'updated', header: 'Updated', sortKey: 'updatedAt', hideOnMobile: true, cell: (a) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(a.updatedAt)}</span> },
  ];

  const prefetch = (a: AssetListItem) => {
    void queryClient.prefetchQuery({ queryKey: ['asset', a.id], queryFn: () => api.get<AssetDetail>(`/assets/${a.id}`), staleTime: 15_000 });
  };

  const activeFilters: { key: string; label: string }[] = [];
  if (f.categoryId) activeFilters.push({ key: 'categoryId', label: `Category: ${categories.data?.find((c) => c.id === f.categoryId)?.name ?? '…'}` });
  if (f.assetTypeId) activeFilters.push({ key: 'assetTypeId', label: `Type: ${types.data?.find((t) => t.id === f.assetTypeId)?.name ?? '…'}` });
  if (f.holderType) activeFilters.push({ key: 'holderType', label: `Held by: ${HOLDER_TYPE_LABELS[f.holderType as keyof typeof HOLDER_TYPE_LABELS] ?? f.holderType}${f.holderId ? ' (one)' : ''}` });
  if (f.employeeId) activeFilters.push({ key: 'employeeId', label: 'Employee filter' });
  if (f.vendorId) activeFilters.push({ key: 'vendorId', label: 'Vendor filter' });
  if (f.condition) activeFilters.push({ key: 'condition', label: `Condition: ${humanize(f.condition)}` });
  if (f.ownership) activeFilters.push({ key: 'ownership', label: `Ownership: ${humanize(f.ownership)}` });
  if (f.warranty) activeFilters.push({ key: 'warranty', label: f.warranty === 'expiring' ? 'Warranty expiring ≤30d' : 'Warranty expired' });
  for (const [k, v] of Object.entries(f)) if (k.startsWith('f.')) activeFilters.push({ key: k, label: `${humanize(k.slice(2).replace(/\.(min|max)$/, ''))}${k.endsWith('.min') ? ' ≥ ' : k.endsWith('.max') ? ' ≤ ' : ': '}${v}` });

  const ids = [...selected];
  const empty = (
    <EmptyState
      icon={Boxes}
      title={activeFilters.length || f.search || f.status ? 'No assets match these filters' : seesAll ? 'No assets yet' : 'No assets assigned to you'}
      description={activeFilters.length || f.search ? 'Try removing a filter or searching for something else.' : seesAll ? 'Add your first asset — any type, with its own fields.' : undefined}
      action={
        activeFilters.length || f.search || f.status ? (
          <Button variant="outline" size="sm" onClick={() => clear()}>
            Clear filters
          </Button>
        ) : can('asset:create') ? (
          <Button size="sm" onClick={() => quickAdd.open('asset')}>
            <Plus /> Add asset
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div>
      <PageHeader
        title={seesAll ? 'Assets' : 'My assets'}
        description={data ? `${formatNumber(data.total)} ${f.status ? ASSET_STATUS_LABELS[f.status as AssetStatus]?.toLowerCase() ?? '' : ''} assets` : 'Everything the company owns, leases, stores or assigns.'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/scan')}>
              <ScanLine /> Scan
            </Button>
            {can('asset:create') && (
              <Button size="sm" onClick={() => quickAdd.open('asset', { defaults: { assetTypeId: f.assetTypeId } })}>
                <Plus /> Add asset
              </Button>
            )}
          </>
        }
      />

      {/* Status tabs with live counts */}
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 no-scrollbar">
        {STATUS_TABS.filter((s) => s === 'ALL' || (counts[s] ?? 0) > 0 || f.status === s).map((s) => {
          const active = (f.status ?? 'ALL') === s;
          const n = s === 'ALL' ? allCount : (counts[s] ?? 0);
          return (
            <button
              key={s}
              type="button"
              onClick={() => set({ status: s === 'ALL' ? null : s })}
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {s === 'ALL' ? 'All' : ASSET_STATUS_LABELS[s]}
              <span className={cn('rounded px-1.5 text-[11px] tabular', active ? 'bg-primary/15' : 'bg-muted')}>{formatNumber(n)}</span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, tag, serial, holder, specs…" className="pl-8" aria-label="Search assets" />
            {search && (
              <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setSearch('')} aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <NativeSelect className="w-auto min-w-36" value={f.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value, assetTypeId: null })} aria-label="Category">
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <div className="w-44">
            <Combobox value={f.assetTypeId ?? null} onChange={(v) => set({ assetTypeId: v })} options={typeOptions} placeholder="All types" searchPlaceholder="Search types…" />
          </div>
          <NativeSelect className="hidden w-auto min-w-32 lg:block" value={f.holderType ?? ''} onChange={(e) => set({ holderType: e.target.value, holderId: null })} aria-label="Held by">
            <option value="">Any holder</option>
            {ASSIGNABLE_HOLDERS.map((h) => (
              <option key={h} value={h}>
                {h === 'INVENTORY' ? 'In store' : HOLDER_TYPE_LABELS[h]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="hidden w-auto min-w-32 xl:block" value={f.condition ?? ''} onChange={(e) => set({ condition: e.target.value })} aria-label="Condition">
            <option value="">Any condition</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="hidden w-auto min-w-32 xl:block" value={f.ownership ?? ''} onChange={(e) => set({ ownership: e.target.value })} aria-label="Ownership">
            <option value="">Any ownership</option>
            {OWNERSHIP_TYPES.map((o) => (
              <option key={o} value={o}>
                {humanize(o)}
              </option>
            ))}
          </NativeSelect>
          <AttributeFilters categoryId={f.categoryId} assetTypeId={f.assetTypeId} values={f} onApply={(p) => set(p)} />
          <div className="ml-auto flex rounded-lg border p-0.5">
            <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="icon-xs" onClick={() => setView('table')} aria-label="Table view">
              <List />
            </Button>
            <Button variant={view === 'cards' ? 'secondary' : 'ghost'} size="icon-xs" onClick={() => setView('cards')} aria-label="Card view">
              <LayoutGrid />
            </Button>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-3 py-2">
            {activeFilters.map((af) => (
              <button
                key={af.key}
                type="button"
                onClick={() => set({ [af.key]: null, ...(af.key === 'holderType' ? { holderId: null } : {}) })}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs hover:border-destructive/40"
              >
                {af.label} <X className="size-3" />
              </button>
            ))}
            <button type="button" className="cursor-pointer text-xs text-muted-foreground hover:text-foreground" onClick={() => clear(['status', 'search'])}>
              Clear all
            </button>
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <div className="mx-1 h-4 w-px bg-border" />
            {can('asset:assign') && (
              <Button size="xs" variant="outline" onClick={() => setBulk('assign')}>
                <ArrowRightLeft /> Assign
              </Button>
            )}
            {can('asset:lifecycle') && (
              <Button size="xs" variant="outline" onClick={() => setBulk('lifecycle')}>
                <Tags /> Change status
              </Button>
            )}
            <Button size="xs" variant="outline" onClick={() => navigate(`/labels?ids=${ids.join(',')}`)}>
              <Printer /> Print labels
            </Button>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {view === 'table' ? (
          <DataTable
            columns={columns}
            rows={data?.items}
            rowKey={(a) => a.id}
            loading={query.isLoading}
            fetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            onRowClick={(a) => navigate(`/assets/${a.id}`)}
            onRowHover={prefetch}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            sort={{ key: f.sort, dir: f.dir as 'asc' | 'desc' }}
            onSortChange={(s) => set({ sort: s.key, dir: s.dir }, { keepPage: true })}
            empty={empty}
            keyboard
          />
        ) : query.error && !data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {query.isLoading
              ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-36" />)
              : data?.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onMouseEnter={() => prefetch(a)}
                    onClick={() => navigate(`/assets/${a.id}`)}
                    className={cn('flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm', selected.has(a.id) && 'border-primary ring-1 ring-primary/30')}
                  >
                    <div className="flex items-start gap-3">
                      <AssetIcon icon={a.typeIcon ?? a.categoryIcon} color={a.categoryColor} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{a.assetTag}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.typeName}</p>
                      </div>
                    </div>
                    {customColumns.length > 0 && (
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                        {customColumns.map((fd) => (
                          <Fragment key={fd.key}>
                            <dt className="text-muted-foreground">{fd.label}</dt>
                            <dd className="truncate font-medium">{fd.type === 'date' && typeof a.attributes[fd.key] === 'string' ? formatDate(a.attributes[fd.key] as string) : formatAttributeValue(fd, a.attributes[fd.key])}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <AssetStatusBadge status={a.status} />
                      <span className="text-xs text-muted-foreground">{relativeTime(a.updatedAt)}</span>
                    </div>
                    <div className="border-t pt-2 text-xs">
                      {a.trackingMode === 'QUANTITY' ? (
                        <span className="text-muted-foreground">
                          {a.availableQuantity} of {a.quantity} available
                        </span>
                      ) : (
                        <HolderLabel type={a.holderType} name={a.holderName ?? (a.locationName ? null : null)} />
                      )}
                    </div>
                  </button>
                ))}
            {!query.isLoading && !data?.items.length && <div className="col-span-full">{empty}</div>}
          </div>
        )}

        {data && data.total > 0 && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(p) => set({ page: p }, { keepPage: true })}
            onPageSizeChange={(s) => set({ pageSize: s })}
          />
        )}
      </Card>

      <BulkDialog
        kind={bulk}
        ids={ids}
        onClose={() => setBulk(null)}
        onDone={(failed) => {
          setBulk(null);
          setSelected(new Set(failed));
        }}
      />
    </div>
  );
}
