/**
 * HR marks leave for someone (PLAN.md §19.40): person, type, dates, half day, reason. Approved at once (attendance
 * updated, the person notified); beyond the person's balance only with "Beyond balance", which is logged on the leave.
 * Shown to people with Approve leave; the list holds only whom they approve for (themself only as the Owner).
 */
import { errorMessage, useAccess } from '@kaampilot/core';
import { type LeaveBalance, type LeaveType, useApplyLeave, useLeaveBalances, useLeaveTypes, useMarkablePeople } from '@kaampilot/core/hr';
import { CalendarCheck } from '@/components/icons';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { ErrorNote } from '../tasks/general/parts';

/** "Mark leave" button + dialog; renders nothing without Approve leave. */
export function MarkLeaveButton({ variant = 'outline' }: { variant?: 'outline' | 'default' }) {
  const access = useAccess();
  const allowed = access.tasks.canAny('hr.approve');
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <CalendarCheck /> Mark leave
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">{open && <MarkLeaveForm onClose={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function leftText(b: LeaveBalance | undefined, t: LeaveType): string {
  if (b?.limited === false) return 'no limit';
  const left = b?.available ?? b?.balance;
  if (left == null) return `${t.annual_quota}/yr`;
  return `${left} day${left === 1 ? '' : 's'} left`;
}

function MarkLeaveForm({ onClose }: { onClose: () => void }) {
  const people = useMarkablePeople();
  const types = useLeaveTypes();
  const [person, setPerson] = useState('');
  const [f, setF] = useState({ leave_type: '', start_date: '', end_date: '', reason: '' });
  const [halfDay, setHalfDay] = useState(false);
  const [beyond, setBeyond] = useState(false);
  const balances = useLeaveBalances(person ? Number(person) : undefined, !!person);
  const mark = useApplyLeave();
  const activeTypes = (types.data ?? []).filter((t) => t.active !== false);
  const leaveType = f.leave_type || String(activeTypes[0]?.id ?? '');
  const selected = activeTypes.find((t) => String(t.id) === leaveType);
  const balance = balances.data?.find((b) => String(b.leave_type) === leaveType);
  const oneDay = !!f.start_date && f.start_date === f.end_date;
  const needsOverride = !!(mark.error && (mark.error as { data?: { beyond_balance_needed?: boolean } }).data?.beyond_balance_needed);
  const who = people.data?.find((p) => String(p.id) === person);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mark.mutate(
      { ...f, leave_type: leaveType, user: Number(person), ...(oneDay && halfDay ? { half_day: true } : {}), ...(beyond ? { beyond_balance: true } : {}) },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="Mark leave">
      <DialogHeader>
        <DialogTitle>Mark leave</DialogTitle>
        <DialogDescription>Approved at once; the employee is notified and their attendance shows the leave.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="ml-person">Employee *</Label>
        <NativeSelect id="ml-person" value={person} onChange={(e) => setPerson(e.target.value)} disabled={!people.data}>
          <option value="">{people.data ? (people.data.length ? 'Choose a person' : 'Nobody you approve leave for') : 'Loading…'}</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.employee_id ? ` (${p.employee_id})` : ''}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ml-type">Leave type *</Label>
        <NativeSelect id="ml-type" value={leaveType} onChange={(e) => setF({ ...f, leave_type: e.target.value })}>
          {activeTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {person ? ` (${leftText(balances.data?.find((b) => b.leave_type === t.id), t)})` : ''}
            </option>
          ))}
        </NativeSelect>
        {selected && who && balance && (
          <p className="text-xs text-muted-foreground">
            {balance.limited === false ? `${selected.name} has no limit.` : `${who.name}: ${leftText(balance, selected)} this year.`}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ml-from">From *</Label>
          <Input id="ml-from" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date || e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ml-to">To *</Label>
          <Input id="ml-to" type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </div>
      </div>
      {oneDay && (
        <label htmlFor="ml-half" className="flex items-center gap-2 text-sm">
          <Checkbox id="ml-half" checked={halfDay} onCheckedChange={(v) => setHalfDay(v === true)} />
          Half day (counts 0.5)
        </label>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="ml-reason">Reason *</Label>
        <Input id="ml-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
      {mark.error && <ErrorNote>{errorMessage(mark.error)}</ErrorNote>}
      {(needsOverride || beyond) && (
        <label htmlFor="ml-beyond" className="flex items-center gap-2 text-sm">
          <Checkbox id="ml-beyond" checked={beyond} onCheckedChange={(v) => setBeyond(v === true)} />
          Beyond balance (logged on the leave)
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!person || !leaveType || !f.start_date || !f.end_date || !f.reason.trim()} loading={mark.isPending}>
          Mark leave
        </Button>
      </DialogFooter>
    </form>
  );
}
