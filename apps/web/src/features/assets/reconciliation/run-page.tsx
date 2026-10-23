import { RECON_SOURCE_LABELS, type ReconStatus } from '@eam/shared';
import { SearchField } from '@/components/common/search-field';
import { AlertTriangle, ArrowLeft, CardSim, CheckCircle2, Plus } from '@/components/icons';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader, PageLoader, BACK_LINK } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { useAuth } from '@/features/assets/lib/auth';
import { errorMessage } from '@freefounders/core';
import { type ReconItem, useAddReconSims, useInvalidateReconciliation, useReconciliation } from '@freefounders/core/assets';
import { useSearchBox, useUrlFilters } from '@/lib/url-state';
import { cn, formatDateTime } from '@/lib/utils';
import { chipActiveClass, chipClass, chipIdleClass } from '@/components/common/controls';
import { STATUS_META } from './summary';
import { DownloadMenu } from '@/components/common/download-menu';
import { fileSlug } from '@freefounders/core/export';

const TABS: { value: string; label: string; match: (i: ReconItem) => boolean; whenEmpty?: boolean }[] = [
  { value: '', label: 'Needs attention', match: (i) => i.status !== 'MATCHED' },
  { value: 'MISMATCH', label: 'Mismatch', match: (i) => i.status === 'MISMATCH' },
  { value: 'MISSING_IN_SYSTEM', label: 'Not in system', match: (i) => i.status === 'MISSING_IN_SYSTEM' },
  { value: 'MISSING_IN_DUMP', label: 'Not in file', match: (i) => i.status === 'MISSING_IN_DUMP' },
  // Rows the file itself got wrong (no number, listed twice): only shown when there are any.
  { value: 'INVALID', label: 'Invalid rows', match: (i) => i.status === 'INVALID', whenEmpty: false },
  { value: 'WARN', label: 'Matched with notes', match: (i) => i.status === 'MATCHED' && i.issues.length > 0 },
  { value: 'MATCHED', label: 'Matched', match: (i) => i.status === 'MATCHED' },
  { value: 'ALL', label: 'All', match: () => true },
];
const TILES: ReconStatus[] = ['MATCHED', 'MISMATCH', 'MISSING_IN_SYSTEM', 'MISSING_IN_DUMP'];

const SOURCE_SLUG = { AIRTEL: 'airtel', SALARYBOX: 'salary-box' } as const;

/** One check: counts by status, a filter per status, search, and (Airtel) adding missing connections to the SIM register. */
export default function ReconRunPage() {
  const { id } = useParams();
  const { values: f, set } = useUrlFilters({ tab: '' });
  const [search, setSearch] = useSearchBox(f.search ?? '', (v) => set({ search: v }));
  const q = useReconciliation(id);
  const { can } = useAuth();
  const confirm = useConfirm();
  const refresh = useInvalidateReconciliation();
  const canAdd = can('asset:create') && can('asset:assign');
  const add = useAddReconSims({
    onSuccess: async (r) => {
      await refresh(id, true);
      const failed = r.results.filter((x) => !x.ok);
      if (r.added) toast.success(`${r.added} SIM${r.added > 1 ? 's' : ''} added to the register`);
      if (failed.length) toast.error(`${failed.length} could not be added`, { description: failed.slice(0, 3).map((x) => `${x.key}: ${x.error}`).join('\n') });
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
    if (res.confirmed) add.mutate({ id: run.id, keys: addable.map((i) => i.key) });
  };

  return (
    <div className="space-y-4">
      <Link to="/assets/reconciliation" className={BACK_LINK}>
        <ArrowLeft /> All checks
      </Link>
      <PageHeader
        title={`${RECON_SOURCE_LABELS[run.source]} check`}
        description={`${run.fileName} · ${run.rowCount} rows · ${formatDateTime(run.createdAt)}${run.createdByName ? ` · by ${run.createdByName}` : ''}${run.repairedRows ? ` · ${run.repairedRows} broken rows joined` : ''}`}
        actions={
          <>
            <DownloadMenu
              filename={fileSlug('assets', 'reconciliation', SOURCE_SLUG[run.source], run.createdAt.slice(0, 10), tab.value || 'all', f.search)}
              rows={() => ({
                title: 'Reconciliation',
                header: ['Result', 'Key', 'Row', 'Details', 'Linked to', 'Issues'],
                rows: items.map((i) => [
                  STATUS_META[i.status].label,
                  i.key,
                  i.title,
                  i.subtitle,
                  i.entity?.label,
                  i.issues.map((x) => `${x.label}: file ${x.dump ?? '—'} / system ${x.system ?? '—'}`).join('; '),
                ]),
              })}
              empty={!items.length}
            />
            {addable.length > 0 && (
              <Button size="sm" onClick={addAll} loading={add.isPending}>
                <CardSim /> Add {addable.length} to SIM register
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set({ tab: f.tab === s ? '' : s })}
            aria-pressed={f.tab === s}
            className={cn('cursor-pointer rounded-xl border bg-card p-3 text-left transition hover:shadow-sm', f.tab === s && 'ring-2 ring-primary/40')}
          >
            <Badge tone={STATUS_META[s].tone}>{STATUS_META[s].label}</Badge>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular">{run.summary[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Rows by result">
        {TABS.filter((t) => t.whenEmpty !== false || count(t) > 0).map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab.value === t.value}
            onClick={() => set({ tab: t.value })}
            className={cn(
              chipClass,
              tab.value === t.value ? chipActiveClass : chipIdleClass,
            )}
          >
            {t.label} <span className="ml-0.5 tabular opacity-70">{count(t)}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <SearchField className="relative max-w-md" label="Search rows" placeholder={run.source === 'AIRTEL' ? 'Search number, plan, person…' : 'Search name, employee ID, asset…'} value={search} onChange={setSearch} />
        </div>
        {!items.length ? (
          <EmptyState icon={CheckCircle2} title={tab.value === '' ? 'Everything matches' : 'Nothing here'} description={tab.value === '' ? 'The file and the system agree.' : undefined} />
        ) : (
          <ul className="divide-y">
            {items.map((i, n) => (
              <ItemRow
                key={`${i.key}-${n}`}
                item={i}
                onAddSim={canAdd && i.addSim ? () => add.mutate({ id: run.id, keys: [i.key] }) : undefined}
                adding={add.isPending && add.variables?.keys.length === 1 && add.variables.keys[0] === i.key}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ItemRow({ item, onAddSim, adding }: { item: ReconItem; onAddSim?: () => void; adding?: boolean }) {
  const meta = STATUS_META[item.status];
  const link = item.entity ? (item.entity.kind === 'ASSET' ? `/assets/assets/${item.entity.id}` : `/assets/employees/${item.entity.id}`) : null;
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
          {link && item.entity && (
            <Link to={link} className="text-xs font-medium text-primary hover:underline">
              {item.entity.label} →
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
                <tr key={k} className={x.level === 'error' ? 'bg-destructive/5' : ''}>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <span className={cn('inline-flex items-center gap-1 font-medium', x.level === 'error' ? 'text-destructive' : 'text-warning')}>
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
