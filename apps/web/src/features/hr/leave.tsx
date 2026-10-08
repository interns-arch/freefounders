/** HR → My leave (balances, requests, apply / cancel) and Holidays. */
import { errorMessage, useAccess } from '@freefounders/core';
import { type LeaveRequest, type LeaveType, useAddHoliday, useApplyLeave, useCancelLeave, useDeleteHoliday, useHolidays, useLeaveBalances, useLeaveTypes, useMyLeaves } from '@freefounders/core/hr';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Chip, ErrorNote, Tile, type Tone, fmtDay } from '../tasks/general/parts';

const LEAVE_TONE: Record<LeaveRequest['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

export function LeaveStatusChip({ l }: { l: LeaveRequest }) {
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
      <Button onClick={() => setApplying(true)} disabled={!types.data}>
        <Plus /> Apply for leave
      </Button>
      {balances.data?.length === 0 && <p className="text-sm text-muted-foreground">No leave types configured yet — an admin can add them in HR Settings.</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {balances.data?.map((b) => (
          <Tile
            key={b.leave_type}
            label={`${b.name}${b.paid ? '' : ' (unpaid)'}`}
            value={
              <>
                {b.balance}
                <span className="text-sm font-normal text-muted-foreground"> / {b.quota}</span>
              </>
            }
            sub={b.pending > 0 ? `${b.pending} pending` : undefined}
          />
        ))}
      </div>
      {cancel.error && <ErrorNote>{errorMessage(cancel.error)}</ErrorNote>}
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title="No leave requests yet" />
        </Card>
      ) : (
        <Card>
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
          <Input id="lv-doc" type="file" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
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
  const canManage = access.tasks.can('settings.manage');
  const q = useHolidays();
  const add = useAddHoliday();
  const del = useDeleteHoliday();
  const [f, setF] = useState({ name: '', date: '' });
  const error = add.error ?? del.error;

  return (
    <div className="max-w-2xl space-y-4">
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-2"
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
          <EmptyState icon={CalendarDays} title="No holidays configured" />
        </Card>
      )}
      {q.data && q.data.length > 0 && (
        <Card>
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
                  <TD className="font-medium">{h.name}</TD>
                  <TD>{new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</TD>
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
