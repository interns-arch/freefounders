/**
 * Processes (SOP): the written processes a mistake gets judged against. Everyone in the module reads them; sops.manage writes.
 * Old versions are kept (retired), so an old mistake is still judged against the process that existed then.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import { type Sop, useRetireSop, useSaveSop, useSops, useTaskDepartments } from '@freefounders/core/tasks';
import { BookOpen, Plus } from '@/components/icons';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { ProofreadText } from '../shared/proofread-text';
import { Chip, ErrorNote, OkNote, fmtDay } from '../general/parts';

const lines = (text: string | null | undefined) =>
  (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function SopRegister() {
  const access = useAccess();
  const canEdit = access.tasks.can('sops.manage');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Sop | 'new' | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const sops = useSops({ all: showAll });
  const retire = useRetireSop();
  const confirm = useConfirm();

  const term = q.trim().toLowerCase();
  const shown = (sops.data ?? []).filter((s) => !term || `${s.title} ${s.category} ${s.common_errors}`.toLowerCase().includes(term));

  const retireSop = async (s: Sop) => {
    const r = await confirm({
      title: `Retire "${s.title}" ${s.version}?`,
      description: 'It leaves the current list. Mistakes already judged against it keep citing it; nothing is deleted.',
      confirmText: 'Retire',
      destructive: true,
    });
    if (!r.confirmed) return;
    setErr('');
    retire.mutate(s.id, { onSuccess: () => setOk(`${s.title} ${s.version} retired.`), onError: (e) => setErr(errorMessage(e)) });
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Write down how each job is actually done. This is what decides whether a mistake was <strong>human error</strong> (the process was clear, a step was skipped) or a{' '}
        <strong>process failure</strong> (the process never said to do it). Old versions are kept, so an old mistake is still judged against the process that existed then.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SearchField className="relative min-w-48 flex-1 sm:max-w-sm" label="Search a process" placeholder="Search a process…" value={q} onChange={setQ} />
        <span className="text-xs text-muted-foreground">
          {shown.length} process{shown.length === 1 ? '' : 'es'}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} aria-label="Show retired versions" />
          Show retired versions
        </label>
        <span className="flex-1" />
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Write a process
          </Button>
        )}
      </div>
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{ok}</OkNote>
      {sops.error && <ErrorState error={sops.error} onRetry={() => sops.refetch()} />}
      {!sops.data && !sops.error && <Skeleton className="h-40" />}
      {sops.data && shown.length === 0 && (
        <Card>
          <EmptyState icon={BookOpen} title={term ? 'No process matches' : 'No process written yet'} description={term ? 'Try another word.' : 'Start with the job that goes wrong most often.'} />
        </Card>
      )}
      <ul className="grid gap-2" aria-label="Processes">
        {shown.map((s) => {
          const open = openId === s.id;
          return (
            <li key={s.id}>
              <Card className={cn('overflow-hidden', !s.active && 'opacity-75')}>
                <div className="flex items-start gap-2 p-3 sm:px-4">
                  <button type="button" aria-expanded={open} aria-label={`${s.title} ${s.version}`} onClick={() => setOpenId(open ? null : s.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-sm">{s.title}</strong>
                      <Chip tone="primary">{s.version}</Chip>
                      {!s.active && <Chip tone="warning">retired</Chip>}
                      {s.department_display && <Chip>{s.department_display}</Chip>}
                      {s.category && <Chip>{s.category}</Chip>}
                      <Chip>{s.step_count} steps</Chip>
                      {s.mistake_count > 0 && (
                        <Chip tone="danger" title="Mistakes logged against this process">
                          {s.mistake_count} mistake{s.mistake_count === 1 ? '' : 's'}
                        </Chip>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {s.owner_name ? `Owned by ${s.owner_name}` : 'No owner set'} · updated {fmtDay(s.updated_at.slice(0, 10))}
                    </span>
                  </button>
                  {canEdit && s.active && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="xs" variant="outline" aria-label={`Edit ${s.title}`} onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="ghost" aria-label={`Retire ${s.title}`} onClick={() => retireSop(s)}>
                        Retire
                      </Button>
                    </div>
                  )}
                </div>
                {open && <SopBody sop={s} />}
              </Card>
            </li>
          );
        })}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing && (
            <SopForm
              initial={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={(s, asNew) => {
                setEditing(null);
                setErr('');
                setOk(asNew ? `${s.title} ${s.version} saved as a new version; the old one is kept.` : `${s.title} ${s.version} saved.`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SopBody({ sop }: { sop: Sop }) {
  return (
    <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-sm sm:px-4">
      <div>
        <p className="font-semibold">Steps</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          {lines(sop.steps).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
      {lines(sop.checks).length > 0 && (
        <div>
          <p className="font-semibold">Check before calling it done</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {lines(sop.checks).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {lines(sop.common_errors).length > 0 && (
        <div>
          <p className="font-semibold">Mistakes people make here</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {lines(sop.common_errors).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const STEP_HINT = [
  'Collect the supplier invoice and the GRN for the same lot',
  'Check the invoice GST number against the supplier master',
  'Match every line item and rate against the purchase order',
  'Create the purchase voucher in Tally under the correct ledger',
].join('\n');

function SopForm({ initial, onClose, onSaved }: { initial: Sop | null; onClose: () => void; onSaved: (s: Sop, asNewVersion: boolean) => void }) {
  const depts = useTaskDepartments().data ?? [];
  const save = useSaveSop();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    department: initial?.department ?? '',
    category: initial?.category ?? '',
    version: initial?.version ?? 'v1',
    steps: initial?.steps ?? '',
    checks: initial?.checks ?? '',
    common_errors: initial?.common_errors ?? '',
  });
  const [asNew, setAsNew] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...f, id: initial?.id, asNewVersion: asNew }, { onSuccess: (s) => onSaved(s, asNew && !!initial) });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{initial ? `${initial.title} — ${initial.version}` : 'Write a process'}</DialogTitle>
        <DialogDescription>Step-by-step instructions the team follows so the same mistake is not repeated.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="sop-title">What job is this? *</Label>
          <Input id="sop-title" required autoFocus={!initial} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Purchase invoice entry in Tally" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sop-dept">Department</Label>
          <NativeSelect id="sop-dept" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sop-cat">Mistake category it maps to</Label>
          <Input id="sop-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Data entry" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sop-ver">Version *</Label>
          <Input id="sop-ver" required value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="v1" />
        </div>
        {initial && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox checked={asNew} onCheckedChange={(v) => setAsNew(v === true)} aria-label="Save as a new version (keeps the old one)" />
            Save as a new version (keeps the old one)
          </label>
        )}
        <div className="sm:col-span-2">
          <ProofreadText id="sop-steps" label="Steps — one per line, in order" required rows={7} value={f.steps} onChange={(v) => setF({ ...f, steps: v })} placeholder={STEP_HINT} hint="Say what to do AND what done-correctly looks like. Two lines minimum." />
        </div>
        <div className="sm:col-span-2">
          <ProofreadText id="sop-checks" label="Check before calling it done" rows={3} value={f.checks} onChange={(v) => setF({ ...f, checks: v })} placeholder="Voucher total equals the invoice total to the paisa" />
        </div>
        <div className="sm:col-span-2">
          <ProofreadText id="sop-errors" label="Mistakes people make here" rows={3} value={f.common_errors} onChange={(v) => setF({ ...f, common_errors: v })} placeholder="Part name typed instead of the part code" hint="This is the list a new mistake gets matched against — write the real ones." />
        </div>
      </div>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!f.title.trim() || !f.version.trim() || lines(f.steps).length < 2}>
          {asNew && initial ? 'Save as new version' : 'Save process'}
        </Button>
      </DialogFooter>
    </form>
  );
}
