/** HR → Approvals (leave + corrections). Who is in today lives in live.tsx / daily.tsx (PLAN.md §19.15). */
import { errorMessage } from '@freefounders/core';
import { usePendingCorrections, usePendingLeaves, useReviewHrRequest } from '@freefounders/core/hr';
import { Check, ClipboardCheck, Inbox, Palmtree, X } from '@/components/icons';
import { useState } from 'react';
import { EmptyState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, CountPill, ErrorNote, fmtDay, fmtTime } from '../tasks/general/parts';

export function ApprovalsTab() {
  const leaves = usePendingLeaves();
  const corrections = usePendingCorrections();
  const review = useReviewHrRequest();
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const error = leaves.error ?? corrections.error ?? review.error;
  return (
    <div className="max-w-4xl space-y-5">
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-info/12 text-info">
            <Palmtree className="size-4" />
          </span>
          <h2 className="text-[15px] font-bold tracking-tight">Leave requests ({leaves.data?.length ?? '…'})</h2>
          {!!leaves.data?.length && <CountPill tone="warning">{leaves.data.length}</CountPill>}
        </div>
        {!leaves.data && <Skeleton className="h-24" />}
        {leaves.data?.length === 0 && (
          <Card>
            <EmptyState icon={Inbox} title="Nothing pending" description="New leave requests from your team land here." className="py-6" />
          </Card>
        )}
        {!!leaves.data?.length && (
          <div className="grid gap-2">
            {leaves.data.map((l) => (
              <ApprovalRow
                key={l.id}
                kind="leave"
                remark={remarks[`leave${l.id}`] ?? ''}
                setRemark={(v) => setRemarks((p) => ({ ...p, [`leave${l.id}`]: v }))}
                busy={review.isPending}
                onDecide={(decision) => review.mutate({ kind: 'leave', id: l.id, decision, remarks: remarks[`leave${l.id}`] ?? '' })}
                title={`${l.user_detail?.name} — ${l.leave_type_name} (${l.days} day${l.days > 1 ? 's' : ''})`}
                person={l.user_detail?.name}
                tag={`${l.leave_type_name} · ${l.days} day${l.days > 1 ? 's' : ''}`}
                sub={l.reason}
                meta={`${fmtDay(l.start_date)} – ${fmtDay(l.end_date)}`}
              />
            ))}
          </div>
        )}
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <ClipboardCheck className="size-4" />
          </span>
          <h2 className="text-[15px] font-bold tracking-tight">Attendance corrections ({corrections.data?.length ?? '…'})</h2>
          {!!corrections.data?.length && <CountPill tone="warning">{corrections.data.length}</CountPill>}
        </div>
        {!corrections.data && <Skeleton className="h-24" />}
        {corrections.data?.length === 0 && (
          <Card>
            <EmptyState icon={Inbox} title="Nothing pending" description="Requests to fix a missed punch show here." className="py-6" />
          </Card>
        )}
        {!!corrections.data?.length && (
          <div className="grid gap-2">
            {corrections.data.map((c) => (
              <ApprovalRow
                key={c.id}
                kind="correction"
                remark={remarks[`correction${c.id}`] ?? ''}
                setRemark={(v) => setRemarks((p) => ({ ...p, [`correction${c.id}`]: v }))}
                busy={review.isPending}
                onDecide={(decision) => review.mutate({ kind: 'correction', id: c.id, decision, remarks: remarks[`correction${c.id}`] ?? '' })}
                title={`${c.user_detail?.name} — ${fmtDay(c.date)}`}
                person={c.user_detail?.name}
                tag={fmtDay(c.date)}
                sub={c.reason}
                meta={`in ${fmtTime(c.requested_check_in)} · out ${fmtTime(c.requested_check_out)}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One request waiting for a decision: who, what, why, the remarks box and Approve / Reject. */
function ApprovalRow({
  kind,
  title,
  person,
  tag,
  sub,
  meta,
  remark,
  setRemark,
  busy,
  onDecide,
}: {
  kind: 'leave' | 'correction';
  title: string;
  person?: string;
  tag: string;
  sub: string;
  meta: string;
  remark: string;
  setRemark: (v: string) => void;
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected') => void;
}) {
  return (
    <Card className={cn('border-l-4 p-3 sm:p-4', kind === 'leave' ? 'border-l-info' : 'border-l-warning')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar name={person} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <strong className="font-semibold">{person}</strong>
              {person && title.startsWith(person) ? title.slice(person.length) : title}
            </div>
            <div className="mt-0.5 text-sm text-foreground/90">{sub}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Chip tone={kind === 'leave' ? 'info' : 'warning'}>{tag}</Chip>
              {meta}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <Input aria-label={`Remarks for ${title}`} placeholder="Remarks…" className="sm:w-48" value={remark} onChange={(e) => setRemark(e.target.value)} />
          <div className="grid grid-cols-2 gap-1.5 sm:flex">
            <Button size="sm" variant="success" aria-label={`Approve ${title}`} disabled={busy} onClick={() => onDecide('approved')}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Reject ${title}`} disabled={busy} onClick={() => onDecide('rejected')}>
              <X /> Reject
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
