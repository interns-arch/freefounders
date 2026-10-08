import type { WorkTask } from '@freefounders/core/tasks';
import { Bell, BellOff, Clock, FileText, Pencil, Repeat, Timer, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Badge, Checkbox } from '@/components/ui/primitives';
import { fmtDT, fmtEffort, relDue } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';
import { Chip, PRIORITY_TONE, TaskCode } from './task-bits';

export interface TaskRowActions {
  /** Open the detail of this task (a link, so it can open in a new tab). */
  href: (id: number) => string;
  setStatus?: (t: WorkTask, status: 'open' | 'in_progress' | 'done') => void;
  estimate?: (t: WorkTask) => void;
  request?: (t: WorkTask) => void;
  follow?: (t: WorkTask) => void;
  update?: (t: WorkTask) => void;
  profile?: (id: number, name: string) => void;
}

/** One task in a list: tick to complete, chips, who/when, and the row actions the viewer may use. */
export function TaskRow({ t, me, isAdmin, scope, actions }: { t: WorkTask; me: number | undefined; isAdmin: boolean; scope?: string; actions: TaskRowActions }) {
  const mine = t.assigned_to === me;
  const open = t.status !== 'done';
  const canChange = (mine || t.created_by_detail?.id === me || isAdmin) && open;
  return (
    <li className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start', !open && 'opacity-80')}>
      <div className="flex min-w-0 flex-1 gap-3">
        <Checkbox
          className="mt-1"
          checked={t.status === 'done'}
          disabled={!mine || !actions.setStatus}
          aria-label={!mine ? `Only the assignee can complete ${t.code}` : t.status === 'done' ? `Reopen ${t.code}` : `Mark ${t.code} done`}
          title={!mine ? 'Only the assignee can complete this task' : t.status === 'done' ? 'Reopen' : 'Mark done'}
          onCheckedChange={(v) => actions.setStatus?.(t, v === true ? 'done' : 'open')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskCode code={t.code} />
            <Link to={actions.href(t.id)} state={{ fromList: true }} className={cn('min-w-0 font-medium break-words hover:text-primary hover:underline', !open && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
              {t.title}
            </Link>
            {t.category && <Chip>{t.category}</Chip>}
            {t.group_name && (
              <Chip>
                <Users /> {t.group_name}
              </Chip>
            )}
            {t.frequency !== 'one_time' && (
              <Chip>
                <Repeat /> {t.frequency_display}
                {t.repeat_until ? ` till ${fmtDT(`${t.repeat_until}T00:00:00`)?.split(',')[0]}` : ''}
              </Chip>
            )}
            {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority_display}</Badge>}
            {!!t.effort_minutes && (
              <Chip title="Effort set by the assigner">
                <Timer /> {fmtEffort(t.effort_minutes)}
              </Chip>
            )}
            {t.status === 'in_progress' && t.progress_percent != null && <Chip title="Latest status update">{t.progress_percent}%</Chip>}
            {!!t.actual_minutes && (
              <Chip title={open ? 'Effort spent so far (self-reported)' : 'Actual effort spent vs assigned'}>
                <Clock /> {open ? `${fmtEffort(t.actual_minutes)} spent` : `took ${fmtEffort(t.actual_minutes)}`}
              </Chip>
            )}
            {!!t.assignee_estimate_minutes && (
              <Chip title="Assignee's own estimate" tone="violet">
                est. {fmtEffort(t.assignee_estimate_minutes)}
              </Chip>
            )}
            {t.pending_change_requests > 0 && (
              <Badge tone="orange" title="Pending change request">
                <Pencil /> {t.pending_change_requests}
              </Badge>
            )}
          </div>
          {t.description && <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{t.description}</p>}
          {t.completion_note && (
            <p className="mt-1 flex items-start gap-1 text-sm text-muted-foreground">
              <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t.completion_note}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {scope === 'all' && actions.profile ? (
              <button type="button" className="cursor-pointer font-medium text-foreground hover:text-primary hover:underline" title="Open this person's full profile" onClick={() => actions.profile?.(t.assigned_to, t.assigned_to_detail.name)}>
                {t.assigned_to_detail.name}
              </button>
            ) : (
              t.assigned_to_detail?.name
            )}
            {scope !== 'my' && t.created_by_detail && <> · by {t.created_by_detail.name}</>}
            {t.lead_name && (
              <>
                {' '}
                · lead: <strong>{t.lead_name}</strong>
              </>
            )}
            {t.due_at && open && <span className={cn(t.is_overdue && 'font-medium text-destructive')}> · {relDue(t.due_at)}</span>}
            {t.completed_at && <> · done {fmtDT(t.completed_at)}</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-7 sm:shrink-0 sm:pl-0">
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
          <Button variant={t.subscribed ? 'secondary' : 'outline'} size="xs" aria-label={`${t.subscribed ? 'Unfollow' : 'Follow'} ${t.code}`} aria-pressed={t.subscribed} title={t.subscribed ? 'Unfollow' : 'Follow this task'} onClick={() => actions.follow?.(t)}>
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
          <NativeSelect aria-label={`Status of ${t.code}`} value={t.status} onChange={(e) => actions.setStatus?.(t, e.target.value as 'open' | 'in_progress' | 'done')} className="h-7 w-auto py-0 pr-7 pl-2 text-xs">
            <option value="open">Open</option>
            <option value="in_progress">In progress — status update</option>
            <option value="done">Done</option>
          </NativeSelect>
        )}
      </div>
    </li>
  );
}
