import { humanize, PRIORITIES, TICKET_STATUSES, type TicketStatus } from '@eam/shared';
import { LifeBuoy, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EnumBadge } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { DetailList, EmptyState, PageHeader } from '@/components/common/page';
import { Timeline } from '@/features/assets/components/timeline';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { errorMessage } from '@freefounders/core';
import { useAuth } from '@/features/assets/lib/auth';
import { useAssetsCache, useStaffDirectory, useTicket, useTickets, useUpdateTicket } from '@freefounders/core/assets';
import { PRIORITY_TONE, TICKET_TONE } from '@/lib/status';
import type { Ticket } from '@freefounders/core/assets';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';

const TABS = [
  { value: 'OPEN,IN_PROGRESS', label: 'Open' },
  { value: 'RESOLVED,CLOSED', label: 'Resolved' },
  { value: '', label: 'All' },
];

export default function TicketsPage() {
  const { can } = useAuth();
  const quickAdd = useQuickAdd();
  const { values: f, set } = useUrlFilters({ status: 'OPEN,IN_PROGRESS', page: '1', pageSize: '25' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useTickets(f);

  const columns: Column<Ticket>[] = [
    {
      key: 'title',
      header: 'Ticket',
      cell: (t) => (
        <div className="min-w-56">
          <div className="font-medium">{t.title}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{t.number}</span> · {humanize(t.type)}
            {t.assetTag ? ` · ${t.assetTag}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', cell: (t) => <EnumBadge value={t.priority} tones={PRIORITY_TONE} dot={false} /> },
    { key: 'status', header: 'Status', cell: (t) => <EnumBadge value={t.status} tones={TICKET_TONE} /> },
    { key: 'reporter', header: 'Reported by', hideOnMobile: true, cell: (t) => <span className="whitespace-nowrap">{t.reportedByName ?? '—'}</span> },
    { key: 'assignee', header: 'Assignee', hideOnMobile: true, cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{t.assigneeName ?? 'Unassigned'}</span> },
    { key: 'created', header: 'Raised', hideOnMobile: true, cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(t.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Tickets"
        description="Issues, damage, loss and repair requests raised against assets."
        actions={
          can('ticket:create') && (
            <Button size="sm" onClick={() => quickAdd.open('ticket')}>
              <Plus /> Raise ticket
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1">
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
        <NativeSelect className="ml-auto h-8 w-auto text-[13px]" value={f.priority ?? ''} onChange={(e) => set({ priority: e.target.value })}>
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…" className="pl-8" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.items}
          rowKey={(t) => t.id}
          loading={q.isLoading}
          fetching={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(t) => set({ open: t.id }, { keepPage: true })}
          keyboard
          empty={<EmptyState icon={LifeBuoy} title="No tickets" description="All quiet." />}
        />
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
      <TicketSheet id={f.open ?? null} onClose={() => set({ open: null }, { keepPage: true })} />
    </div>
  );
}

function TicketSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const manage = can('ticket:manage');
  const cache = useAssetsCache();
  const q = useTicket(id);
  const staff = useStaffDirectory(manage && !!id);
  const [status, setStatus] = useState<TicketStatus>('OPEN');
  const [assigneeId, setAssigneeId] = useState('');
  const [resolution, setResolution] = useState('');
  useEffect(() => {
    if (q.data) {
      setStatus(q.data.status);
      setAssigneeId(q.data.assigneeId ?? '');
      setResolution(q.data.resolution ?? '');
    }
  }, [q.data]);
  const save = useUpdateTicket({
    onSuccess: async () => {
      await cache.invalidate('tickets', ['ticket', id], 'dashboard');
      toast.success('Ticket updated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const t = q.data;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>{t ? t.title : 'Ticket'}</SheetTitle>
          <SheetDescription>{t ? `${t.number} · raised ${relativeTime(t.createdAt)} by ${t.reportedByName ?? '—'}` : ' '}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {!t ? (
            <Skeleton className="h-48" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <EnumBadge value={t.status} tones={TICKET_TONE} />
                <EnumBadge value={t.priority} tones={PRIORITY_TONE} dot={false} />
                <EnumBadge value={t.type} tones={{ ISSUE: 'blue', DAMAGE: 'orange', LOSS: 'red', REPAIR: 'amber', OTHER: 'gray' }} dot={false} />
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: 'Details', value: t.description },
                  { label: 'Asset', value: t.assetId ? <Link className="text-primary hover:underline" to={`/assets/assets/${t.assetId}`}>{t.assetTag} · {t.assetName}</Link> : null },
                  { label: 'Assignee', value: t.assigneeName },
                  // FreeFounders: the Tasks task working on this ticket (a full page link: it is another app).
                  ...(t.linkedTask ? [{ label: 'Task', value: <a className="text-primary hover:underline" href={t.linkedTask.url}>{t.linkedTask.ref} in Tasks</a> }] : []),
                  ...(t.resolvedAt ? [{ label: 'Resolved', value: formatDateTime(t.resolvedAt) }] : []),
                ]}
              />
              {manage && (
                <div className="grid gap-4 rounded-lg border p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status" htmlFor="ticket-status">
                      <NativeSelect id="ticket-status" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
                        {TICKET_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {humanize(s)}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Assignee" htmlFor="ticket-assignee">
                      <NativeSelect id="ticket-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                        <option value="">Unassigned</option>
                        {(staff.data ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                  <Field label="Resolution notes" htmlFor="ticket-resolution">
                    <Textarea id="ticket-resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
                  </Field>
                </div>
              )}
              <div>
                <p className="mb-3 text-sm font-semibold">History</p>
                <Timeline events={t.history} />
              </div>
            </>
          )}
        </SheetBody>
        {manage && t && (
          <SheetFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button loading={save.isPending} onClick={() => id && save.mutate({ id, body: { status, assigneeId: assigneeId || null, resolution } })}>
              Save
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
