import { humanize } from '@eam/shared';
import { SearchField } from '@/components/common/search-field';
import { CheckCircle2, Play, Plus, Wrench, X } from '@/components/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AssetStatusBadge, EnumBadge } from '@/components/common/badges';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { EmptyState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { errorMessage } from '@freefounders/core';
import { useAuth } from '@/features/assets/lib/auth';
import { useAssetsCache, useMaintenanceList, useUpdateMaintenance } from '@freefounders/core/assets';
import { MAINTENANCE_TONE } from '@/lib/status';
import type { MaintenanceRecord } from '@freefounders/core/assets';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { chipActiveClass, chipClass, chipIdleClass } from '@/components/common/controls';
import { DownloadMenu } from '@/components/common/download-menu';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { assetsExports } from '@freefounders/core/assets';

const TABS = [
  { value: 'IN_PROGRESS,SCHEDULED', label: 'Active' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: '', label: 'All' },
];

export default function MaintenancePage() {
  const { can } = useAuth();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const manage = can('maintenance:manage');
  const { values: f, set } = useUrlFilters({ status: 'IN_PROGRESS,SCHEDULED', page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null);
  const cache = useAssetsCache();
  const q = useMaintenanceList(f);
  const update = useUpdateMaintenance({
    onSuccess: () => cache.invalidateAssetData(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns: Column<MaintenanceRecord>[] = [
    {
      key: 'title',
      header: 'Work',
      cell: (m) => (
        <div className="min-w-52">
          <div className="font-medium">{m.title}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{m.number}</span> · {humanize(m.type)}
            {m.vendorName ? ` · ${m.vendorName}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'asset',
      header: 'Asset',
      cell: (m) => (
        <Link to={`/assets/assets/${m.assetId}`} className="block hover:text-primary" onClick={(e) => e.stopPropagation()}>
          <div className="whitespace-nowrap">{m.assetName}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{m.assetTag}</span>
            {m.assetStatus && <AssetStatusBadge status={m.assetStatus} className="scale-90" />}
          </div>
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (m) => <EnumBadge value={m.status} tones={MAINTENANCE_TONE} /> },
    { key: 'date', header: 'Date', hideOnMobile: true, cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(m.completedAt ?? m.startedAt ?? m.scheduledDate ?? m.createdAt)}</span> },
    { key: 'cost', header: 'Cost', hideOnMobile: true, cell: (m) => <span className="tabular">{formatMoney(m.cost)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (m) =>
        manage && (
          <div className="flex justify-end gap-1">
            {m.status === 'SCHEDULED' && (
              <Button size="xs" variant="outline" onClick={() => update.mutate({ id: m.id, body: { status: 'IN_PROGRESS' } }, { onSuccess: () => toast.success(`${m.number} started`) })}>
                <Play /> Start
              </Button>
            )}
            {m.status === 'IN_PROGRESS' && (
              <Button size="xs" onClick={() => setCompleting(m)}>
                <CheckCircle2 /> Complete
              </Button>
            )}
            {(m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') && (
              <Button
                size="icon-xs"
                variant="ghost"
                title="Cancel"
                onClick={async () => {
                  const r = await confirm({ title: `Cancel ${m.number}?`, description: m.status === 'IN_PROGRESS' ? 'The asset goes back to service.' : undefined, confirmText: 'Cancel maintenance', destructive: true });
                  if (r.confirmed) update.mutate({ id: m.id, body: { status: 'CANCELLED' } }, { onSuccess: () => toast.success(`${m.number} cancelled`) });
                }}
              >
                <X />
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Maintenance"
        description="Repairs, servicing and inspections. Assets return to their holder (or to Available) when work completes."
        actions={
          <>
            <DownloadMenu
              filename={fileSlug('assets', 'maintenance', f.status, f.type, f.priority, f.search, todayStamp())}
              target={assetsExports.maintenance(f)}
              empty={q.data?.total === 0}
              loading={!q.data}
            />
            {manage && (
              <Button variant="cta" size="sm" onClick={() => quickAdd.open('maintenance')}>
                <Plus /> Log maintenance
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => set({ status: t.value || 'ALL' })}
            className={cn(
              chipClass,
              (f.status === 'ALL' ? '' : f.status) === t.value ? chipActiveClass : chipIdleClass,
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <SearchField className="relative max-w-md" label="Search work orders, assets" placeholder="Search work orders, assets…" value={search} onChange={setSearch} />
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(m) => m.id}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState icon={Wrench} title="No maintenance here" />}
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
      <CompleteDialog record={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}

function CompleteDialog({ record, onClose }: { record: MaintenanceRecord | null; onClose: () => void }) {
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  const cache = useAssetsCache();
  const save = useUpdateMaintenance({
    onSuccess: async () => {
      await cache.invalidateAssetData();
      toast.success(`${record!.number} completed — asset back in service`);
      setResolution('');
      setCost('');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete {record?.number}</DialogTitle>
          <DialogDescription>
            {record?.assetTag} · {record?.assetName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="What was done?">
            <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <Field label="Final cost (₹)">
            <Input type="number" min={0} placeholder={record?.cost != null ? String(record.cost) : undefined} value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => record && save.mutate({ id: record.id, body: { status: 'COMPLETED', resolution, cost: cost === '' ? (record.cost ?? null) : Number(cost) } })}>
            Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
