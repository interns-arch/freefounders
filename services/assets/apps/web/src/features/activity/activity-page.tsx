import { HISTORY_ENTITY_TYPES, humanize } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { Pagination } from '@/components/common/data-table';
import { ErrorState, PageHeader } from '@/components/common/page';
import { Timeline } from '@/components/common/timeline';
import { Input, NativeSelect } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/primitives';
import { api, type Page } from '@/lib/api';
import type { HistoryEvent } from '@/lib/types';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';

/** Organisation-wide, append-only activity log. */
export default function ActivityPage() {
  const { values: f, set } = useUrlFilters({ page: '1', pageSize: '50' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useQuery({ queryKey: ['history', 'all', f], queryFn: () => api.get<Page<HistoryEvent>>('/history', f) });

  return (
    <div>
      <PageHeader
        title="Activity log"
        description={
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600" /> Immutable: the database rejects any edit or deletion of history.
          </span>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity, people, assets…" className="pl-8" />
          </div>
          <NativeSelect className="w-auto" value={f.entityType ?? ''} onChange={(e) => set({ entityType: e.target.value })}>
            <option value="">Everything</option>
            {HISTORY_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" className="w-auto" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" className="w-auto" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        </div>
        <CardContent className="pt-5">{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Timeline events={q.data?.items} loading={q.isLoading} showEntity emptyText="No activity matches" />}</CardContent>
        {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => set({ page: p }, { keepPage: true })} />}
      </Card>
    </div>
  );
}
