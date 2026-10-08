import { type PersonOption, useTaskActivities, useTaskPeople } from '@freefounders/core/tasks';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { fmtDT } from '@/features/tasks/shared';
import { useDebounced } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { Segmented, TaskCode } from './task-bits';

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
  const rows = list.data ?? [];

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
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search activity" placeholder="Search activity or task…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
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
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2.5 pl-0.5 text-[13px] transition hover:border-primary/40', on && 'border-primary bg-primary/10 text-primary')}
              >
                <Avatar name={c.name} className="size-6 text-[10px]" />
                {c.name}
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular">{c.count}</span>
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
          <EmptyState title="No task activity in this window." />
        ) : (
          <ul className="divide-y" aria-label="Activity">
            {rows.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!a.task}
                  title={a.task ? 'Open this task' : undefined}
                  onClick={() => a.task && navigate(href(a.task), { state: { fromList: true } })}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition hover:bg-muted/40 disabled:cursor-default"
                >
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {a.task_code && <TaskCode code={a.task_code} />}
                      <strong>{a.task_title}</strong>
                      <span className="text-muted-foreground">{a.text}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {a.actor?.name || 'System'} · {fmtDT(a.created_at)}
                      {a.task_assignee && <> · task of {a.task_assignee}</>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
