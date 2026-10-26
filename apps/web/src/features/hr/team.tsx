/** HR → Approvals: Leave and Regularization tabs (PLAN.md §19.38). Who is in today lives in live.tsx / daily.tsx (PLAN.md §19.15). */
import { errorMessage } from '@kaampilot/core';
import { ATTENDANCE_STATUS_LABELS, type Regularization, hrExports, useHrConfig, useBulkReviewRegularizations, usePendingCorrections, usePendingLeaves, useReviewHrRequest } from '@kaampilot/core/hr';
import { todayStamp } from '@kaampilot/core/export';
import { Check, CheckCheck, ClipboardCheck, Inbox, MapPin, Palmtree, Paperclip, X } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DownloadMenu } from '@/components/common/download-menu';
import { EmptyState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, CountPill, ErrorNote, OkNote, Segmented, fmtDay, fmtTime } from '../tasks/general/parts';
import { MarkLeaveButton } from './mark-leave';
import { RegularizeForSomeoneButton } from './regularize';
import { hrs } from './parts';

export function ApprovalsTab() {
  const cfg = useHrConfig();
  // A reporting manager without the approve permission decides only regularizations (PLAN.md §19.38).
  const leaveToo = cfg.data ? cfg.data.can_approve : true;
  const leaves = usePendingLeaves(leaveToo);
  const corrections = usePendingCorrections();
  const review = useReviewHrRequest();
  const bulk = useBulkReviewRegularizations();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  // From a notification (PLAN.md §19.37): ?leave=<id> or ?correction=<id> (?regularization=<id>) points at the one to review.
  const [params] = useSearchParams();
  const focusLeave = Number(params.get('leave')) || null;
  const focusCorrection = Number(params.get('correction') ?? params.get('regularization')) || null;
  const [chosenTab, setTab] = useState<'leave' | 'regularization'>(focusCorrection ? 'regularization' : 'leave');
  const tab = leaveToo ? chosenTab : 'regularization';
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkMsg, setBulkMsg] = useState('');

  const error = leaves.error ?? corrections.error ?? review.error ?? bulk.error;
  const regs = corrections.data;
  const pickable = regs?.map((c) => c.id) ?? [];
  const chosen = picked.filter((id) => pickable.includes(id));
  const decideMany = (decision: 'approved' | 'rejected') => {
    setBulkMsg('');
    bulk.mutate(
      { ids: chosen, decision },
      {
        onSuccess: (r) => {
          setPicked([]);
          const word = decision === 'approved' ? 'Approved' : 'Rejected';
          setBulkMsg(`${word} ${r.done.length}.${r.failed.length ? ` Not done: ${r.failed.map((f) => f.detail).join(' ')}` : ''}`);
        },
      },
    );
  };
  return (
    <div className="max-w-4xl space-y-4">
      {leaveToo && (
        <Segmented
          label="Approvals"
          value={tab}
          onChange={setTab}
          options={[
            [
              'leave',
              <>
                Leave {!!leaves.data?.length && <CountPill tone="warning">{leaves.data.length}</CountPill>}
              </>,
            ],
            [
              'regularization',
              <>
                Regularization {!!regs?.length && <CountPill tone="warning">{regs.length}</CountPill>}
              </>,
            ],
          ]}
        />
      )}
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      {tab === 'leave' && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-info/12 text-info">
              <Palmtree className="size-4" />
            </span>
            <h2 className="text-[15px] font-bold tracking-tight">Leave requests ({leaves.data?.length ?? '…'})</h2>
            <span className="ml-auto" />
            <MarkLeaveButton />
            <DownloadMenu filename={`attendance-approvals-leave-pending-${todayStamp()}`} target={hrExports.pendingLeave()} loading={!leaves.data} empty={leaves.data?.length === 0} />
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
                  focused={l.id === focusLeave}
                  kind="leave"
                  remark={remarks[`leave${l.id}`] ?? ''}
                  setRemark={(v) => setRemarks((p) => ({ ...p, [`leave${l.id}`]: v }))}
                  busy={review.isPending}
                  onDecide={(decision, beyondBalance) => review.mutate({ kind: 'leave', id: l.id, decision, remarks: remarks[`leave${l.id}`] ?? '', beyondBalance })}
                  title={`${l.user_detail?.name} — ${l.leave_type_name} (${leaveDaysText(l)})`}
                  person={l.user_detail?.name}
                  tag={`${l.leave_type_name} · ${leaveDaysText(l)}`}
                  overBalance={
                    l.balance_check?.over
                      ? `Beyond balance: ${l.user_detail?.name ?? 'This person'} has ${l.balance_check.available} day(s) of ${l.leave_type_name} left; this request needs ${l.balance_check.needs}.`
                      : undefined
                  }
                  sub={l.reason}
                  meta={`${fmtDay(l.start_date)} – ${fmtDay(l.end_date)}`}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {tab === 'regularization' && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <ClipboardCheck className="size-4" />
            </span>
            <h2 className="text-[15px] font-bold tracking-tight">Regularization requests ({regs?.length ?? '…'})</h2>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <RegularizeForSomeoneButton size="sm" />
            </span>
            <DownloadMenu
              filename={`attendance-approvals-regularization-pending-${todayStamp()}`}
              target={hrExports.pendingCorrections()}
              loading={!regs}
              empty={regs?.length === 0}
            />
          </div>
          {!!regs?.length && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="Select all regularization requests"
                  checked={chosen.length === pickable.length ? true : chosen.length ? 'indeterminate' : false}
                  onCheckedChange={(v) => setPicked(v === true ? pickable : [])}
                />
                {chosen.length ? `${chosen.length} selected` : 'Select all'}
              </label>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="success" disabled={!chosen.length || bulk.isPending} loading={bulk.isPending} onClick={() => decideMany('approved')}>
                  <CheckCheck /> Approve selected
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!chosen.length || bulk.isPending} onClick={() => decideMany('rejected')}>
                  <X /> Reject selected
                </Button>
              </div>
            </div>
          )}
          <OkNote>{bulkMsg}</OkNote>
          {!regs && <Skeleton className="h-24" />}
          {regs?.length === 0 && (
            <Card>
              <EmptyState icon={Inbox} title="Nothing pending" description="Requests to regularize a day (a missed punch, on duty, work from home) show here." className="py-6" />
            </Card>
          )}
          {!!regs?.length && (
            <div className="grid gap-2">
              {regs.map((c) => (
                <ApprovalRow
                  key={c.id}
                  focused={c.id === focusCorrection}
                  kind="correction"
                  remark={remarks[`correction${c.id}`] ?? ''}
                  setRemark={(v) => setRemarks((p) => ({ ...p, [`correction${c.id}`]: v }))}
                  busy={review.isPending}
                  onDecide={(decision) => review.mutate({ kind: 'correction', id: c.id, decision, remarks: remarks[`correction${c.id}`] ?? '' })}
                  title={`${c.user_detail?.name} — ${fmtDay(c.date)}`}
                  person={c.user_detail?.name}
                  tag={c.reason_label || fmtDay(c.date)}
                  sub={c.reason}
                  meta={fmtDay(c.date)}
                  select={{ checked: chosen.includes(c.id), onChange: (v) => setPicked((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id))) }}
                  detail={<RegularizationDetail c={c} />}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** What the approver needs to decide: recorded → requested times, the day's status and hours, where the check-in was, the attachment. */
function RegularizationDetail({ c }: { c: Regularization }) {
  const d = c.day;
  return (
    <div className="mt-2 grid gap-1.5 text-xs">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono tabular-nums sm:w-fit">
        <span className="font-sans text-muted-foreground">Recorded</span>
        <span>
          in {fmtTime(d?.check_in)} · out {fmtTime(d?.check_out)}
          {d?.status ? ` · ${ATTENDANCE_STATUS_LABELS[d.status] ?? d.status}` : ' · nothing recorded'}
          {d?.working_minutes ? ` · ${hrs(d.working_minutes)}` : ''}
        </span>
        <span className="font-sans font-semibold text-primary">Requested</span>
        <span className="font-semibold text-primary">
          in {c.requested_check_in ? fmtTime(c.requested_check_in) : 'as recorded'} · out {c.requested_check_out ? fmtTime(c.requested_check_out) : 'as recorded'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {d?.distance_m != null && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" /> Check-in {d.distance_m < 1000 ? `${d.distance_m} m` : `${(d.distance_m / 1000).toFixed(1)} km`} from {d.location_name ?? 'the office'}
          </span>
        )}
        {d && <span>{d.month_requests} request{d.month_requests === 1 ? '' : 's'} this month</span>}
        {c.attachment_url && (
          <a href={c.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
            <Paperclip className="size-3.5" /> {c.attachment_name ?? 'Attachment'}
          </a>
        )}
      </div>
    </div>
  );
}

const leaveDaysText = (l: { days: number; half_day?: boolean; leave_days?: number }) => {
  const n = l.half_day ? 0.5 : (l.leave_days ?? l.days);
  return n === 0.5 ? 'half day' : `${n} day${n === 1 ? '' : 's'}`;
};

/**
 * One request waiting for a decision: who, what, why, the remarks box and Approve / Reject. Leave beyond the person's
 * balance shows a warning and "Approve beyond balance" instead of Approve (the override is logged on the request).
 */
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
  overBalance,
  focused,
  select,
  detail,
}: {
  /** Opened from its notification: scrolled into view and outlined. */
  focused?: boolean;
  kind: 'leave' | 'correction';
  title: string;
  person?: string;
  tag: string;
  sub: string;
  meta: string;
  remark: string;
  setRemark: (v: string) => void;
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected', beyondBalance?: boolean) => void;
  overBalance?: string;
  /** Bulk decisions: the row's checkbox. */
  select?: { checked: boolean; onChange: (v: boolean) => void };
  /** More about the request under its line (a regularization's times, place, attachment). */
  detail?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  return (
    <Card ref={ref} data-focused={focused || undefined} className={cn('border-l-4 p-3 sm:p-4', kind === 'leave' ? 'border-l-info' : 'border-l-warning', focused && 'ring-2 ring-primary')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {select && <Checkbox className="mt-2.5" aria-label={`Select ${title}`} checked={select.checked} onCheckedChange={(v) => select.onChange(v === true)} />}
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
            {detail}
            {overBalance && (
              <p role="status" className="mt-2 rounded-md border border-warning/30 bg-warning/8 px-2.5 py-1.5 text-xs font-medium">
                {overBalance}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <Input aria-label={`Remarks for ${title}`} placeholder="Remarks…" className="sm:w-48" value={remark} onChange={(e) => setRemark(e.target.value)} />
          <div className="grid grid-cols-2 gap-1.5 sm:flex">
            {overBalance ? (
              <Button size="sm" variant="outline" aria-label={`Approve ${title} beyond balance`} disabled={busy} onClick={() => onDecide('approved', true)}>
                <Check /> Approve beyond balance
              </Button>
            ) : (
              <Button size="sm" variant="success" aria-label={`Approve ${title}`} disabled={busy} onClick={() => onDecide('approved')}>
                <Check /> Approve
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Reject ${title}`} disabled={busy} onClick={() => onDecide('rejected')}>
              <X /> Reject
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
