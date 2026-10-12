/** /tasks/leads — the pipeline board with filters, tiles, add-lead and the lead drawer (old pages/Leads.jsx). */
import { errorMessage, useAccess } from '@freefounders/core';
import { SearchField } from '@/components/common/search-field';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import {
  LEAD_OPEN_STAGES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STAGES,
  fmtINR,
  type Lead,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
  useLeadSummary,
  useLeads,
  useTeamPeople,
  useUpdateLead,
} from '@freefounders/core/tasks';
import { AlarmClock, Clock, IndianRupee, Plus, RefreshCw, Target, Trophy } from 'lucide-react';
import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, Tile, fmtWhen } from '../general/parts';
import { LEAD_PRIORITY_TONE, LeadDrawer, STAGE_TONE } from './lead-drawer';
import { LeadForm } from './lead-form';

export function LeadsPage() {
  const access = useAccess();
  const canAssign = access.tasks.can('leads.assign');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<LeadPriority | ''>('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [assignee, setAssignee] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [stage, setStage] = useState<LeadStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const [dropStage, setDropStage] = useState<LeadStatus | null>(null);
  const [err, setErr] = useState('');

  const leads = useLeads({ search, priority, source, assigned_to: assignee, overdue });
  const summary = useLeadSummary();
  const people = useTeamPeople().data ?? [];
  const update = useUpdateLead();

  // The open lead lives in the address (?lead=ID), so a refresh or a shared link opens the same one.
  const openId = Number(params.get('lead')) || null;
  const openLead = leads.data?.find((l) => l.id === openId) ?? null;
  const setOpen = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('lead', String(id));
    else next.delete('lead');
    setParams(next, { replace: true });
  };

  const rows = leads.data ?? [];
  const pipelineValue = useMemo(() => rows.filter((l) => LEAD_OPEN_STAGES.includes(l.status)).reduce((s, l) => s + Number(l.estimated_value || 0), 0), [rows]);

  const moveLead = (id: number, status: LeadStatus) => {
    const lead = rows.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (!lead.can_edit) {
      setErr('You cannot edit this lead.');
      return;
    }
    setErr('');
    update.mutate({ id, status }, { onError: (e) => setErr(errorMessage(e)) });
  };

  const stages = stage ? LEAD_STAGES.filter(([s]) => s === stage) : LEAD_STAGES;

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Leads"
        description="Every enquiry from first contact to won or lost. Drag a card to move it along, or open it to work on it."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add lead
          </Button>
        }
      />

      {summary.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Target} label="Total leads" value={summary.data.total} />
          <Tile icon={IndianRupee} tone="info" label="Open pipeline" value={fmtINR(pipelineValue) || '₹0'} sub="of the leads shown" />
          <Tile icon={Trophy} tone="success" label="Won" value={summary.data.by_status.won ?? 0} />
          <Tile icon={Clock} tone="warning" label="Overdue follow-ups" value={summary.data.overdue} alert={summary.data.overdue > 0} />
        </div>
      )}

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
          <SearchField className="relative" label="Search leads" placeholder="Search name, company, phone…" value={search} onChange={setSearch} />
          <div className="grid gap-0.5">
            <Label htmlFor="lf-stage" className="sr-only">
              Stage
            </Label>
            <NativeSelect id="lf-stage" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as LeadStatus | '')}>
              <option value="">All stages</option>
              {LEAD_STAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <NativeSelect aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as LeadPriority | '')}>
            <option value="">All priorities</option>
            {LEAD_PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as LeadSource | '')}>
            <option value="">All sources</option>
            {LEAD_SOURCES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          {canAssign ? (
            <NativeSelect aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span className="hidden lg:block" />
          )}
          <Button type="button" variant={overdue ? 'default' : 'outline'} aria-pressed={overdue} onClick={() => setOverdue((v) => !v)} className="justify-start lg:justify-center">
            <AlarmClock /> Overdue only
          </Button>
        </div>
      </Card>

      <ErrorNote>{err}</ErrorNote>
      {leads.error && <ErrorState error={leads.error} onRetry={() => leads.refetch()} />}
      {!leads.data && !leads.error && <Skeleton className="h-64" />}

      {leads.data && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={Target}
            title={search || priority || source || assignee || overdue ? 'No leads match these filters' : 'No leads yet'}
            description={search || priority || source || assignee || overdue ? 'Clear a filter or two.' : 'Add the first enquiry, or let the AI inbox turn messages into leads.'}
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add lead
              </Button>
            }
          />
        </Card>
      )}

      {leads.data && rows.length > 0 && (
        <div className={cn('grid gap-3', stage ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6')} aria-label="Pipeline board">
          {stages.map(([s, label]) => (
            <LeadColumn
              key={s}
              stage={s}
              label={label}
              cards={rows.filter((l) => l.status === s)}
              wide={!!stage}
              dropping={dropStage === s}
              setDropStage={setDropStage}
              onDrop={(id) => moveLead(id, s)}
              onOpen={setOpen}
              reset={[search.trim(), priority, source, assignee, overdue, stage]}
            />
          ))}
        </div>
      )}

      <Dialog open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <DialogContent className="max-w-2xl">{adding && <LeadForm initial={null} onClose={() => setAdding(false)} onSaved={(l) => setOpen(l.id)} />}</DialogContent>
      </Dialog>
      <LeadDrawer lead={openLead} onClose={() => setOpen(null)} />
    </div>
  );
}

