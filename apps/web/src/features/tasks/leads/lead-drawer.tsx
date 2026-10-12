/** One lead, in a side sheet (old LeadDrawer): details, pipeline status, timeline + notes, documents, quotations. */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  LEAD_OPEN_STAGES,
  LEAD_PRIORITIES,
  LEAD_STAGES,
  QUOTATION_STATUSES,
  fmtINR,
  type Lead,
  type LeadEventType,
  type LeadPriority,
  type LeadStatus,
  type Quotation,
  type QuotationStatus,
  useAddLeadNote,
  useAddQuotation,
  useDeleteLead,
  useLeadDocuments,
  useLeadEvents,
  useLeadQuotations,
  useTeamPeople,
  useUpdateLead,
  useUpdateQuotation,
  useUploadLeadDocument,
} from '@freefounders/core/tasks';
import { FileText, Mail, Paperclip, Pencil, Phone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, type Tone, fmtWhen } from '../general/parts';
import { FilePick } from '../shared/file-pick';
import { toLocalInput } from '../shared/format';
import { ProofreadText } from '../shared/proofread-text';
import { LeadForm } from './lead-form';
import { safeHref } from '@/lib/safe-url';

export const STAGE_TONE: Record<LeadStatus, Tone> = { new: 'info', contacted: 'primary', quotation_sent: 'warning', negotiation: 'warning', won: 'success', lost: 'danger' };
export const LEAD_PRIORITY_TONE: Record<LeadPriority, Tone> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
const EVENT_TONE: Record<string, string> = {
  created: 'bg-primary',
  status_change: 'bg-warning',
  assignment: 'bg-info',
  note: 'bg-muted-foreground',
  follow_up: 'bg-warning',
  document: 'bg-info',
  quotation: 'bg-success',
};
const QUOTE_TONE: Record<QuotationStatus, Tone> = { draft: 'neutral', sent: 'info', accepted: 'success', rejected: 'danger' };

