import { humanize, PRIORITIES } from '@eam/shared';
import { SearchField } from '@/components/common/search-field';
import { useMutation } from '@tanstack/react-query';
import { Check, ClipboardList, PackageCheck, Plus, UserPlus, X } from '@/components/icons';
import { DetailList } from '@/components/common/page';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Link, useSearchParams } from 'react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { EnumBadge } from '@/components/common/badges';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { PhotoPicker, uploadPhotos } from '@/features/assets/components/photos';
import { EmptyState, PageHeader } from '@/components/common/page';
import { EntityPicker } from '@/features/assets/components/pickers';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Card } from '@/components/ui/primitives';
import { OnboardingDownload, OnboardingTable } from '@/features/assets/onboarding/onboarding-page';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { errorMessage } from '@freefounders/core';
import { useAuth } from '@/features/assets/lib/auth';
import { fulfilRequest, useAssetsCache, useOnboardingWaitingCount, useRequest, useRequestAction, useRequests } from '@freefounders/core/assets';
import { PRIORITY_TONE, REQUEST_TONE } from '@/lib/status';
import type { AssetRequest } from '@freefounders/core/assets';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { chipActiveClass, chipClass, chipIdleClass } from '@/components/common/controls';
import { DownloadMenu } from '@/components/common/download-menu';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { assetsExports } from '@freefounders/core/assets';

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
  const waiting = useOnboardingWaitingCount(can('asset:assign'));
  const switcher = can('asset:assign') && (
    <div className="mb-4 flex gap-0.5 rounded-md border bg-muted p-0.5 sm:w-fit">
      {[
        { to: '/assets/requests', label: 'Asset requests', active: !joiners, count: 0 },
        { to: '/assets/requests?view=joiners', label: 'New joiners', active: joiners, count: waiting.data?.total ?? 0 },
      ].map((v) => (
        <Link
          key={v.to}
          to={v.to}
          aria-current={v.active ? 'page' : undefined}
          className={cn('inline-flex h-8 flex-1 items-center justify-center rounded-sm px-3 text-[13px] font-semibold whitespace-nowrap transition-colors max-sm:h-[2.375rem] sm:flex-none', v.active ? 'bg-card text-primary shadow-card ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
        >
          {v.label}
          {v.count > 0 && <span className="ml-1.5 rounded-sm bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">{v.count}</span>}
        </Link>
      ))}
    </div>
  );
  if (joiners) {
    return (
      <div>
        <PageHeader title="Requests" description="New joiners from HR: approve what they need, then assign it all before their first day." actions={<OnboardingDownload defaultStatus="SUBMITTED,APPROVED" />} />
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
  const { open: openId, ...listFilters } = f;
  const q = useRequests(listFilters);
  const cache = useAssetsCache();

  const act = useRequestAction({
    onSuccess: () => cache.invalidate('requests', 'dashboard'),
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
    if (res.confirmed) act.mutate({ id: r.id, path: 'decision', body: { decision, note: res.note } }, { onSuccess: () => toast.success(`${r.number} ${decision === 'APPROVE' ? 'approved' : 'rejected'}`) });
  };

  const actionsFor = (r: AssetRequest, size: 'xs' | 'sm' = 'xs') => (
    <>
      {r.status === 'PENDING' && (r.canDecide ?? can('request:approve')) && (
        <>
          <Button size={size} variant="outline" onClick={() => decide(r, 'APPROVE')}>
            <Check /> Approve
          </Button>
          {size === 'xs' ? (
            <Button size="icon-xs" variant="ghost" title="Reject" aria-label="Reject" onClick={() => decide(r, 'REJECT')}>
              <X />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => decide(r, 'REJECT')}>
              <X /> Reject
            </Button>
          )}
        </>
      )}
      {r.status === 'APPROVED' && can('request:fulfil') && (
        <Button size={size} onClick={() => setFulfil(r)}>
          <PackageCheck /> Fulfil
        </Button>
      )}
      {(r.status === 'PENDING' || r.status === 'APPROVED') && r.employeeId === me?.employee?.id && !can('request:approve') && (
        <Button size={size} variant="ghost" onClick={() => act.mutate({ id: r.id, path: 'cancel' }, { onSuccess: () => toast.success('Request cancelled') })}>
          Cancel
        </Button>
      )}
    </>
  );

  const columns: Column<AssetRequest>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (r) => (
        <div className="flex min-w-56 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info dark:bg-info/16">
            <ClipboardList className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">
              {r.quantity > 1 ? `${r.quantity} × ` : ''}
              {r.typeName}
            </div>
            <div className="line-clamp-1 text-xs text-muted-foreground">
              <span className="font-mono">{r.number}</span> · {r.reason}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'For',
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.employeeName} className="size-7 text-xs" />
          <div className="min-w-0">
            <div className="whitespace-nowrap">{r.employeeName}</div>
            <div className="text-xs text-muted-foreground">{r.departmentName ?? r.employeeCode}</div>
          </div>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', hideOnMobile: true, cell: (r) => <EnumBadge value={r.priority} tones={PRIORITY_TONE} /> },
    { key: 'needed', header: 'Needed by', hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.neededBy ? formatDate(r.neededBy) : '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <EnumBadge value={r.status} tones={REQUEST_TONE} />
          {r.status === 'FULFILLED' && r.fulfilledAssetTag && <span className="font-mono text-[11px] text-muted-foreground">{r.fulfilledAssetTag}</span>}
          {(r.status === 'PENDING' || r.status === 'APPROVED') && (
            <span className={cn('text-xs', r.custom ? 'text-muted-foreground' : r.availableCount ? 'text-success' : 'text-destructive')}>{r.custom ? 'Not in catalog' : `${r.availableCount} in stock`}</span>
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
          {actionsFor(r)}
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
          <>
            <DownloadMenu
              filename={fileSlug('assets', 'requests', f.status, f.priority, f.search, todayStamp())}
              target={assetsExports.requests(listFilters)}
              empty={q.data?.total === 0}
              loading={!q.data}
            />
            {can('request:create') && (
              <Button variant="cta" size="sm" onClick={() => quickAdd.open('request')}>
                <Plus /> New request
              </Button>
            )}
          </>
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
              chipClass,
              (f.status === 'ALL' ? '' : f.status) === t.value ? chipActiveClass : chipIdleClass,
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
          <SearchField className="relative max-w-md" label="Search requests" placeholder="Search requests…" value={search} onChange={setSearch} />
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(r) => r.id}
          onRowClick={(r) => set({ open: r.id }, { keepPage: true })}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={
            <EmptyState
              icon={ClipboardList}
              title="No requests"
              description={f.status === 'PENDING,APPROVED' ? 'Nothing is waiting for approval or fulfilment.' : 'Nothing here for this filter.'}
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
      <RequestSheet
        id={openId ?? null}
        fromList={q.data?.items.find((r) => r.id === openId)}
        actions={(r) => actionsFor(r, 'sm')}
        onClose={() => set({ open: null }, { keepPage: true })}
      />
      <FulfilDialog request={fulfil} onClose={() => setFulfil(null)} />
    </div>
  );
}

function FulfilDialog({ request, onClose }: { request: AssetRequest | null; onClose: () => void }) {
  const cache = useAssetsCache();
  const [assetId, setAssetId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const save = useMutation({
    mutationFn: async () => {
      const res = await fulfilRequest(request!.id, assetId!);
      if (photos.length) {
        try {
          await uploadPhotos(assetId!, res.allocationId, 'HANDOVER', photos);
        } catch (err) {
          toast.error(`Fulfilled, but the photos did not upload: ${errorMessage(err)}`);
        }
      }
    },
    onSuccess: async () => {
      await cache.invalidateAssetData();
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

/** One request in a side panel: opened from a row or from a notification link (/assets/requests?open=<id>). */
function RequestSheet({ id, fromList, actions, onClose }: { id: string | null; fromList?: AssetRequest; actions: (r: AssetRequest) => React.ReactNode; onClose: () => void }) {
  const fetched = useRequest(fromList ? null : id);
  const r = fromList ?? fetched.data ?? undefined;
  const missing = !!id && !fromList && fetched.isFetched && !fetched.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>{r ? `${r.quantity > 1 ? `${r.quantity} × ` : ''}${r.typeName}` : 'Request'}</SheetTitle>
          <SheetDescription>{r ? `${r.number} · raised ${relativeTime(r.createdAt)}` : missing ? 'This request was not found, or you cannot see it.' : 'Loading…'}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {r && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <EnumBadge value={r.status} tones={REQUEST_TONE} />
                <EnumBadge value={r.priority} tones={PRIORITY_TONE} />
                {(r.status === 'PENDING' || r.status === 'APPROVED') && (
                  <span className={cn('text-xs', r.custom ? 'text-muted-foreground' : r.availableCount ? 'text-success' : 'text-destructive')}>{r.custom ? 'Not in catalog' : `${r.availableCount} in stock`}</span>
                )}
              </div>
              <DetailList
                items={[
                  { label: 'For', value: `${r.employeeName} (${r.employeeCode})` },
                  { label: 'Department', value: r.departmentName },
                  { label: 'Category', value: r.categoryName },
                  { label: 'Needed by', value: r.neededBy ? formatDate(r.neededBy) : null },
                  { label: 'Requested by', value: r.requestedByName },
                  { label: 'Reason', value: r.reason, full: true },
                  { label: 'Decided by', value: r.decidedByName ? `${r.decidedByName}${r.decidedAt ? ` · ${formatDate(r.decidedAt)}` : ''}` : null },
                  { label: 'Decision note', value: r.decisionNote, full: true },
                  {
                    label: 'Fulfilled with',
                    value: r.fulfilledAssetId ? (
                      <Link to={`/assets/assets/${r.fulfilledAssetId}`} className="font-mono text-primary hover:underline">
                        {r.fulfilledAssetTag ?? 'Open asset'}
                      </Link>
                    ) : null,
                  },
                ]}
              />
            </div>
          )}
        </SheetBody>
        {r && (
          <SheetFooter>
            <div className="flex flex-wrap justify-end gap-2">{actions(r)}</div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
