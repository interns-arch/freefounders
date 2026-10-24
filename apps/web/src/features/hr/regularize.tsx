/**
 * Attendance regularization (PLAN.md §19.38): the request form (My attendance → tap a day → Regularize, or Today →
 * Regularize a day) and the "Regularized" tag. The form starts from what was recorded and a likely reason, so on a
 * phone it is tap the day, Regularize, Send. The server checks the company's policy (reasons, monthly limit, how far
 * back, today only after the shift) and answers with a message the person can act on.
 */
import { errorMessage } from '@freefounders/core';
import {
  type AttendanceDay,
  REGULARIZATION_PERIOD_WORDS,
  REGULARIZATION_REASONS,
  type RegularizationReason,
  SHIFT_REASONS,
  useAddRegularization,
  useHrConfig,
  useRegularizablePeople,
  useRegularizationPolicy,
  useRequestRegularization,
} from '@freefounders/core/hr';
import { Paperclip, UserCheck } from '@/components/icons';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox, Skeleton } from '@/components/ui/primitives';
import { compressImage } from '@/lib/compress-image';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, fmtDay, fmtTime, todayLocal } from '../tasks/general/parts';
import { AttendanceChip } from './parts';

/** The "Regularized" tag of a day: rectangular, theme colours; On duty / WFH after it. The reason is its title. */
export function RegularizedTag({ reason, mode, short, className }: { reason?: string; mode?: string; short?: boolean; className?: string }) {
  return (
    <Chip tone="primary" className={className} title={reason ? `Regularized: ${reason}` : 'Regularized'} aria-label={reason ? `Regularized: ${reason}` : 'Regularized'}>
      {short ? 'R' : 'Regularized'}
      {!short && mode ? ` · ${mode}` : ''}
    </Chip>
  );
}