/**
 * One stage of the board. It draws its first 30 cards (weak phones) and has its own "Load more"; the count in the heading
 * is every lead in the stage. Dropping on the column works wherever the card lands.
 */
function LeadColumn({
  stage: s,
  label,
  cards,
  wide,
  dropping,
  setDropStage,
  onDrop,
  onOpen,
  reset,
}: {
  stage: LeadStatus;
  label: string;
  cards: Lead[];
  wide: boolean;
  dropping: boolean;
  setDropStage: Dispatch<SetStateAction<LeadStatus | null>>;
  onDrop: (id: number) => void;
  onOpen: (id: number) => void;
  reset: unknown;
}) {
  const more = useShowMore(cards, { step: 30, reset });
  return (
    <section
      aria-label={`${label} (${cards.length})`}
      className={cn('flex min-w-0 flex-col rounded-xl border bg-muted/30 transition-colors', dropping && 'border-primary bg-primary/5')}
      onDragOver={(e) => {
        e.preventDefault();
        setDropStage(s);
      }}
      onDragLeave={() => setDropStage((d) => (d === s ? null : d))}
      onDrop={(e) => {
        e.preventDefault();
        setDropStage(null);
        const id = Number(e.dataTransfer.getData('text/lead-id'));
        if (id) onDrop(id);
      }}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn('size-2 rounded-full', { new: 'bg-info', contacted: 'bg-primary', quotation_sent: 'bg-warning', negotiation: 'bg-warning', won: 'bg-success', lost: 'bg-destructive' }[s])} aria-hidden />
          {label}
        </h2>
        <Chip>{cards.length}</Chip>
      </header>
      <div className={cn('flex flex-col gap-2 px-2 pb-2', wide ? 'sm:grid sm:grid-cols-2 lg:grid-cols-3' : '')}>
        {cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground">No leads</p>}
        {more.visible.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onOpen={() => onOpen(lead.id)} />
        ))}
      </div>
      <ShowMore {...more.footer} noun="leads" className="px-2 pt-0" />
    </section>
  );
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const open = LEAD_OPEN_STAGES.includes(lead.status);
  const value = fmtINR(lead.estimated_value);
  return (
    <article
      draggable={lead.can_edit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead-id', String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'rounded-lg border bg-card shadow-xs transition hover:border-primary/40',
        lead.can_edit && 'cursor-grab active:cursor-grabbing',
        lead.is_overdue && open && 'border-l-4 border-l-destructive',
        lead.priority === 'urgent' && !(lead.is_overdue && open) && 'border-l-4 border-l-warning',
      )}
    >
      <button type="button" onClick={onOpen} className="w-full cursor-pointer p-3 text-left" aria-label={`Open lead ${lead.customer_name}`}>
        <div className="truncate text-sm font-semibold">{lead.customer_name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {lead.company || '—'} · {lead.source_display}
        </div>
        {lead.requirement && <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{lead.requirement}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Avatar name={lead.assigned_to_detail?.name} className="size-6 text-xs" />
          <span className="sr-only">{lead.assigned_to_detail?.name || 'Unassigned'}</span>
          {lead.priority !== 'normal' && <Chip tone={LEAD_PRIORITY_TONE[lead.priority]}>{lead.priority_display}</Chip>}
          {value && <Chip tone="primary">{value}</Chip>}
          {lead.follow_up_at && open && (
            <Chip tone={lead.is_overdue ? 'danger' : 'neutral'} title={lead.is_overdue ? 'Follow-up overdue' : 'Next follow-up'}>
              <RefreshCw className="size-3" aria-hidden /> {fmtWhen(lead.follow_up_at)}
            </Chip>
          )}
          {!open && <Chip tone={STAGE_TONE[lead.status]}>{lead.status_display}</Chip>}
        </div>
      </button>
    </article>
  );
}
