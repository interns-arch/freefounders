import type { Workload } from '@kaampilot/core/tasks';
import { TriangleAlert } from '@/components/icons';
import { fmtEffort } from '@/features/tasks/shared';
import { cn } from '@/lib/utils';

/** One person's live pipeline, shown when picking an assignee. Informs, never blocks. */
export function WorkloadPanel({ w }: { w: Workload }) {
  const pb = w.priority_breakdown ?? {};
  const hot = (['urgent', 'high'] as const)
    .filter((p) => pb[p])
    .map((p) => `${pb[p]} ${p}`)
    .join(', ');
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', w.overloaded ? 'border-warning/50 bg-warning/10' : 'border-success/30 bg-success/5')}>
      <strong>{w.name}&rsquo;s pipeline:</strong>{' '}
      {w.open_tasks === 0 ? (
        'no open tasks — free right now'
      ) : (
        <>
          {w.open_tasks} open{hot ? ` (${hot})` : ''}
          {w.overdue > 0 && (
            <>
              {' '}
              · <span className="text-destructive">{w.overdue} overdue</span>
            </>
          )}{' '}
          · {fmtEffort(w.pending_effort_minutes) || '0m'} of effort pending
          {w.tasks_without_effort > 0 && (
            <span className="text-muted-foreground">
              {' '}
              (+{w.tasks_without_effort} task{w.tasks_without_effort === 1 ? '' : 's'} with no effort value)
            </span>
          )}
        </>
      )}
      {w.overloaded && (
        <p className="mt-1 flex items-center gap-1.5 text-warning">
          <TriangleAlert className="size-3.5" aria-hidden /> Heavy pipeline — you can still assign; this warning never blocks.
        </p>
      )}
    </div>
  );
}
