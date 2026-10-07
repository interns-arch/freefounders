import { RECON_SOURCE_LABELS, type ReconSource, type ReconStatus } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CardSim, CheckCircle2, Plus, Search } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { invalidateAssetData, queryClient } from '@/lib/queries';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDateTime } from '@/lib/utils';
import { STATUS_META } from './summary';

interface ReconIssue {
  field: string;
  label: string;
  dump: string | null;
  system: string | null;
  level: 'error' | 'warning';
}
interface ReconItem {
  status: ReconStatus;
  key: string;
  title: string;
  subtitle: string | null;
  entity: { kind: 'ASSET' | 'EMPLOYEE'; id: string; label: string } | null;
  issues: ReconIssue[];
  addSim?: { connectionNumber: string; employeeId: string | null; employeeName: string | null };
}
interface ReconRun {
  id: string;
  source: ReconSource;
  fileName: string;
  rowCount: number;
  repairedRows: number;
  summary: Record<string, number>;
  items: ReconItem[];
  createdByName: string | null;
  createdAt: string;
}

const TABS: { value: string; label: string; match: (i: ReconItem) => boolean }[] = [
  { value: '', label: 'Needs attention', match: (i) => i.status !== 'MATCHED' },
  { value: 'MISMATCH', label: 'Mismatch', match: (i) => i.status === 'MISMATCH' },
  { value: 'MISSING_IN_SYSTEM', label: 'Not in system', match: (i) => i.status === 'MISSING_IN_SYSTEM' },
  { value: 'MISSING_IN_DUMP', label: 'Not in file', match: (i) => i.status === 'MISSING_IN_DUMP' },
  { value: 'WARN', label: 'Matched with notes', match: (i) => i.status === 'MATCHED' && i.issues.length > 0 },
  { value: 'MATCHED', label: 'Matched', match: (i) => i.status === 'MATCHED' },
  { value: 'ALL', label: 'All', match: () => true },
];

export default function ReconRunPage() {
  const { id } = useParams();
  const { values: f, set } = useUrlFilters({ tab: '' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useQuery({ queryKey: ['reconciliation', id], queryFn: () => api.get<ReconRun>(`/reconciliations/${id}`) });
  const { can } = useAuth();
  const confirm = useConfirm();
  const canAdd = can('asset:create') && can('asset:assign');
  const add = useMutation({
    mutationFn: (keys: string[]) => api.post<{ added: number; results: { key: string; ok: boolean; error?: string }[] }>(`/reconciliations/${id}/add-sims`, { keys }),
    onSuccess: async (r) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['reconciliation', id] }), queryClient.invalidateQueries({ queryKey: ['reconciliations'] }), invalidateAssetData()]);
      const failed = r.results.filter((x) => !x.ok);
      if (r.added) toast.success(`${r.added} SIM${r.added > 1 ? 's' : ''} added to the register`);
      if (failed.length) toast.error(`${failed.length} could not be added`, { description: failed.slice(0, 3).map((f) => `${f.key}: ${f.error}`).join('\n') });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const tab = TABS.find((t) => t.value === (f.tab ?? '')) ?? TABS[0];
  const items = useMemo(() => {
    const needle = (f.search ?? '').toLowerCase();
    return (q.data?.items ?? []).filter(
      (i) => tab.match(i) && (!needle || [i.title, i.subtitle, i.key, i.entity?.label, ...i.issues.flatMap((x) => [x.dump, x.system])].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [q.data, tab, f.search]);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const run = q.data;
  const count = (t: (typeof TABS)[number]) => run.items.filter(t.match).length;
  const addable = canAdd ? run.items.filter((i) => i.addSim) : [];
  const assignable = addable.filter((i) => i.addSim?.employeeId).length;
  const addAll = async () => {
    const res = await confirm({
      title: `Add ${addable.length} SIM${addable.length > 1 ? 's' : ''} to the register?`,
      description: `Creates a SIM record for each connection from the Airtel file (number, SIM number, plan, circle, billable account).${assignable ? ` ${assignable} will be assigned to the person whose phone number matches.` : ''}`,
      confirmText: 'Add SIMs',
    });
    if (res.confirmed) add.mutate(addable.map((i) => i.key));
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="xs" asChild>
        <Link to="/reconciliation">
          <ArrowLeft /> All checks
        </Link>
      </Button>
      <PageHeader
        title={`${RECON_SOURCE_LABELS[run.source]} check`}
        description={`${run.fileName} · ${run.rowCount} rows · ${formatDateTime(run.createdAt)}${run.createdByName ? ` · by ${run.createdByName}` : ''}${run.repairedRows ? ` · ${run.repairedRows} broken rows joined` : ''}`}
        actions={
          addable.length > 0 && (
            <Button size="sm" onClick={addAll} loading={add.isPending}>
              <CardSim /> Add {addable.length} to SIM register
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['MATCHED', 'MISMATCH', 'MISSING_IN_SYSTEM', 'MISSING_IN_DUMP'] as ReconStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set({ tab: s })}
            className={cn('cursor-pointer rounded-xl border bg-card p-3 text-left transition hover:shadow-sm', f.tab === s && 'ring-2 ring-primary/40')}
          >
            <Badge tone={STATUS_META[s].tone}>{STATUS_META[s].label}</Badge>
            <div className="mt-1.5 text-2xl font-semibold tabular">{run.summary[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {TABS.map((t) => {
          const n = count(t);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ tab: t.value })}
              className={cn(
                'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                tab.value === t.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t.label} <span className="ml-0.5 tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={run.source === 'AIRTEL' ? 'Search number, plan, person…' : 'Search name, employee ID, asset…'} className="pl-8" />
          </div>
        </div>
        {!items.length ? (
          <EmptyState icon={CheckCircle2} title={tab.value === '' ? 'Everything matches' : 'Nothing here'} description={tab.value === '' ? 'The file and the system agree.' : undefined} />
        ) : (
          <ul className="divide-y">
            {items.map((i, n) => (
              <ItemRow key={`${i.key}-${n}`} item={i} onAddSim={canAdd && i.addSim ? () => add.mutate([i.key]) : undefined} adding={add.isPending && add.variables?.length === 1 && add.variables[0] === i.key} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ItemRow({ item, onAddSim, adding }: { item: ReconItem; onAddSim?: () => void; adding?: boolean }) {
  const meta = STATUS_META[item.status];
  const link = item.entity ? (item.entity.kind === 'ASSET' ? `/assets/${item.entity.id}` : `/employees/${item.entity.id}`) : null;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.title}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {link && (
            <Link to={link} className="text-xs font-medium text-primary hover:underline">
              {item.entity!.label} →
            </Link>
          )}
          {onAddSim && (
            <Button size="xs" variant="outline" onClick={onAddSim} loading={adding}>
              <Plus /> {item.addSim?.employeeName ? `Add SIM & assign to ${item.addSim.employeeName}` : 'Add to SIM register'}
            </Button>
          )}
        </div>
      </div>
      {item.issues.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Check</th>
                <th className="px-2.5 py-1.5 font-medium">In the file</th>
                <th className="px-2.5 py-1.5 font-medium">In the system</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {item.issues.map((x, k) => (
                <tr key={k} className={x.level === 'error' ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <span className={cn('inline-flex items-center gap-1 font-medium', x.level === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300')}>
                      <AlertTriangle className="size-3" /> {x.label}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 break-all">{x.dump ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2.5 py-1.5 break-all">{x.system ?? <span className="text-muted-foreground">not recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}
