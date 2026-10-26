/**
 * Pre-invites (PLAN.md §22.9, visitors.invite): an employee expects one visitor or a group (a meeting, interviews).
 * Each gets a pass with a QR by WhatsApp / email; at the gate the guard scans it, takes the photo and they are in.
 * Gate and admin people can invite on someone else's behalf.
 */
import { ApiError, errorMessage } from '@freefounders/core';
import { type InviteVisitorRow, type PersonBrief, type Visit, type VisitorConfig, useInviteVisitors } from '@freefounders/core/visitors';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Plus, Trash2 } from '@/components/icons';
import { FormSheet } from '@/components/common/form-sheet';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { HostPicker, copyText, passSentNote, passUrl } from './parts';

const blankRow = (): InviteVisitorRow => ({ name: '', mobile: '', email: '', company: '' });

export function InviteSheet({ config, onClose }: { config: VisitorConfig; onClose: () => void }) {
  const onBehalf = config.can.gate || config.can.view_all;
  const [rows, setRows] = useState<InviteVisitorRow[]>([blankRow()]);
  const [f, setF] = useState({ date: todayISO(), time_from: '', time_to: '', purpose: '', location: '' as number | '', people: 1, notes: '', send: true });
  const [host, setHost] = useState<PersonBrief | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Visit[] | null>(null);
  const invite = useInviteVisitors();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setRow = (i: number, k: keyof InviteVisitorRow, v: string) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!r.name.trim()) local[`visitors.${i}.name`] = "Enter the visitor's name.";
      const digits = (r.mobile ?? '').replace(/\D/g, '');
      if (!digits && !r.email?.trim()) local[`visitors.${i}.mobile`] = 'A mobile number (or email) to send the pass to.';
      else if (digits && digits.length < 10) local[`visitors.${i}.mobile`] = 'Enter the 10-digit mobile number.';
    });
    if (!f.date) local.date = 'Pick the day.';
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const out = await invite.mutateAsync({
        visitors: rows.map((r) => ({ name: r.name.trim(), mobile: r.mobile?.trim(), email: r.email?.trim(), company: r.company?.trim() })),
        date: f.date,
        time_from: f.time_from || undefined,
        time_to: f.time_to || undefined,
        purpose: f.purpose || undefined,
        location: f.location || null,
        people: rows.length === 1 ? f.people : 1,
        notes: f.notes || undefined,
        host: host?.id ?? null,
        send: f.send,
      });
      toast.success(out.length === 1 ? `${out[0].name} invited · pass ${out[0].pass_no}` : `${out.length} visitors invited`);
      setDone(out);
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };

  if (done) return <InvitedDialog visits={done} onClose={onClose} />;

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite a visitor"
      description="They get a visitor pass with a QR code. At the gate the guard scans it and they are in."
      onSubmit={submit}
      submitting={invite.isPending}
      submitLabel={rows.length > 1 ? `Invite ${rows.length} visitors` : 'Invite'}
      errors={errors}
      size="lg"
    >
      <div className="space-y-4">
        {onBehalf && (
          <Field label="Whom are they meeting?" hint="Leave empty for yourself" error={errors.host}>
            <HostPicker host={host} label="" onChange={({ host: h }) => setHost(h)} people />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Day" required error={errors.date} className="col-span-2 sm:col-span-1">
            <Input type="date" min={todayISO()} value={f.date} onChange={(e) => set('date', e.target.value)} className="h-11" name="date" />
          </Field>
          <Field label="From" error={errors.time_from}>
            <Input type="time" value={f.time_from} onChange={(e) => set('time_from', e.target.value)} className="h-11" name="time_from" />
          </Field>
          <Field label="To" error={errors.time_to}>
            <Input type="time" value={f.time_to} onChange={(e) => set('time_to', e.target.value)} className="h-11" name="time_to" />
          </Field>
          <p className="col-span-2 -mt-1 text-[13px] text-muted-foreground sm:col-span-3">No time: any time that day.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Purpose">
            <NativeSelect value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="h-11" name="purpose">
              <option value="">Choose…</option>
              {config.purposes.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </NativeSelect>
          </Field>
          {config.locations.length > 0 && (
            <Field label="Gate / site">
              <NativeSelect value={f.location} onChange={(e) => set('location', e.target.value ? Number(e.target.value) : '')} className="h-11">
                <option value="">Any</option>
                {config.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>

        <fieldset className="space-y-3">
          <legend className="text-[15px] font-semibold">{rows.length > 1 ? `Visitors (${rows.length})` : 'Visitor'}</legend>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3" data-testid={`invite-row-${i}`}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Name" required error={errors[`visitors.${i}.name`]}>
                  <Input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} className="h-11 text-base sm:text-sm" name={`name-${i}`} aria-label={`Visitor ${i + 1} name`} />
                </Field>
                <Field label="Mobile (WhatsApp)" error={errors[`visitors.${i}.mobile`]}>
                  <Input type="tel" inputMode="numeric" value={r.mobile} onChange={(e) => setRow(i, 'mobile', e.target.value)} className="h-11 text-base sm:text-sm" name={`mobile-${i}`} aria-label={`Visitor ${i + 1} mobile`} />
                </Field>
                <Field label="Email (optional)" error={errors[`visitors.${i}.email`]}>
                  <Input type="email" value={r.email} onChange={(e) => setRow(i, 'email', e.target.value)} className="h-11 text-base sm:text-sm" name={`email-${i}`} />
                </Field>
                <Field label="Company / coming from">
                  <Input value={r.company} onChange={(e) => setRow(i, 'company', e.target.value)} className="h-11 text-base sm:text-sm" name={`company-${i}`} />
                </Field>
              </div>
              {rows.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          ))}
          {errors.visitors && (
            <p role="alert" className="text-[13px] font-medium text-destructive">
              {errors.visitors}
            </p>
          )}
          {rows.length < 25 && (
            <Button type="button" variant="outline" onClick={() => setRows((cur) => [...cur, blankRow()])}>
              <Plus /> Add another visitor
            </Button>
          )}
        </fieldset>

        {rows.length === 1 && (
          <Field label="People in the group" hint="Coming with this visitor, on one pass">
            <Input type="number" min={1} max={50} value={f.people} onChange={(e) => set('people', Number(e.target.value) || 1)} className="h-11 w-28" />
          </Field>
        )}
        <Field label="Note for the gate" hint="Optional">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Parking slot, meeting room…" />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox checked={f.send} onCheckedChange={(v) => set('send', v === true)} aria-label="Send the pass" className="mt-0.5" />
          <span>
            <span className="block font-medium">Send the pass by WhatsApp / email</span>
            <span className="block text-[13px] text-muted-foreground">Off: copy the pass link and share it yourself.</span>
          </span>
        </label>
      </div>
    </FormSheet>
  );
}

/** After inviting: each pass link, to copy and share (WhatsApp may not be set up yet). */
function InvitedDialog({ visits, onClose }: { visits: Visit[]; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{visits.length === 1 ? `${visits[0].name} is invited` : `${visits.length} visitors invited`}</DialogTitle>
          <DialogDescription>{visits[0]?.window}. The gate sees them under “Expected today” on the day.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="invited-list">
          {visits.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {v.name} <span className="font-mono text-[13px] text-muted-foreground">{v.pass_no}</span>
                </span>
                <span className="block text-[13px] text-muted-foreground">{passSentNote(v)}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => copyText(passUrl(v), 'Pass link copied')}>
                <Copy /> Copy link
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
