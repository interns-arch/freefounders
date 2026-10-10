import type { WorkTask } from '@freefounders/core/tasks';
import { AlarmClock, Bell, BellOff, CalendarClock, CheckCircle2, Clock, FileText, Pencil, Repeat, Timer, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Badge, Checkbox } from '@/components/ui/primitives';
import { fmtDT, fmtEffort, relDue } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { Chip, PriorityPill, StatusPill, TaskCode } from './task-bits';

interface TaskRowActions {
  /** Open the detail of this task (a link, so it can open in a new tab). */
  href: (id: number) => string;
  setStatus?: (t: WorkTask, status: 'open' | 'in_progress' | 'done') => void;
  estimate?: (t: WorkTask) => void;
  request?: (t: WorkTask) => void;
  follow?: (t: WorkTask) => void;
  update?: (t: WorkTask) => void;
  profile?: (id: number, name: string) => void;
}

/**
 * One task in a list, the way the old app drew it: tick to complete, bold title with the code in mono, soft pills for
 * priority / progress / effort, a red left bar when overdue, and the row actions the viewer may use (they stack on phones).
 */
export function TaskRow({ t, me, isAdmin, scope, actions }: { t: WorkTask; me: number | undefined; isAdmin: boolean; scope?: string; actions: TaskRowActions }) {
  const mine = t.assigned_to === me;
  const open = t.status !== 'done';
  const late = open && !!t.is_overdue;
  const canChange = (mine || t.created_by_detail?.id === me || isAdmin) && open;
  return (
    <li
      className={cn(
        'flex flex-col gap-2.5 border-l-[3px] border-l-transparent py-3 pr-4 pl-3.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-start',
        late && 'border-l-destructive',
        !open && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Checkbox
          className="mt-[3px] size-[17px]"
          checked={t.status === 'done'}
          disabled={!mine || !actions.setStatus}
          aria-label={!mine ? `Only the assignee can complete ${t.code}` : t.status === 'done' ? `Reopen ${t.code}` : `Mark ${t.code} done`}
          title={!mine ? 'Only the assignee can complete this task' : t.status === 'done' ? 'Reopen' : 'Mark done'}
          onCheckedChange={(v) => actions.setStatus?.(t, v === true ? 'done' : 'open')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TaskCode code={t.code} />
            <Link
              to={actions.href(t.id)}
              state={{ fromList: true }}
              className={cn('min-w-0 text-[14.5px] font-semibold break-words hover:text-primary hover:underline', !open && 'text-muted-foreground line-through decoration-muted-foreground/40')}
            >
              {t.title}
            </Link>
            {t.priority !== 'normal' && <PriorityPill priority={t.priority} label={t.priority_display} />}
            {t.status === 'in_progress' && <StatusPill status="in_progress" label={t.progress_percent != null ? `${t.progress_percent}% · ${t.status_display}` : t.status_display} />}
            {t.pending_change_requests > 0 && (
              <Badge tone="orange" className="rounded-full" title="Pending change request">
                <Pencil /> {t.pending_change_requests} change request{t.pending_change_requests === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          {t.description && <p className="mt-1 line-clamp-2 text-[13px] whitespace-pre-line text-muted-foreground">{t.description}</p>}
          {t.completion_note && (
            <p className="mt-1 flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <FileText className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t.completion_note}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {scope === 'all' && actions.profile ? (
              <button type="button" className="cursor-pointer font-semibold text-foreground hover:text-primary hover:underline" title="Open this person's full profile" onClick={() => actions.profile?.(t.assigned_to, t.assigned_to_detail.name)}>
                {t.assigned_to_detail.name}
              </button>
            ) : (
              <span className="font-semibold text-foreground">{t.assigned_to_detail?.name}</span>
            )}
            {scope !== 'my' && t.created_by_detail && <span>· by {t.created_by_detail.name}</span>}
            {t.lead_name && (
              <span>
                · lead: <strong className="font-semibold text-foreground">{t.lead_name}</strong>
              </span>
            )}
            {t.due_at && open && (
              <span className={cn('inline-flex items-center gap-1', late && 'font-bold text-destructive')}>
                · {late ? <AlarmClock className="size-3.5" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />} {relDue(t.due_at)}
              </span>
            )}
            {t.completed_at && (
              <span className="inline-flex items-center gap-1 text-success">
                · <CheckCircle2 className="size-3.5" aria-hidden /> done {fmtDT(t.completed_at)}
              </span>
            )}
          </div>
          {(t.category || t.group_name || t.frequency !== 'one_time' || !!t.effort_minutes || !!t.actual_minutes || !!t.assignee_estimate_minutes) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {t.category && <Chip>{t.category}</Chip>}
              {t.group_name && (
                <Chip>
                  <Users /> {t.group_name}
                </Chip>
              )}
              {t.frequency !== 'one_time' && (
                <Chip tone="indigo">
                  <Repeat /> {t.frequency_display}
                  {t.repeat_until ? ` till ${fmtDT(`${t.repeat_until}T00:00:00`)?.split(',')[0]}` : ''}
                </Chip>
              )}
              {!!t.effort_minutes && (
                <Chip title="Effort set by the assigner" className="font-mono tabular">
                  <Timer /> {fmtEffort(t.effort_minutes)}
                </Chip>
              )}
              {!!t.actual_minutes && (
                <Chip title={open ? 'Effort spent so far (self-reported)' : 'Actual effort spent vs assigned'} className="font-mono tabular">
                  <Clock /> {open ? `${fmtEffort(t.actual_minutes)} spent` : `took ${fmtEffort(t.actual_minutes)}`}
                </Chip>
              )}
              {!!t.assignee_estimate_minutes && (
                <Chip title="Assignee's own estimate" tone="violet" className="font-mono tabular">
                  est. {fmtEffort(t.assignee_estimate_minutes)}
                </Chip>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-[29px] sm:shrink-0 sm:pl-0">
        {mine && open && !t.assignee_estimate_minutes && actions.estimate && (
          <Button variant="outline" size="xs" title="Disagree with the effort? Record your own estimate." onClick={() => actions.estimate?.(t)}>
            est.
          </Button>
        )}
        {canChange && actions.request && (
          <Button variant="outline" size="xs" title={isAdmin ? 'Edit this task (admin — applies immediately)' : 'Propose a change (deadline, effort, recurrence…) for approval'} onClick={() => actions.request?.(t)} aria-label={`${isAdmin ? 'Edit' : 'Change'} ${t.code}`}>
            <Pencil /> {isAdmin ? 'Edit' : 'Change'}
          </Button>
        )}
        {actions.follow && (
          <Button
            variant="outline"
            size="xs"
            className={cn(t.subscribed && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
            aria-label={`${t.subscribed ? 'Unfollow' : 'Follow'} ${t.code}`}
            aria-pressed={t.subscribed}
            title={t.subscribed ? 'Unfollow' : 'Follow this task'}
            onClick={() => actions.follow?.(t)}
          >
            {t.subscribed ? <BellOff /> : <Bell />}
            {t.subscribed ? 'Following' : 'Follow'}
          </Button>
        )}
        {t.status === 'in_progress' && mine && actions.update && (
          <Button variant="outline" size="xs" title="Add another status update (% done, effort, comment)" onClick={() => actions.update?.(t)}>
            + update
          </Button>
        )}
        {open && mine && actions.setStatus && (
          <NativeSelect
            aria-label={`Status of ${t.code}`}
            value={t.status}
            onChange={(e) => actions.setStatus?.(t, e.target.value as 'open' | 'in_progress' | 'done')}
            className={cn('h-7 w-[7.5rem] rounded-md py-0 pr-7 pl-2 text-xs font-medium', t.status === 'in_progress' && 'border-warning/40 bg-warning/8 text-warning')}
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress — status update</option>
            <option value="done">Done</option>
          </NativeSelect>
        )}
      </div>
    </li>
  );
}
