import { useAccess } from '@freefounders/core';
import { type DashboardCounts, type TaskDashboard, useTaskCategoryNames, useTaskDashboard } from '@freefounders/core/tasks';
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { RangePicker, rangeParams, rangeReady } from '@/features/tasks/shared';
import { useDebounced } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { Segmented } from './task-bits';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// [key, label, alert?, denominator]
const TILES: Array<[keyof DashboardCounts, string, 'alert' | 'good' | '', keyof DashboardCounts]> = [
  ['overdue', 'Overdue', 'alert', 'total'],
  ['pending', 'Pending', '', 'total'],
  ['in_progress', 'In Progress', '', 'total'],
  ['completed', 'Completed', 'good', 'total'],
  ['in_time', 'Finished on time', 'good', 'completed'],
  ['delayed', 'Finished late', 'alert', 'completed'],
];

/** Which list filters a tile opens (?status=…&overdue=1&done=…). */
const TILE_FILTERS: Record<string, Record<string, string>> = {
  overdue: { status: 'open', overdue: '1' },
  pending: { status: 'open' },
  in_progress: { status: 'open' },
  completed: { status: 'done' },
  in_time: { status: 'done', done: 'on_time' },
  delayed: { status: 'done', done: 'late' },
};

/** A colour from the theme (CSS variable) for the chart canvas, which cannot use classes. */
function themeColour(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tiles (each opens the matching list) and a per-category table or bar chart. */
export function DashboardTab({ onTile }: { onTile: (tab: 'my' | 'delegated', filters: Record<string, string>) => void }) {
  const access = useAccess();
  const hasGroup = access.tasks.can('tasks.view_all') || access.tasks.can('tasks.view_department');
  const [range, setRange] = useState('this_week');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [scope, setScope] = useState<'my' | 'delegated' | 'group'>('my');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'table' | 'bar'>('table');
  const q = useDebounced(search.trim(), 300);
  const cats = useTaskCategoryNames().data ?? [];
  const ready = rangeReady(range, custom);
  const dash = useTaskDashboard({ ...rangeParams(range, custom), scope, category: category || undefined, search: q || undefined }, ready);
  const data = dash.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker range={range} setRange={setRange} custom={custom} setCustom={setCustom} applied={data ? { from: data.range_from, to: data.range_to } : null} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Whose tasks"
          value={scope}
          onChange={setScope}
          options={[['my', 'My Report'], ['delegated', 'Delegated'], ...(hasGroup ? [['group', 'Group'] as ['group', string]] : [])]}
        />
        <NativeSelect aria-label="Category" className="w-auto min-w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search tasks" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <span className="flex-1" />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            ['table', 'Table'],
            ['bar', 'Bar chart'],
          ]}
        />
      </div>

      {dash.error ? (
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {TILES.map(([k]) => (
            <Skeleton key={k} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {TILES.map(([k, label, tone, base]) => {
              const of = data.tiles[base] || 0;
              const value = data.tiles[k] ?? 0;
              const clickable = scope !== 'group';
              const body = (
                <>
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                  <span className={cn('text-2xl font-semibold tracking-tight tabular', tone === 'alert' && value > 0 && 'text-destructive', tone === 'good' && value > 0 && 'text-success')}>{value}</span>
                  <span className="text-xs text-muted-foreground">{of ? `${value} of ${of} ${base === 'completed' ? 'completed' : 'tasks'}` : '—'}</span>
                </>
              );
              const cls = cn('flex flex-col gap-0.5 rounded-xl border bg-card p-3 text-left', tone === 'alert' && value > 0 && 'border-destructive/30');
              return clickable ? (
                <button key={k} type="button" className={cn(cls, 'cursor-pointer transition hover:border-primary/40 hover:shadow-sm')} title="Open the matching task list" onClick={() => onTile(scope === 'delegated' ? 'delegated' : 'my', TILE_FILTERS[k])}>
                  {body}
                </button>
              ) : (
                <div key={k} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
          {data.categories.length === 0 ? (
            <Card>
              <EmptyState title="No tasks in this range." />
            </Card>
          ) : view === 'table' ? (
            <Card className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Category</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Overdue</TH>
                    <TH className="text-right">Pending</TH>
                    <TH className="text-right">In progress</TH>
                    <TH className="text-right">Completed</TH>
                    <TH className="text-right">In time</TH>
                    <TH className="text-right">Delayed</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.categories.map((c) => (
                    <TR key={c.category}>
                      <TD className="font-medium">{c.category}</TD>
                      <TD className="text-right tabular">{c.total}</TD>
                      <TD className={cn('text-right tabular', c.overdue > 0 && 'text-destructive')}>{c.overdue}</TD>
                      <TD className="text-right tabular">{c.pending}</TD>
                      <TD className="text-right tabular">{c.in_progress}</TD>
                      <TD className="text-right text-success tabular">{c.completed}</TD>
                      <TD className="text-right tabular">{c.in_time}</TD>
                      <TD className={cn('text-right tabular', c.delayed > 0 && 'text-destructive')}>{c.delayed}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : (
            <Card className="p-4">
              <CategoryBars data={data} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function CategoryBars({ data }: { data: TaskDashboard }) {
  // Colours come from the theme at run time (and follow a brand colour or dark mode change).
  const [colours, setColours] = useState(() => ({ bar: themeColour('--primary'), text: themeColour('--muted-foreground'), grid: themeColour('--border') }));
  useEffect(() => {
    const read = () => setColours({ bar: themeColour('--primary'), text: themeColour('--muted-foreground'), grid: themeColour('--border') });
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => obs.disconnect();
  }, []);
  return (
    <div className="h-80" role="img" aria-label="Tasks per category">
      <Bar
        data={{
          labels: data.categories.map((c) => c.category),
          datasets: [{ data: data.categories.map((c) => c.total), backgroundColor: colours.bar, borderRadius: 4, maxBarThickness: 36 }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              displayColors: false,
              callbacks: {
                afterLabel: (ctx) => {
                  const c = data.categories[ctx.dataIndex];
                  return `overdue ${c.overdue} · pending ${c.pending} · in progress ${c.in_progress}\ncompleted ${c.completed} (in time ${c.in_time}, delayed ${c.delayed})`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: colours.text, font: { size: 11 } } },
            y: { beginAtZero: true, ticks: { color: colours.text, precision: 0, font: { size: 11 } }, grid: { color: colours.grid }, border: { display: false } },
          },
        }}
      />
    </div>
  );
}

