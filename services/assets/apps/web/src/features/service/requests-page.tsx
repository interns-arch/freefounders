import { humanize, PRIORITIES } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ClipboardList, PackageCheck, Plus, Search, UserPlus, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { EnumBadge } from '@/components/common/badges';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { PhotoPicker, uploadPhotos } from '@/components/common/photos';
import { EmptyState, PageHeader } from '@/components/common/page';
import { EntityPicker } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { OnboardingTable } from '@/features/onboarding/onboarding-page';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, errorMessage, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { invalidateAssetData, queryClient } from '@/lib/queries';
import { PRIORITY_TONE, REQUEST_TONE } from '@/lib/status';
import type { AssetRequest } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDate, relativeTime } from '@/lib/utils';

const TABS = [
  { value: 'PENDING,APPROVED', label: 'Open' },
  { value: 'PENDING', label: 'Pending approval' },
  { value: 'APPROVED', label: 'To fulfil' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'REJECTED,CANCELLED', label: 'Closed' },
  { value: '', label: 'All' },
];

export default function RequestsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const joiners = can('asset:assign') && params.get('view') === 'joiners';
  const waiting = useQuery({
    queryKey: ['onboarding', 'waiting-count'],
    queryFn: () => api.get<Page<unknown>>('/onboarding', { status: 'SUBMITTED', pageSize: 1 }),
    enabled: can('asset:assign'),
  });
  const switcher = can('asset:assign') && (
    <div className="mb-4 flex gap-0.5 rounded-lg bg-muted p-0.5 sm:w-fit">
      {[
        { to: '/requests', label: 'Asset requests', active: !joiners, count: 0 },
        { to: '/requests?view=joiners', label: 'New joiners', active: joiners, count: waiting.data?.total ?? 0 },
      ].map((v) => (
        <Link
          key={v.to}
          to={v.to}
          className={cn('flex-1 rounded-md px-3 py-1.5 text-center text-[13px] font-medium transition sm:flex-none', v.active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {v.label}
          {v.count > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{v.count}</span>}
        </Link>
      ))}
    </div>
  );
  if (joiners) {
    return (
      <div>
        <PageHeader title="Requests" description="New joiners from HR: approve what they need, then assign it all before their first day." />
        {switcher}
        <OnboardingTable
          defaultStatus="SUBMITTED,APPROVED"
          tabs={[
            { value: 'SUBMITTED,APPROVED', label: 'Open' },
            { value: 'SUBMITTED', label: 'To approve' },
            { value: 'APPROVED', label: 'To assign' },
            { value: 'COMPLETED', label: 'Joined' },
          ]}
          empty={<EmptyState icon={UserPlus} title="No new joiners waiting" description="When HR sends a new joiner, it appears here for approval." />}
        />
      </div>
    );
  }
  return <AssetRequests switcher={switcher} />;
}

function AssetRequests({ switcher }: { switcher: React.ReactNode }) {
  const { can, me } = useAuth();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const { values: f, set } = useUrlFilters({ status: 'PENDING,APPROVED', page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const [fulfil, setFulfil] = useState<AssetRequest | null>(null);
  const q = useQuery({ queryKey: ['requests', f], queryFn: () => api.get<Page<AssetRequest>>('/requests', { ...f, status: f.status === 'ALL' ? '' : f.status }) });

  const act = useMutation({
    mutationFn: ({ r, path, body }: { r: AssetRequest; path: string; body?: unknown }) => api.post(`/requests/${r.id}/${path}`, body ?? {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const decide = async (r: AssetRequest, decision: 'APPROVE' | 'REJECT') => {
    const res = await confirm({
      title: `${decision === 'APPROVE' ? 'Approve' : 'Reject'} ${r.number}?`,
      description: `${r.employeeName} requested ${r.quantity} × ${r.typeName}.`,
      confirmText: decision === 'APPROVE' ? 'Approve' : 'Reject',
      destructive: decision === 'REJECT',
      note: { label: 'Note to requester', required: decision === 'REJECT' },
    });
    if (res.confirmed) act.mutate({ r, path: 'decision', body: { decision, note: res.note } }, { onSuccess: () => toast.success(`${r.number} ${decision === 'APPROVE' ? 'approved' : 'rejected'}`) });
  };

  const columns: Column<AssetRequest>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (r) => (
        <div className="min-w-56">
          <div className="font-medium">
            {r.quantity > 1 ? `${r.quantity} × ` : ''}
            {r.typeName}
          </div>
          <div className="line-clamp-1 text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · {r.reason}
          </div>
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'For',
      cell: (r) => (
        <div>
          <div className="whitespace-nowrap">{r.employeeName}</div>
          <div className="text-xs text-muted-foreground">{r.departmentName ?? r.employeeCode}</div>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', hideOnMobile: true, cell: (r) => <EnumBadge value={r.priority} tones={PRIORITY_TONE} dot={false} /> },
    { key: 'needed', header: 'Needed by', hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.neededBy ? formatDate(r.neededBy) : '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <EnumBadge value={r.status} tones={REQUEST_TONE} />
          {r.status === 'FULFILLED' && r.fulfilledAssetTag && <span className="font-mono text-[11px] text-muted-foreground">{r.fulfilledAssetTag}</span>}
          {(r.status === 'PENDING' || r.status === 'APPROVED') && (
            <span className={cn('text-[11px]', r.custom ? 'text-muted-foreground' : r.availableCount ? 'text-emerald-600' : 'text-red-600')}>{r.custom ? 'Not in catalog' : `${r.availableCount} in stock`}</span>
          )}
        </div>
      ),
    },
    { key: 'created', header: 'Raised', hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(r.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === 'PENDING' && can('request:approve') && (
            <>
              <Button size="xs" variant="outline" onClick={() => decide(r, 'APPROVE')}>
                <Check /> Approve
              </Button>
              <Button size="icon-xs" variant="ghost" title="Reject" onClick={() => decide(r, 'REJECT')}>
                <X />
              </Button>
            </>
          )}
          {r.status === 'APPROVED' && can('request:fulfil') && (
            <Button size="xs" onClick={() => setFulfil(r)}>
              <PackageCheck /> Fulfil
            </Button>
          )}
          {(r.status === 'PENDING' || r.status === 'APPROVED') && r.employeeId === me?.employee?.id && !can('request:approve') && (
            <Button size="xs" variant="ghost" onClick={() => act.mutate({ r, path: 'cancel' }, { onSuccess: () => toast.success('Request cancelled') })}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Asset requests"
        description="Employees ask, managers approve, IT fulfils by assigning an asset."
        actions={
          can('request:create') && (
            <Button size="sm" onClick={() => quickAdd.open('request')}>
              <Plus /> New request
            </Button>
          )
        }
      />
      {switcher}
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
        <NativeSelect className="ml-auto h-8 w-auto shrink-0 text-[13px]" value={f.priority ?? ''} onChange={(e) => set({ priority: e.target.value })}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests…" className="pl-8" />
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
          empty={
            <EmptyState
              icon={ClipboardList}
              title="No requests"
              action={
                can('request:create') ? (
                  <Button size="sm" onClick={() => quickAdd.open('request')}>
                    <Plus /> New request
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
      <FulfilDialog request={fulfil} onClose={() => setFulfil(null)} />
    </div>
  );
}

function FulfilDialog({ request, onClose }: { request: AssetRequest | null; onClose: () => void }) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ allocationId: string }>(`/requests/${request!.id}/fulfil`, { assetId });
      if (photos.length) {
        try {
          await uploadPhotos(assetId!, res.allocationId, 'HANDOVER', photos);
        } catch (err) {
          toast.error(`Fulfilled, but the photos did not upload: ${errorMessage(err)}`);
        }
      }
    },
    onSuccess: async () => {
      await invalidateAssetData();
      toast.success(`${request!.number} fulfilled — asset assigned to ${request!.employeeName}`);
      setAssetId(null);
      setPhotos([]);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fulfil {request?.number}</DialogTitle>
          <DialogDescription>
            Pick {request?.custom ? 'any asset that matches' : `an available ${request?.typeName}`} for {request?.employeeName}. It will be assigned to them immediately.
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="grid gap-4">
            <Field label="Asset">
              <EntityPicker kind="asset" value={assetId} onChange={setAssetId} assetFilter={{ assetTypeId: request.assetTypeId ?? undefined, status: 'AVAILABLE,IN_INVENTORY' }} />
            </Field>
            <Field label="Handover photos">
              <PhotoPicker files={photos} onChange={setPhotos} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!assetId} loading={save.isPending} onClick={() => save.mutate()}>
            Assign & fulfil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