const hhmm = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A likely reason from what was recorded: no check-out → forgot to punch out; nothing → forgot to punch in. */
function guessReason(day: AttendanceDay | null | undefined, allowed: RegularizationReason[]): RegularizationReason {
  const guess: RegularizationReason = day?.check_in && !day.check_out ? 'forgot_out' : !day?.check_in ? 'forgot_in' : 'late_work';
  return allowed.includes(guess) ? guess : (allowed[0] ?? 'other');
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The request form in a dialog. `day` (from My attendance) fills the date, the recorded times and a likely reason. */
export function RegularizeDialog({ open, onClose, day, date, onSent }: { open: boolean; onClose: () => void; day?: AttendanceDay | null; date?: string; onSent: (message: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">{open && <RegularizeForm day={day} date={date} onClose={onClose} onSent={onSent} />}</DialogContent>
    </Dialog>
  );
}

function RegularizeForm({ day, date: askedDate, onClose, onSent }: { day?: AttendanceDay | null; date?: string; onClose: () => void; onSent: (message: string) => void }) {
  const policy = useRegularizationPolicy();
  const save = useRequestRegularization();
  const p = policy.data;
  if (policy.error) return <ErrorNote>{errorMessage(policy.error)}</ErrorNote>;
  if (!p) return <Skeleton className="h-72" />;
  return <Form key={p.work_start} day={day} askedDate={askedDate} onClose={onClose} onSent={onSent} p={p} save={save} />;
}

function Form({
  day,
  askedDate,
  onClose,
  onSent,
  p,
  save,
}: {
  day?: AttendanceDay | null;
  askedDate?: string;
  onClose: () => void;
  onSent: (message: string) => void;
  p: NonNullable<ReturnType<typeof useRegularizationPolicy>['data']>;
  save: ReturnType<typeof useRequestRegularization>;
}) {
  const today = todayLocal();
  const latest = p.shift_ended ? today : addDays(today, -1);
  const allowed = p.reasons.map((r) => r.value);
  const [date, setDate] = useState(day?.date ?? askedDate ?? latest);
  const [several, setSeveral] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState<RegularizationReason>(() => guessReason(day, allowed));
  const [inTime, setInTime] = useState(hhmm(day?.check_in) || p.work_start);
  const [outTime, setOutTime] = useState(hhmm(day?.check_out) || p.work_end);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const shift = SHIFT_REASONS.includes(reason);
  const pendingHere = day?.date === date && day?.request?.status === 'pending';
  const limit = p.limit ?? p.monthly_limit;
  const left = p.left !== undefined ? p.left : p.left_this_month;
  const words = REGULARIZATION_PERIOD_WORDS[p.period ?? 'month'];
  const noneLeft = left === 0;
  const blocked = !p.enabled || noneLeft || pendingHere || !allowed.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        date,
        end_date: several && endDate && endDate !== date ? endDate : undefined,
        reason_type: reason,
        check_in_time: inTime || undefined,
        check_out_time: outTime || undefined,
        reason: note.trim() || undefined,
        attachment: file ?? undefined,
      },
      {
        onSuccess: (res) => {
          const rows = 'results' in res ? res.results : [res];
          const when = rows.length > 1 ? `${fmtDay(rows[0].date)} – ${fmtDay(rows[rows.length - 1].date)}` : fmtDay(rows[0].date);
          onSent(rows[0].status === 'approved' ? `Regularization for ${when} approved.` : `Regularization for ${when} sent for approval.`);
        },
      },
    );
  };

  const limitText = limit
    ? `${left} of ${limit} request${limit === 1 ? '' : 's'} left ${words.this}${p.personal_limit ? ' (your own limit)' : ''}`
    : 'No limit';
  const backText = p.days_back > 0 ? `up to ${p.days_back} day${p.days_back === 1 ? '' : 's'} back` : 'today only, after the shift';
  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="Regularize attendance">
      <DialogHeader>
        <DialogTitle>Regularize attendance</DialogTitle>
        <DialogDescription>
          {limitText} · {backText}. Your approver decides.
        </DialogDescription>
      </DialogHeader>
      {!p.enabled && <ErrorNote>Regularization is switched off for your company.</ErrorNote>}
      {p.enabled && noneLeft && <ErrorNote>You have used all {limit} regularization requests for {words.this}.</ErrorNote>}
      {day && day.date === date && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-label="Recorded for this day">
          <span className="text-muted-foreground">Recorded</span>
          <span className="font-mono tabular-nums">in {fmtTime(day.check_in)}</span>
          <span className="font-mono tabular-nums">out {fmtTime(day.check_out)}</span>
          {day.status && <AttendanceChip status={day.status} />}
          {day.regularized && <RegularizedTag reason={day.regularization_reason} mode={day.work_mode} />}
          {day.request && (
            <Chip tone={day.request.status === 'pending' ? 'warning' : day.request.status === 'approved' ? 'success' : 'danger'}>
              Request {day.request.status}
            </Chip>
          )}
        </div>
      )}
      {pendingHere && <p className="text-sm text-muted-foreground">A request for this day is waiting for approval.</p>}

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Reason</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {p.reasons.map((r) => (
            <label
              key={r.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center rounded-md border bg-card px-2.5 py-1.5 text-[13px] leading-tight font-medium transition outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 hover:border-primary/40',
                reason === r.value && 'border-primary bg-primary/8 text-primary',
              )}
            >
              <input type="radio" name="reg-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="sr-only" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="reg-date">{several ? 'From' : 'Day'}</Label>
          <Input id="reg-date" type="date" min={p.earliest} max={latest} value={date} required onChange={(e) => setDate(e.target.value)} />
        </div>
        {several ? (
          <div className="grid gap-1.5">
            <Label htmlFor="reg-end">To</Label>
            <Input id="reg-end" type="date" min={date} max={latest} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <label htmlFor="reg-several" className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox id="reg-several" checked={several} onCheckedChange={(v) => setSeveral(v === true)} /> Several days
          </label>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="reg-in">Check-in</Label>
          <Input id="reg-in" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reg-out">Check-out</Label>
          <Input id="reg-out" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </div>
      </div>
      {shift && <p className="-mt-2 text-xs text-muted-foreground">Leave the times empty to use the shift ({p.work_start}–{p.work_end}).</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="reg-note">Note{reason === 'other' ? ' *' : ' (optional)'}</Label>
        <Textarea id="reg-note" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="What happened" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="reg-file" className="inline-flex items-center gap-1.5">
          <Paperclip className="size-3.5" /> Photo or document (optional)
        </Label>
        <Input
          id="reg-file"
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            // A photo goes up smaller (PLAN.md §19.20); swapped in when ready.
            if (picked) void compressImage(picked, 'document').then((small) => setFile((cur) => (cur === picked ? small : cur)));
          }}
        />
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={blocked || (reason === 'other' && !note.trim()) || (!shift && !inTime && !outTime)} loading={save.isPending}>
          Send request
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * "Regularize for someone" (PLAN.md §19.38 addendum, 2026-10-24): HR / Admin / Owner (within their approving scope) and
 * reporting managers (for their reports) regularize days for a person directly. Applied at once (approved by them, the
 * day worked out again like an approval), not counted in the person's limit, any past day (never a future one); the
 * person is told. Nobody for themselves, except the Owner (the server decides). Shown only to people who decide
 * regularizations.
 */
export function RegularizeForSomeoneButton({
  userId,
  date,
  variant = 'outline',
  size,
  className,
  label = 'Regularize for someone',
  ariaLabel,
}: {
  userId?: number;
  date?: string;
  variant?: 'outline' | 'default' | 'ghost';
  size?: 'xs' | 'sm' | 'default';
  className?: string;
  /** Shorter text in a table row ("Regularize"). */
  label?: string;
  ariaLabel?: string;
}) {
  const cfg = useHrConfig();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  if (!cfg.data?.can_approve_regularization) return null;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        aria-label={ariaLabel}
        onClick={() => {
          setDone('');
          setOpen(true);
        }}
      >
        {size !== 'xs' && <UserCheck />} {label}
      </Button>
      {done && (
        <span className="text-sm text-success" role="status">
          {done}
        </span>
      )}
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          {open && (
            <AddForm
              userId={userId}
              date={date}
              onClose={() => setOpen(false)}
              onDone={(m) => {
                setDone(m);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddForm({ userId, date: askedDate, onClose, onDone }: { userId?: number; date?: string; onClose: () => void; onDone: (message: string) => void }) {
  const people = useRegularizablePeople();
  const cfg = useHrConfig();
  const add = useAddRegularization();
  const today = todayLocal();
  const workStart = cfg.data?.work_start ?? '09:30';
  const workEnd = cfg.data?.work_end ?? '18:30';
  const [user, setUser] = useState(userId ? String(userId) : '');
  const [date, setDate] = useState(askedDate && askedDate <= today ? askedDate : addDays(today, -1));
  const [several, setSeveral] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState<RegularizationReason>('forgot_in');
  const [inTime, setInTime] = useState(workStart);
  const [outTime, setOutTime] = useState(workEnd);
  const [note, setNote] = useState('');
  const shift = SHIFT_REASONS.includes(reason);
  const person = people.data?.find((p) => String(p.id) === user);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate(
      {
        user: Number(user),
        date,
        end_date: several && endDate && endDate !== date ? endDate : undefined,
        reason_type: reason,
        check_in_time: inTime || undefined,
        check_out_time: outTime || undefined,
        reason: note.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          const rows = 'results' in res ? res.results : [res];
          const when = rows.length > 1 ? `${fmtDay(rows[0].date)} – ${fmtDay(rows[rows.length - 1].date)}` : fmtDay(rows[0].date);
          onDone(`Regularized for ${person?.name ?? rows[0].user_detail?.name ?? 'them'}: ${when}.`);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="Regularize for someone">
      <DialogHeader>
        <DialogTitle>Regularize for someone</DialogTitle>
        <DialogDescription>Applied at once and recorded as added by you. It does not count in the person’s limit; any past day. They are told.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="rfs-person">Person</Label>
        <NativeSelect id="rfs-person" value={user} required onChange={(e) => setUser(e.target.value)}>
          <option value="">{people.isLoading ? 'Loading…' : 'Pick a person'}</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.department ? ` · ${p.department}` : ''}
            </option>
          ))}
        </NativeSelect>
        {people.data && people.data.length === 0 && <p className="text-xs text-muted-foreground">Nobody you can regularize for.</p>}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Reason</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {REGULARIZATION_REASONS.map((r) => (
            <label
              key={r.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center rounded-md border bg-card px-2.5 py-1.5 text-[13px] leading-tight font-medium transition outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 hover:border-primary/40',
                reason === r.value && 'border-primary bg-primary/8 text-primary',
              )}
            >
              <input type="radio" name="rfs-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="sr-only" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rfs-date">{several ? 'From' : 'Day'}</Label>
          <Input id="rfs-date" type="date" max={today} value={date} required onChange={(e) => setDate(e.target.value)} />
        </div>
        {several ? (
          <div className="grid gap-1.5">
            <Label htmlFor="rfs-end">To</Label>
            <Input id="rfs-end" type="date" min={date} max={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <label htmlFor="rfs-several" className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox id="rfs-several" checked={several} onCheckedChange={(v) => setSeveral(v === true)} /> Several days
          </label>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="rfs-in">Check-in</Label>
          <Input id="rfs-in" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rfs-out">Check-out</Label>
          <Input id="rfs-out" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </div>
      </div>
      {shift && <p className="-mt-2 text-xs text-muted-foreground">Leave the times empty to use the shift ({workStart}–{workEnd}).</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="rfs-note">Note{reason === 'other' ? ' *' : ' (optional)'}</Label>
        <Textarea id="rfs-note" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why" />
      </div>
      {add.error && <ErrorNote>{errorMessage(add.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!user || (reason === 'other' && !note.trim()) || (!shift && !inTime && !outTime)} loading={add.isPending}>
          Regularize now
        </Button>
      </DialogFooter>
    </form>
  );
}
