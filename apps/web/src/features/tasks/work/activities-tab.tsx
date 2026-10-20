import { type PersonOption, useTaskActivities, useTaskPeople } from '@freefounders/core/tasks';
import { SearchField } from '@/components/common/search-field';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Activity } from '@/components/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { fmtDT } from '@/features/tasks/shared';
import { useDebounced } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { CountPill, Segmented, TaskCode } from './task-bits';

/** Everything done on the tasks I can see; click a row to open its task. The chips pick who did it. */
export function ActivitiesTab({ href }: { href: (id: number) => string }) {
  const navigate = useNavigate();
  const people: PersonOption[] = useTaskPeople().data ?? [];
  const [days, setDays] = useState('7');
  const [who, setWho] = useState('');
  const [actor, setActor] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const { list, counts } = useTaskActivities({ days: days || undefined, assigned_to: who || undefined, actor: actor || undefined, search: q || undefined });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const more = useShowMore(rows, { reset: [days, who, actor, q] });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Window"
          value={days}
          onChange={setDays}
          options={[
            ['1', 'Today'],
            ['7', '7 days'],
            ['30', '30 days'],
            ['', 'All'],
          ]}
        />
        {people.length > 1 && (
          <>
            <NativeSelect aria-label="Whose task" className="w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Whose task — anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Done by" className="w-auto" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Done by — anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        <SearchField className="relative min-w-48 flex-1 sm:max-w-xs" label="Search activity" placeholder="Search activity or task…" value={search} onChange={setSearch} />
        {(who || actor || search) && (
          <Button variant="ghost" size="sm" onClick={() => (setWho(''), setActor(''), setSearch(''))}>
            Clear
          </Button>
        )}
      </div>
      {(counts.data ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Done by">
          {(counts.data ?? []).map((c) => {
            const on = actor === String(c.user);
            return (
              <button
                key={c.user}
                type="button"
                aria-pressed={on}
                title={on ? `Showing only ${c.name} — click to clear` : `Show only ${c.name}`}
                onClick={() => setActor(on ? '' : String(c.user))}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border max-sm:min-h-[2.5rem] bg-card py-0.5 pr-2.5 pl-0.5 text-[13px] font-medium shadow-xs transition hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none', on && 'border-primary bg-primary/8 text-primary')}
              >
                <Avatar name={c.name} className="size-6 text-xs" />
                {c.name}
                <CountPill tone={on ? 'primary' : 'neutral'}>{c.count}</CountPill>
              </button>
            );
          })}
        </div>
      )}
      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Activity} title="No task activity in this window." description="Try a wider window or clear the people filters." />
        ) : (
          <ul className="divide-y" aria-label="Activity">
            {more.visible.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!a.task}
                  title={a.task ? 'Open this task' : undefined}
                  onClick={() => a.task && navigate(href(a.task), { state: { fromList: true } })}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none disabled:cursor-default"
                >
                  <Avatar name={a.actor?.name || 'System'} className="mt-0.5 size-7 text-xs" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {a.task_code && <TaskCode code={a.task_code} />}
                      <strong className="font-semibold">{a.task_title}</strong>
                      <span className="text-muted-foreground">{a.text}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">{a.actor?.name || 'System'}</span> · {fmtDT(a.created_at)}
                      {a.task_assignee && <> · task of {a.task_assignee}</>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!list.isLoading && !list.error && <ShowMore {...more.footer} noun="activities" className="border-t" />}
      </Card>
    </div>
  );
}
