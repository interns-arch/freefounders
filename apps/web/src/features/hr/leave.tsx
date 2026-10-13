/** HR → My leave (balances, requests, apply / cancel) and Holidays. */
import { errorMessage, useAccess } from '@freefounders/core';
import { type LeaveRequest, type LeaveType, useAddHoliday, useApplyLeave, useCancelLeave, useDeleteHoliday, useHolidays, useLeaveBalances, useLeaveTypes, useMyLeaves } from '@freefounders/core/hr';
import { CalendarDays, CalendarHeart, Plus } from '@/components/icons';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Chip, ErrorNote, SectionHead, type Tone, fmtDay } from '../tasks/general/parts';
import { compressImage } from '@/lib/compress-image';
import { cn } from '@/lib/utils';

const LEAVE_TONE: Record<LeaveRequest['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

function LeaveStatusChip({ l }: { l: LeaveRequest }) {
  return <Chip tone={LEAVE_TONE[l.status] ?? 'neutral'}>{l.status_display}</Chip>;
}

export function MyLeaveTab() {
  const balances = useLeaveBalances();
  const leaves = useMyLeaves();
  const types = useLeaveTypes();
  const cancel = useCancelLeave();
  const [applying, setApplying] = useState(false);

  if (leaves.error) return <ErrorState error={leaves.error} onRetry={() => leaves.refetch()} />;
  if (!leaves.data) return <Skeleton className="h-64 max-w-4xl" />;
  const rows = leaves.data;

  return (
    <div className="max-w-4xl space-y-4">
      <SectionHead
        actions={
          <Button variant="cta" onClick={() => setApplying(true)} disabled={!types.data}>
            <Plus /> Apply for leave
          </Button>
        }
      >
        Balances
      </SectionHead>
      {balances.data?.length === 0 && <p className="text-sm text-muted-foreground">No leave types configured yet — an admin can add them in HR Settings.</p>}
      {!balances.data && balances.isPending && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {balances.data?.map((b) => {
          const pct = b.quota > 0 ? Math.max(0, Math.min(100, (100 * b.balance) / b.quota)) : 0;
          const low = b.quota > 0 && pct <= 25;
          return (
            <Card key={b.leave_type} className={cn('relative overflow-hidden p-4', low && 'border-warning/40')}>
              <p className="relative flex items-center gap-1.5 truncate font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase" title={b.name}>
                <CalendarHeart className={cn('size-3.5 shrink-0', low ? 'text-warning' : 'text-primary')} />
                <span className="truncate">{b.name}</span>
              </p>
              <p className="relative mt-1.5 font-mono text-[25px] leading-tight font-bold tracking-tight tabular-nums">
                {b.balance}
                <span className="text-sm font-medium text-muted-foreground"> / {b.quota}</span>
              </p>
              <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn('h-full rounded-full', low ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
              </div>
              <div className="relative mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>{b.paid ? 'paid' : 'unpaid'}</span>
                {b.pending > 0 && <Chip tone="warning">{b.pending} pending</Chip>}
              </div>
            </Card>
          );
        })}
      </div>
      <SectionHead>Requests</SectionHead>
      {cancel.error && <ErrorNote>{errorMessage(cancel.error)}</ErrorNote>}
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title="No leave requests yet" description="Apply above; approved and pending requests show here." className="py-10" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Dates</TH>
                <TH>Days</TH>
                <TH>Status</TH>
                <TH>Remarks</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <strong>{l.leave_type_name}</strong>
                    <div className="text-xs text-muted-foreground">{l.reason}</div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {fmtDay(l.start_date)} – {fmtDay(l.end_date)}
                  </TD>
                  <TD>{l.days}</TD>
                  <TD>
                    <LeaveStatusChip l={l} />
                  </TD>
                  <TD className="text-xs">
                    {l.remarks || '—'}
                    {l.reviewed_by_detail && <div className="text-muted-foreground">by {l.reviewed_by_detail.name}</div>}
                  </TD>
                  <TD className="text-right">
                    {['pending', 'approved'].includes(l.status) && (
                      <Button size="xs" variant="outline" aria-label={`Cancel ${l.leave_type_name} ${fmtDay(l.start_date)}`} onClick={() => cancel.mutate(l.id)}>
                        Cancel
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Dialog open={applying} onOpenChange={setApplying}>
        <DialogContent className="max-w-lg">{applying && types.data && <ApplyForm types={types.data} onClose={() => setApplying(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function ApplyForm({ types, onClose }: { types: LeaveType[]; onClose: () => void }) {
  const [f, setF] = useState({ leave_type: String(types[0]?.id ?? ''), start_date: '', end_date: '', reason: '' });
  const [doc, setDoc] = useState<File | null>(null);
  const apply = useApplyLeave();
  const selected = types.find((t) => String(t.id) === f.leave_type);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    apply.mutate({ ...f, ...(doc ? { document: doc } : {}) }, { onSuccess: onClose });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Apply for leave</DialogTitle>
        <DialogDescription>Pick the type and dates; your approver is notified at once.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="lv-type">Leave type *</Label>
        <NativeSelect id="lv-type" value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.annual_quota}/yr)
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="lv-from">From *</Label>
          <Input id="lv-from" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lv-to">To *</Label>
          <Input id="lv-to" type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="lv-reason">Reason *</Label>
        <Input id="lv-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
      {selected?.requires_document && (
        <div className="grid gap-1.5">
          <Label htmlFor="lv-doc">Supporting document * ({selected.name})</Label>
          <Input
            id="lv-doc"
            type="file"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setDoc(picked);
              // A photo of the document goes up smaller (PLAN.md §19.20); swapped in when ready.
              if (picked) void compressImage(picked, 'document').then((small) => setDoc((cur) => (cur === picked ? small : cur)));
            }}
          />
        </div>
      )}
      {apply.error && <ErrorNote>{errorMessage(apply.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.leave_type || !f.start_date || !f.end_date || !f.reason.trim()} loading={apply.isPending}>
          Submit request
        </Button>
      </DialogFooter>
    </form>
  );
}

export function HolidaysTab() {
  const access = useAccess();
  const canManage = access.tasks.can('holidays.manage');
  const q = useHolidays();
  const add = useAddHoliday();
  const del = useDeleteHoliday();
  const [f, setF] = useState({ name: '', date: '' });
  const error = add.error ?? del.error;

  return (
    <div className="max-w-2xl space-y-4">
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(f, { onSuccess: () => setF({ name: '', date: '' }) });
          }}
        >
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor="hol-name">Holiday name</Label>
            <Input id="hol-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hol-date">Date</Label>
            <Input id="hol-date" type="date" className="w-auto" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <Button type="submit" disabled={!f.name.trim() || !f.date} loading={add.isPending}>
            Add holiday
          </Button>
        </form>
      )}
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-32" />}
      {q.data?.length === 0 && (
        <Card>
          <EmptyState icon={CalendarDays} title="No holidays configured" description={canManage ? 'Add the company holidays above; they count as paid days off.' : 'The company holidays appear here once added.'} />
        </Card>
      )}
      {q.data && q.data.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Holiday</TH>
                <TH>Date</TH>
                {canManage && <TH />}
              </TR>
            </THead>
            <TBody>
              {q.data.map((h) => (
                <TR key={h.id}>
                  <TD className="font-medium">
                    <span className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                        <CalendarHeart className="size-4" />
                      </span>
                      {h.name}
                    </span>
                  </TD>
                  <TD className="font-mono text-[13px]">{new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</TD>
                  {canManage && (
                    <TD className="text-right">
                      <Button size="xs" variant="outline" aria-label={`Delete ${h.name}`} onClick={() => del.mutate(h.id)}>
                        Delete
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
