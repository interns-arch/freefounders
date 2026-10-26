/**
 * Incident log (PLAN.md §22.10): theft, damage, trespass, fire, medical… reported at the gate with photos. Medium and
 * high ones alert the security head at once; the head writes what was done and closes it.
 */
import { ApiError, errorMessage } from '@kaampilot/core';
import { fileSlug } from '@kaampilot/core/export';
import { type Incident, type IncidentFilters, type IncidentInput, type IncidentSeverity, type VisitorConfig, useCloseIncident, useIncidentPhoto, useIncidents, useReportIncident, visitorExportsV3 } from '@kaampilot/core/visitors';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MessageSquareWarning, Plus, X } from '@/components/icons';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { Segmented } from '@/components/common/controls';
import { Field } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { todayISO } from '@/lib/utils';
import { PhotoField, PrivatePhoto, clock } from './parts';

const SEV: Record<IncidentSeverity, BadgeTone> = { low: 'neutral', medium: 'amber', high: 'red' };
const MAX_PHOTOS = 4;

export function IncidentBadges({ i }: { i: Incident }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={SEV[i.severity]}>{i.severity_display}</Badge>
      <Badge tone={i.status === 'open' ? 'blue' : 'neutral'}>{i.status === 'open' ? 'Open' : 'Closed'}</Badge>
    </span>
  );
}

