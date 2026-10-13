import { humanize, PRIORITIES, TICKET_STATUSES, type TicketStatus } from '@eam/shared';
import { SearchField } from '@/components/common/search-field';
import { AlertTriangle, HelpCircle, LifeBuoy, Plus, SearchX, Wrench } from '@/components/icons';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EnumBadge } from '@/components/common/badges';
import { type Column, DataTable, Pagination } from '@/components/common/data-table';
import { Field } from '@/components/common/form';
import { DetailList, EmptyState, PageHeader } from '@/components/common/page';
import { Timeline } from '@/features/assets/components/timeline';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
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
import { safeHref } from '@/lib/safe-url';

const TYPE_ICON: Record<string, { icon: typeof LifeBuoy; tone: string }> = {
  ISSUE: { icon: LifeBuoy, tone: 'bg-info/10 text-info dark:bg-info/16' },
  DAMAGE: { icon: AlertTriangle, tone: 'bg-app-admin/10 text-app-admin dark:bg-app-admin/16' },
  LOSS: { icon: SearchX, tone: 'bg-destructive/10 text-destructive dark:bg-destructive/16' },
  REPAIR: { icon: Wrench, tone: 'bg-warning/10 text-warning dark:bg-warning/16' },
  OTHER: { icon: HelpCircle, tone: 'bg-muted text-muted-foreground' },
};
const PRIORITY_BAR: Record<string, string> = { URGENT: 'bg-destructive', HIGH: 'bg-warning', MEDIUM: 'bg-info', LOW: 'bg-border' };

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
      cell: (t) => {
        const k = TYPE_ICON[t.type] ?? TYPE_ICON.OTHER;
        return (
          <div className="flex min-w-56 items-center gap-3">
            <span className={cn('w-1 self-stretch rounded-full', PRIORITY_BAR[t.priority] ?? 'bg-border')} aria-hidden />
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', k.tone)}>
              <k.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">{t.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{t.number}</span> · {humanize(t.type)}
                {t.assetTag ? ` · ${t.assetTag}` : ''}
              </div>
            </div>
          </div>
        );
      },
    },
    { key: 'priority', header: 'Priority', cell: (t) => <EnumBadge value={t.priority} tones={PRIORITY_TONE} /> },
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
            <Button variant="cta" size="sm" onClick={() => quickAdd.open('ticket')}>
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
              'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] max-sm:min-h-10 font-medium transition',
              (f.status === 'ALL' ? '' : f.status) === t.value ? 'border-primary/30 bg-primary/8 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
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
          <SearchField className="relative max-w-md" label="Search tickets" placeholder="Search tickets…" value={search} onChange={setSearch} />
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
          empty={<EmptyState icon={LifeBuoy} title="No tickets" description={f.status === 'OPEN,IN_PROGRESS' ? 'All quiet — nothing is broken, lost or waiting for repair.' : 'Nothing here for this filter.'} />}
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
                <EnumBadge value={t.priority} tones={PRIORITY_TONE} />
                <EnumBadge value={t.type} tones={{ ISSUE: 'blue', DAMAGE: 'orange', LOSS: 'red', REPAIR: 'amber', OTHER: 'gray' }} />
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: 'Details', value: t.description },
                  { label: 'Asset', value: t.assetId ? <Link className="text-primary hover:underline" to={`/assets/assets/${t.assetId}`}>{t.assetTag} · {t.assetName}</Link> : null },
                  { label: 'Assignee', value: t.assigneeName },
                  // FreeFounders: the Tasks task working on this ticket (a full page link: it is another app).
                  ...(t.linkedTask ? [{ label: 'Task', value: <a className="text-primary hover:underline" href={safeHref(t.linkedTask.url)}>{t.linkedTask.ref} in Tasks</a> }] : []),
                  ...(t.resolvedAt ? [{ label: 'Resolved', value: formatDateTime(t.resolvedAt) }] : []),
                ]}
              />
              {manage && (
                <div className="grid gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="font-mono text-[11px] font-medium tracking-wider text-primary uppercase">Update ticket</p>
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
                <p className="mb-3 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">History</p>
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
