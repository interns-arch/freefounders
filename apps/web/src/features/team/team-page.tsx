/**
 * /team — Team 360 (PLAN.md §25): one tile per person the viewer may see (owners / admins / HR: everyone; a manager:
 * their team). Today's status, this month's attendance % and tasks done / overdue. Search, department, status, sort;
 * 60 tiles drawn at a time so 500 people stay fast on a weak phone.
 */
import { type Team360Tile, useTeam360Tiles } from '@kaampilot/core/team';
import { SearchX, UsersRound } from '@/components/icons';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChipRow, FilterChip } from '@/components/common/controls';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { ShowMore, useShowMore } from '@/components/common/show-more';
import { Label, NativeSelect } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { RATE_TEXT, type StatusFilter, TodayChip, pct, rateTone, statusGroup, time } from './parts';

type SortKey = 'name' | 'attendance' | 'overdue' | 'done' | 'late';
const SORTS: Array<[SortKey, string, 'tasks' | 'attendance' | null]> = [
  ['name', 'Name (A–Z)', null],
  ['attendance', 'Lowest attendance first', 'attendance'],
  ['late', 'Most late days first', 'attendance'],
  ['overdue', 'Most overdue tasks first', 'tasks'],
  ['done', 'Most tasks done first', 'tasks'],
];
const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ['all', 'Everyone'],
  ['present', 'Present'],
  ['late', 'Late'],
  ['leave', 'On leave'],
  ['absent', 'Absent'],
  ['not_checked_in', 'Not punched in'],
  ['off', 'Off today'],
];
const SCOPE_TEXT = {
  company: 'Everyone in the company',
  department: 'Your department and your team',
  team: 'You and the people who report to you',
};

function matches(r: Team360Tile, words: string[]): boolean {
  if (!words.length) return true;
  const hay = `${r.name} ${r.username} ${r.employee_code} ${r.phone} ${r.designation}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function sortValue(r: Team360Tile, k: SortKey): number | string {
  switch (k) {
    case 'attendance':
      return r.month?.attendance_rate ?? 101;
    case 'late':
      return -(r.month?.late_days ?? 0);
    case 'overdue':
      return -(r.tasks?.overdue ?? 0);
    case 'done':
      return -(r.tasks?.done_this_month ?? 0);
    default:
      return r.name.toLowerCase();
  }
}

export function TeamPage() {
  const q = useTeam360Tiles();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const data = q.data;
  const areas = data?.areas;

  const inDept = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.rows ?? []).filter((r) => (!department || r.department_code === department) && matches(r, words));
  }, [data, search, department]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: inDept.length,
      present: 0,
      late: 0,
      leave: 0,
      absent: 0,
      not_checked_in: 0,
      off: 0,
    };
    for (const r of inDept) if (r.today) c[statusGroup(r.today.status)] += 1;
    return c;
  }, [inDept]);
  const rows = useMemo(() => {
    const list = status === 'all' ? [...inDept] : inDept.filter((r) => r.today && statusGroup(r.today.status) === status);
    list.sort((a, b) => {
      const x = sortValue(a, sort);
      const y = sortValue(b, sort);
      return x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
    });
    return list;
  }, [inDept, status, sort]);
  const more = useShowMore(rows, {
    step: 60,
    reset: [search, department, status, sort],
  });
  const sorts = SORTS.filter(([, , area]) => !area || areas?.[area]);
  const monthName = data
    ? new Date(`${data.month.start}T00:00:00`).toLocaleDateString('en-IN', {
        month: 'long',
      })
    : '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        description={
          data
            ? `${SCOPE_TEXT[data.scope]} · ${data.rows.length} ${data.rows.length === 1 ? 'person' : 'people'}. Open anyone for their full picture.`
            : 'Everyone you look after, at a glance.'
        }
        className="mb-2"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchField value={search} onChange={setSearch} label="Search people" placeholder="Name, employee ID or phone" className="sm:w-72" />
        {(data?.departments.length ?? 0) > 1 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="team-dept" className="sr-only">
              Department
            </Label>
            <NativeSelect id="team-dept" value={department} onChange={(e) => setDepartment(e.target.value)} className="sm:w-52">
              <option value="">All departments</option>
              {data?.departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          <Label htmlFor="team-sort" className="shrink-0 text-sm text-muted-foreground">
            Sort
          </Label>
          <NativeSelect id="team-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sm:w-60">
            {sorts.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {areas?.attendance && (
        <ChipRow label="Today's status">
          {STATUS_FILTERS.map(([v, l]) => (
            <FilterChip key={v} active={status === v} onClick={() => setStatus(v)} count={counts[v]} aria-pressed={status === v}>
              {l}
            </FilterChip>
          ))}
        </ChipRow>
      )}

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        data.rows.length === 0 ? (
          <EmptyState icon={UsersRound} title="Nobody to show yet." description="People appear here once they are added in Admin → People." />
        ) : (
          <EmptyState icon={SearchX} title="Nobody matches." description="Try another name, department or status." />
        )
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4" aria-label="People">
            {more.visible.map((r) => (
              <li key={r.id} className="min-w-0">
                <PersonTile r={r} monthName={monthName} />
              </li>
            ))}
          </ul>
          <ShowMore {...more.footer} noun="people" />
        </>
      )}
    </div>
  );
}

function PersonTile({ r, monthName }: { r: Team360Tile; monthName: string }) {
  const rate = r.month?.attendance_rate;
  return (
    <Link
      to={`/team/${r.id}`}
      className="flex h-full min-h-[11rem] flex-col rounded-xl border bg-card p-3 shadow-card transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:p-3.5"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar name={r.name} className="size-10 shrink-0 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] leading-tight font-semibold break-words">
            {r.name}
            {r.is_self && <span className="font-normal text-muted-foreground"> (you)</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{r.designation || 'No designation'}</p>
          <p className="truncate text-xs text-muted-foreground">{r.department || '—'}</p>
        </div>
      </div>
      {r.today && (
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <TodayChip status={r.today.status} />
          {r.today.check_in && <span className="font-mono text-xs text-muted-foreground tabular-nums">in {time(r.today.check_in)}</span>}
        </div>
      )}
      <dl className="mt-auto grid auto-cols-fr grid-flow-col gap-1 border-t pt-2.5 text-center">
        {r.month && (
          <div className="min-w-0" title={`${monthName}: ${r.month.present_days} of ${r.month.working_days} working days`}>
            <dt className="truncate font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Attend.</dt>
            <dd className={cn('font-mono text-base font-bold tabular-nums', RATE_TEXT[rateTone(rate)])}>{pct(rate)}</dd>
          </div>
        )}
        {r.tasks && (
          <>
            <div className="min-w-0" title={`Tasks completed in ${monthName}`}>
              <dt className="truncate font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Done</dt>
              <dd className="font-mono text-base font-bold tabular-nums">{r.tasks.done_this_month}</dd>
            </div>
            <div className="min-w-0" title="Open tasks past their due date">
              <dt className="truncate font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Overdue</dt>
              <dd className={cn('font-mono text-base font-bold tabular-nums', r.tasks.overdue > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                {r.tasks.overdue}
              </dd>
            </div>
          </>
        )}
        {r.month && !r.tasks && (
          <>
            <div className="min-w-0">
              <dt className="truncate font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Late</dt>
              <dd className="font-mono text-base font-bold tabular-nums">{r.month.late_days}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Leave</dt>
              <dd className="font-mono text-base font-bold tabular-nums">{r.month.leave_days}</dd>
            </div>
          </>
        )}
      </dl>
    </Link>
  );
}
