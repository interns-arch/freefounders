/** HR → Team (who is in today, with punch photos; manual mark) and Approvals (leave + corrections). */
import { errorMessage, useAccess } from '@freefounders/core';
import { type TeamTodayRow, useManualMark, usePendingCorrections, usePendingLeaves, useReviewHrRequest, useTeamToday } from '@freefounders/core/hr';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorNote, OkNote, Tile, fmtDay, fmtTime } from '../tasks/general/parts';
import { MonthView } from './attendance';
import { AttendanceChip, PunchPhoto, hrs } from './parts';

export function TeamTab() {
  const access = useAccess();
  const canManage = access.tasks.can('hr.manage');
  const q = useTeamToday();
  const mark = useManualMark();
  const confirm = useConfirm();
  const [msg, setMsg] = useState('');
  const [viewing, setViewing] = useState<TeamTodayRow | null>(null);

  const markPresent = async (r: TeamTodayRow) => {
    setMsg('');
    const ok = await confirm({
      title: `Mark ${r.name} present?`,
      note: { label: 'Reason', placeholder: 'e.g. face lock not working', required: true },
      confirmText: 'Mark present',
    });
    if (!ok.confirmed) return;
    mark.mutate({ user: r.user_id, status: 'present', reason: ok.note }, { onSuccess: () => setMsg(`${r.name} marked present ✅`) });
  };

  if (viewing)
    return (
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={() => setViewing(null)}>
          <ArrowLeft /> Back to team
        </Button>
        <MonthView userId={viewing.user_id} userName={viewing.name} />
      </div>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 max-w-4xl" />;
  const c = q.data.counts;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Present" value={c.present || 0} />
        <Tile label="Late" value={c.late || 0} alert={(c.late ?? 0) > 0} />
        <Tile label="Half Day" value={c.half_day || 0} />
        <Tile label="On Leave" value={c.leave || 0} />
        <Tile label="Not checked in" value={c.not_checked_in || 0} alert={(c.not_checked_in ?? 0) > 0} />
      </div>
      {mark.error && <ErrorNote>{errorMessage(mark.error)}</ErrorNote>}
      <OkNote>{msg}</OkNote>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Department</TH>
              <TH>Status</TH>
              <TH>In</TH>
              <TH>Out</TH>
              <TH>Worked</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {q.data.rows.map((r) => (
              <TR key={r.user_id}>
                <TD className="font-medium">{r.name}</TD>
                <TD>{r.department}</TD>
                <TD>
                  <AttendanceChip status={r.status} />
                </TD>
                <TD className="whitespace-nowrap">
                  {fmtTime(r.check_in)}
                  {r.has_check_in_photo && <PunchPhoto id={r.attendance_id} which="in" label={`${r.name} check-in photo`} />}
                </TD>
                <TD className="whitespace-nowrap">
                  {fmtTime(r.check_out)}
                  {r.has_check_out_photo && <PunchPhoto id={r.attendance_id} which="out" label={`${r.name} check-out photo`} />}
                </TD>
                <TD>{hrs(r.working_minutes)}</TD>
                <TD>
                  <div className="flex justify-end gap-1.5">
                    <Button size="xs" variant="outline" aria-label={`History of ${r.name}`} onClick={() => setViewing(r)}>
                      History
                    </Button>
                    {canManage && r.status !== 'present' && r.status !== 'late' && (
                      <Button size="xs" aria-label={`Mark ${r.name} present`} onClick={() => markPresent(r)}>
                        Mark present
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

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
        <h2 className="text-sm font-semibold">Leave requests ({leaves.data?.length ?? '…'})</h2>
        {!leaves.data && <Skeleton className="h-16" />}
        {leaves.data?.length === 0 && (
          <Card>
            <EmptyState icon={Inbox} title="Nothing pending" className="py-6" />
          </Card>
        )}
        {!!leaves.data?.length && (
          <Card className="divide-y">
            {leaves.data.map((l) => (
              <ApprovalRow
                key={l.id}
                kind="leave"
                remark={remarks[`leave${l.id}`] ?? ''}
                setRemark={(v) => setRemarks((p) => ({ ...p, [`leave${l.id}`]: v }))}
                busy={review.isPending}
                onDecide={(decision) => review.mutate({ kind: 'leave', id: l.id, decision, remarks: remarks[`leave${l.id}`] ?? '' })}
                title={`${l.user_detail?.name} — ${l.leave_type_name} (${l.days} day${l.days > 1 ? 's' : ''})`}
                sub={l.reason}
                meta={`${fmtDay(l.start_date)} – ${fmtDay(l.end_date)}`}
              />
            ))}
          </Card>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Attendance corrections ({corrections.data?.length ?? '…'})</h2>
        {!corrections.data && <Skeleton className="h-16" />}
        {corrections.data?.length === 0 && (
          <Card>
            <EmptyState icon={Inbox} title="Nothing pending" className="py-6" />
          </Card>
        )}
        {!!corrections.data?.length && (
          <Card className="divide-y">
            {corrections.data.map((c) => (
              <ApprovalRow
                key={c.id}
                kind="correction"
                remark={remarks[`correction${c.id}`] ?? ''}
                setRemark={(v) => setRemarks((p) => ({ ...p, [`correction${c.id}`]: v }))}
                busy={review.isPending}
                onDecide={(decision) => review.mutate({ kind: 'correction', id: c.id, decision, remarks: remarks[`correction${c.id}`] ?? '' })}
                title={`${c.user_detail?.name} — ${fmtDay(c.date)}`}
                sub={c.reason}
                meta={`in ${fmtTime(c.requested_check_in)} · out ${fmtTime(c.requested_check_out)}`}
              />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function ApprovalRow({
  title,
  sub,
  meta,
  remark,
  setRemark,
  busy,
  onDecide,
}: {
  kind: 'leave' | 'correction';
  title: string;
  sub: string;
  meta: string;
  remark: string;
  setRemark: (v: string) => void;
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected') => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{sub}</div>
        <div className="text-xs text-muted-foreground">{meta}</div>
      </div>
      <Input aria-label={`Remarks for ${title}`} placeholder="Remarks…" className="sm:w-44" value={remark} onChange={(e) => setRemark(e.target.value)} />
      <div className="flex gap-1.5">
        <Button size="sm" aria-label={`Approve ${title}`} disabled={busy} onClick={() => onDecide('approved')}>
          Approve
        </Button>
        <Button size="sm" variant="outline" aria-label={`Reject ${title}`} disabled={busy} onClick={() => onDecide('rejected')}>
          Reject
        </Button>
      </div>
    </div>
  );
}