/** "2026-10-26T14:05" for a datetime-local input, in local time. */
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function IncidentsPage({ config }: { config: VisitorConfig }) {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'closed' | ''>('open');
  const [f, setF] = useState<IncidentFilters>({ severity: '', kind: '', q: '', date_from: todayISO(-90), date_to: todayISO() });
  const filters: IncidentFilters = { ...f, status };
  const list = useIncidents(filters);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(Number(params.get('open')) || null);
  useEffect(() => {
    if (params.get('open')) setParams((p) => (p.delete('open'), p), { replace: true });
  }, [params, setParams]);
  const rows = list.data?.results ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidents"
        description="Security incidents at the premises. Medium and high ones alert the security head at once."
        actions={
          <>
            <DownloadMenu filename={fileSlug('visitors-incidents', f.date_from, f.date_to)} target={visitorExportsV3.incidents(filters)} empty={!rows.length} loading={list.isLoading} />
            <Button variant="cta" size="lg" onClick={() => setAdding(true)}>
              <Plus /> Report incident
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <Segmented
          options={[
            ['open', 'Open'],
            ['closed', 'Closed'],
            ['', 'All'],
          ]}
          value={status}
          onChange={setStatus}
          label="Status"
        />
        <SearchField value={f.q ?? ''} onChange={(v) => setF({ ...f, q: v })} label="Search" className="w-full max-w-xs" />
        <NativeSelect value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} aria-label="Severity" className="w-auto">
          <option value="">Any severity</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </NativeSelect>
        <NativeSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Kind" className="w-auto">
          <option value="">Any kind</option>
          {config.incident_kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} aria-label="From" className="w-auto" />
        <Input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} aria-label="To" className="w-auto" />
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setOpenId(r.id)}
        empty={status === 'open' ? 'No open incidents.' : 'No incidents.'}
        columns={[
          { key: 'when', header: 'When', cell: (r) => clock(r.occurred_at) },
          { key: 'what', header: 'What', cell: (r) => <span className="font-medium">{r.title}</span> },
          { key: 'kind', header: 'Kind', cell: (r) => r.kind_display, hideOnMobile: true },
          { key: 'where', header: 'Where', cell: (r) => r.place || r.location?.name || '—', hideOnMobile: true },
          { key: 'sev', header: 'Status', cell: (r) => <IncidentBadges i={r} /> },
          { key: 'by', header: 'Reported by', cell: (r) => r.reported_by?.name ?? '—', hideOnMobile: true },
        ]}
      />
      {adding && <ReportSheet config={config} onClose={() => setAdding(false)} />}
      {open && <IncidentDialog incident={open} canClose={config.can.view_all} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReportSheet({ config, onClose }: { config: VisitorConfig; onClose: () => void }) {
  const [f, setF] = useState<IncidentInput & { when: string }>({ kind: 'other', severity: 'medium', title: '', description: '', place: '', location: config.locations[0]?.id ?? null, when: localNow(), photos: [] });
  const [next, setNext] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const report = useReportIncident();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  useEffect(() => {
    if (next) {
      setF((cur) => ({ ...cur, photos: [...(cur.photos ?? []), next].slice(0, MAX_PHOTOS) }));
      setNext(null);
    }
  }, [next]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErrors({ title: 'What happened? (one line)' });
    const { when, ...body } = f;
    try {
      const i = await report.mutateAsync({ ...body, occurred_at: new Date(when).toISOString() });
      toast.success(i.severity === 'low' ? 'Incident recorded' : 'Incident reported: the security head is told');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    }
  };
  return (
    <FormSheet open onOpenChange={(o) => !o && onClose()} title="Report incident" onSubmit={submit} submitting={report.isPending} submitLabel="Report" errors={errors}>
      <div className="space-y-4">
        <Field label="What happened" required error={errors.title}>
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} className="h-11 text-base sm:text-sm" name="title" placeholder="Copper cable missing from the yard" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <NativeSelect value={f.kind} onChange={(e) => set('kind', e.target.value)} className="h-11" name="kind">
              {config.incident_kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Severity" hint="Medium / high alert the security head">
            <NativeSelect value={f.severity} onChange={(e) => set('severity', e.target.value as IncidentSeverity)} className="h-11" name="severity">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High: urgent</option>
            </NativeSelect>
          </Field>
          <Field label="When" error={errors.occurred_at}>
            <Input type="datetime-local" value={f.when} max={localNow()} onChange={(e) => set('when', e.target.value)} className="h-11" name="when" />
          </Field>
          <Field label="Where">
            <Input value={f.place} onChange={(e) => set('place', e.target.value)} className="h-11" name="place" placeholder="Yard, gate 2…" />
          </Field>
        </div>
        <Field label="Details">
          <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What you saw, who was there, what you did" />
        </Field>
        <Field label={`Photos (${f.photos?.length ?? 0}/${MAX_PHOTOS})`} error={errors.photos}>
          <div className="space-y-2">
            {!!f.photos?.length && (
              <div className="flex flex-wrap gap-2">
                {f.photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p} alt={`Photo ${i + 1}`} className="size-20 rounded-md object-cover" />
                    <Button type="button" variant="outline" size="icon" className="absolute -top-2 -right-2 size-6" aria-label={`Remove photo ${i + 1}`} onClick={() => set('photos', f.photos!.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {(f.photos?.length ?? 0) < MAX_PHOTOS && <PhotoField label="Incident photo" value={null} onChange={(v) => v && setNext(v)} testId="incident-photo" />}
          </div>
        </Field>
      </div>
    </FormSheet>
  );
}

function IncidentPhotoThumb({ incident, photoId }: { incident: number; photoId: number }) {
  const q = useIncidentPhoto(incident, photoId);
  return <PrivatePhoto query={q} alt="Incident photo" className="size-28" />;
}

function IncidentDialog({ incident: i, canClose, onClose }: { incident: Incident; canClose: boolean; onClose: () => void }) {
  const [action, setAction] = useState('');
  const close = useCloseIncident();
  const done = async () => {
    if (!action.trim()) return void toast.error('Write what was done about it.');
    try {
      await close.mutateAsync({ id: i.id, action_taken: action.trim() });
      toast.success('Incident closed');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <MessageSquareWarning className="size-5" aria-hidden /> {i.title}
          </DialogTitle>
          <DialogDescription>
            {i.kind_display} · {clock(i.occurred_at)}
            {i.place || i.location ? ` · ${i.place || i.location?.name}` : ''}
          </DialogDescription>
        </DialogHeader>
        <IncidentBadges i={i} />
        {i.description && <p className="text-sm whitespace-pre-line">{i.description}</p>}
        {i.photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {i.photos.map((p) => (
              <IncidentPhotoThumb key={p} incident={i.id} photoId={p} />
            ))}
          </div>
        )}
        <p className="text-[13px] text-muted-foreground">
          Reported by {i.reported_by?.name ?? '—'} · {clock(i.reported_at)}
          {i.visit ? ` · visitor ${i.visit.name}` : ''}
        </p>
        {i.status === 'closed' ? (
          <div className="space-y-1 border-t pt-3 text-sm">
            <p className="font-semibold">Action taken</p>
            <p className="whitespace-pre-line">{i.action_taken}</p>
            <p className="text-[13px] text-muted-foreground">
              Closed by {i.closed_by} · {clock(i.closed_at)}
            </p>
          </div>
        ) : canClose ? (
          <div className="space-y-2 border-t pt-3">
            <Field label="What was done">
              <Textarea rows={3} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Police complaint filed, lock replaced…" />
            </Field>
            <Button onClick={() => void done()} loading={close.isPending}>
              Close incident
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