export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" aria-describedby={undefined}>
        {lead && <LeadDrawerBody lead={lead} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function LeadDrawerBody({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const access = useAccess();
  const canAssign = access.tasks.can('leads.assign');
  const canQuote = access.tasks.can('quotations.manage') && lead.can_edit;
  const isAdmin = access.tasks.can('leads.delete');
  const ro = !lead.can_edit;
  const people = useTeamPeople().data ?? [];
  const events = useLeadEvents(lead.id);
  const docs = useLeadDocuments(lead.id);
  const quotes = useLeadQuotations(lead.id);
  const update = useUpdateLead();
  const remove = useDeleteLead();
  const confirm = useConfirm();
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  const patch = (body: Parameters<typeof update.mutate>[0]) => {
    setErr('');
    update.mutate(body, { onError: (e) => setErr(errorMessage(e)) });
  };
  const del = async () => {
    const ok = await confirm({ title: `Delete the lead "${lead.customer_name}"?`, description: 'Its timeline, documents and quotations go with it. This cannot be undone.', confirmText: 'Delete lead', destructive: true });
    if (!ok.confirmed) return;
    remove.mutate(lead.id, {
      onSuccess: () => {
        toast.success('Lead deleted');
        onClose();
      },
      onError: (e) => setErr(errorMessage(e)),
    });
  };

  const value = fmtINR(lead.estimated_value);
  const open = LEAD_OPEN_STAGES.includes(lead.status);

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-lg">{lead.customer_name}</SheetTitle>
          <Chip tone={STAGE_TONE[lead.status] ?? 'neutral'}>{lead.status_display}</Chip>
          {lead.priority !== 'normal' && <Chip tone={LEAD_PRIORITY_TONE[lead.priority]}>{lead.priority_display}</Chip>}
          {lead.is_overdue && open && <Chip tone="danger">Follow-up overdue</Chip>}
        </div>
        <SheetDescription>
          {lead.company || '—'} · {lead.source_display} · {lead.department_display || 'No department'}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {!ro && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
          )}
          {lead.phone && (
            <Button size="sm" variant="outline" asChild>
              <a href={`tel:${lead.phone}`}>
                <Phone /> Call
              </a>
            </Button>
          )}
          {lead.email && (
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${lead.email}`}>
                <Mail /> Email
              </a>
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={del} loading={remove.isPending}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Phone">{lead.phone || '—'}</Field>
          <Field label="Email" className="break-all">
            {lead.email || '—'}
          </Field>
          <Field label="Requirement" className="sm:col-span-2 whitespace-pre-line">
            {lead.requirement || '—'}
          </Field>
          <div className="grid gap-1">
            <Label htmlFor="ld-status" className="text-xs text-muted-foreground">
              Status
            </Label>
            <NativeSelect id="ld-status" value={lead.status} disabled={ro || update.isPending} onChange={(e) => patch({ id: lead.id, status: e.target.value as LeadStatus })}>
              {LEAD_STAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ld-prio" className="text-xs text-muted-foreground">
              Priority
            </Label>
            <NativeSelect id="ld-prio" value={lead.priority} disabled={ro || update.isPending} onChange={(e) => patch({ id: lead.id, priority: e.target.value as LeadPriority })}>
              {LEAD_PRIORITIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ld-assignee" className="text-xs text-muted-foreground">
              Assigned to
            </Label>
            {canAssign && !ro ? (
              <NativeSelect id="ld-assignee" value={lead.assigned_to ?? ''} disabled={update.isPending} onChange={(e) => patch({ id: lead.id, assigned_to: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <div id="ld-assignee" className="flex items-center gap-2">
                <Avatar name={lead.assigned_to_detail?.name} className="size-6 text-xs" />
                {lead.assigned_to_detail?.name || 'Unassigned'}
              </div>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ld-follow" className="text-xs text-muted-foreground">
              Follow-up
            </Label>
            <Input
              id="ld-follow"
              type="datetime-local"
              disabled={ro || update.isPending}
              defaultValue={toLocalInput(lead.follow_up_at)}
              key={lead.follow_up_at ?? 'none'}
              onBlur={(e) => {
                const next = e.target.value ? new Date(e.target.value).toISOString() : null;
                if (next !== lead.follow_up_at) patch({ id: lead.id, follow_up_at: next });
              }}
            />
          </div>
          <Field label="Estimated value">{value || '—'}</Field>
          <Field label="Created">
            {lead.created_by_detail?.name || 'System'} · {fmtWhen(lead.created_at)}
          </Field>
        </dl>

        <ErrorNote>{err}</ErrorNote>

        <Tabs defaultValue="timeline">
          <TabsList aria-label="Lead sections">
            <TabsTrigger value="timeline">Timeline ({events.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="documents">Documents ({docs.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="quotations">Quotations ({quotes.data?.length ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline" className="pt-4">
            <Timeline leadId={lead.id} readOnly={ro} events={events.data} loading={events.isLoading} />
          </TabsContent>
          <TabsContent value="documents" className="pt-4">
            <Documents leadId={lead.id} readOnly={ro} docs={docs.data} loading={docs.isLoading} />
          </TabsContent>
          <TabsContent value="quotations" className="pt-4">
            <Quotations leadId={lead.id} canQuote={canQuote} quotes={quotes.data} loading={quotes.isLoading} />
          </TabsContent>
        </Tabs>
      </SheetBody>

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <DialogContent className="max-w-2xl">{editing && <LeadForm initial={lead} onClose={() => setEditing(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

// ─── timeline ─────────────────────────────────────────────────────────────

function Timeline({ leadId, readOnly, events, loading }: { leadId: number; readOnly: boolean; events: ReturnType<typeof useLeadEvents>['data']; loading: boolean }) {
  const add = useAddLeadNote();
  const [note, setNote] = useState('');
  const save = () => {
    const body = note.trim();
    if (!body) return;
    add.mutate({ id: leadId, body }, { onSuccess: () => setNote('') });
  };
  return (
    <div className="space-y-4">
      {!readOnly && (
        <div
          className="space-y-2"
          onKeyDown={(e) => {
            // Enter saves, Shift+Enter makes a new line (as on the old screen).
            if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'TEXTAREA') {
              e.preventDefault();
              save();
            }
          }}
        >
          <ProofreadText label="Add a note" value={note} onChange={setNote} rows={2} placeholder="What happened? Enter saves, Shift+Enter for a new line." />
          {add.error && <ErrorNote>{errorMessage(add.error)}</ErrorNote>}
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!note.trim()} loading={add.isPending}>
              Save note
            </Button>
          </div>
        </div>
      )}
      {loading && <Skeleton className="h-24" />}
      {events && events.length === 0 && <p className="text-sm text-muted-foreground">Nothing on the timeline yet.</p>}
      <ol className="space-y-3">
        {events?.map((ev) => (
          <li key={ev.id} className="flex gap-3 text-sm">
            <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', EVENT_TONE[ev.type as LeadEventType] ?? 'bg-muted-foreground')} aria-hidden />
            <div className="min-w-0">
              <span className="font-medium">{ev.type_display}</span> <span className="whitespace-pre-line">{ev.body}</span>
              <div className="text-xs text-muted-foreground">
                {ev.actor?.name || 'System'} · {fmtWhen(ev.created_at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── documents ────────────────────────────────────────────────────────────

function Documents({ leadId, readOnly, docs, loading }: { leadId: number; readOnly: boolean; docs: ReturnType<typeof useLeadDocuments>['data']; loading: boolean }) {
  const upload = useUploadLeadDocument();
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <FilePick multiple={false} label="Upload document" busy={upload.isPending} onPick={(files) => files[0] && upload.mutate({ id: leadId, file: files[0] }, { onSuccess: () => toast.success('Document uploaded') })} />
          {upload.error && <ErrorNote className="mt-2">{errorMessage(upload.error)}</ErrorNote>}
        </div>
      )}
      {loading && <Skeleton className="h-16" />}
      {docs && docs.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
      <ul className="space-y-1.5">
        {docs?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border px-3 py-2 text-sm">
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {d.url ? (
              <a href={safeHref(d.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                {d.filename}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate">{d.filename}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {d.uploaded_by?.name || '—'} · {fmtWhen(d.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── quotations ───────────────────────────────────────────────────────────

function Quotations({ leadId, canQuote, quotes, loading }: { leadId: number; canQuote: boolean; quotes: Quotation[] | undefined; loading: boolean }) {
  const add = useAddQuotation();
  const change = useUpdateQuotation();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    setErr('');
    add.mutate(
      { id: leadId, amount, notes: notes.trim() },
      {
        onSuccess: (q) => {
          toast.success(`Quotation ${q.number} added`);
          setAmount('');
          setNotes('');
        },
        onError: (ex) => setErr(errorMessage(ex)),
      },
    );
  };

  return (
    <div className="space-y-3">
      {canQuote && (
        <form onSubmit={submit} className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="q-amount">Amount (₹) *</Label>
            <Input id="q-amount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="q-notes">Notes (optional)</Label>
            <Input id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" size="sm" className="h-9" disabled={!amount} loading={add.isPending}>
            Add quotation
          </Button>
        </form>
      )}
      <ErrorNote>{err}</ErrorNote>
      {loading && <Skeleton className="h-16" />}
      {quotes && quotes.length === 0 && <p className="text-sm text-muted-foreground">No quotations yet.</p>}
      <ul className="space-y-2">
        {quotes?.map((q) => (
          <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <strong>{q.number}</strong> · {fmtINR(q.amount)}
              </div>
              {q.notes && <div className="text-muted-foreground">{q.notes}</div>}
              <div className="text-xs text-muted-foreground">
                {q.created_by?.name || '—'} · {fmtWhen(q.created_at)}
              </div>
            </div>
            {canQuote ? (
              <NativeSelect
                aria-label={`Status of quotation ${q.number}`}
                className="w-auto"
                value={q.status}
                disabled={change.isPending}
                onChange={(e) => {
                  setErr('');
                  change.mutate({ id: q.id, leadId, status: e.target.value as QuotationStatus }, { onError: (ex) => setErr(errorMessage(ex)) });
                }}
              >
                {QUOTATION_STATUSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Chip tone={QUOTE_TONE[q.status] ?? 'neutral'}>{q.status_display}</Chip>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
