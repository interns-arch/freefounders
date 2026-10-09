import { RECON_COLUMNS, RECON_SOURCE_LABELS, type ReconSource } from '@eam/shared';
import { CardSim, FileSpreadsheet, GitCompareArrows, ShieldCheck, Upload, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { useAuth, useModules } from '@/features/assets/lib/auth';
import { errorMessage } from '@freefounders/core';
import { useInvalidateReconciliation, useReconciliations, useRunReconciliation } from '@freefounders/core/assets';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import { parseDumpFile, type ParsedDump } from './parse';
import { SummaryChips } from './summary';

const SOURCES: { source: ReconSource; icon: typeof CardSim; perm: 'asset:assign' | 'employee:manage'; hint: string }[] = [
  { source: 'AIRTEL', icon: CardSim, perm: 'asset:assign', hint: 'Connections export from the Airtel business portal. Checked against the SIM register.' },
  { source: 'SALARYBOX', icon: Users, perm: 'employee:manage', hint: 'Employee export from Salary Box. Checked against employees and the laptops / SIMs they hold.' },
];

export const SOURCE_SHORT: Record<ReconSource, string> = { AIRTEL: 'Airtel', SALARYBOX: 'Salary Box' };
export const SOURCE_TONE = { AIRTEL: 'red', SALARYBOX: 'violet' } as const;

/**
 * Reconciliation: upload the latest Airtel / Salary Box dump, see what the browser read, send only the known
 * columns to be checked, then open the report. Previous checks are listed below (newest first).
 */
export default function ReconciliationPage() {
  const { can } = useAuth();
  const module = useModules();
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<ParsedDump | null>(null);
  const [reading, setReading] = useState<ReconSource | null>(null);
  const runs = useReconciliations();
  const refresh = useInvalidateReconciliation();
  const submit = useRunReconciliation({
    onSuccess: async (res) => {
      await refresh();
      toast.success('Check complete — the team has been notified');
      setParsed(null);
      navigate(`/assets/reconciliation/${res.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!module('sims')) {
    return <EmptyState icon={GitCompareArrows} title="Reconciliation is switched off" description="It comes with the SIM cards module; an admin can switch it on in the company settings." />;
  }

  const pick = async (source: ReconSource, file: File | undefined) => {
    if (!file) return;
    setReading(source);
    try {
      setParsed(await parseDumpFile(file, source));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReading(null);
    }
  };

  const sources = SOURCES.filter((s) => can(s.perm));

  return (
    <div className="space-y-5">
      <PageHeader title="Reconciliation" description="Upload the latest Airtel or Salary Box dump. Every upload is checked against this system and the team gets a notification with the result." />

      <div className="grid gap-4 md:grid-cols-2">
        {sources.map((s) => (
          <Card key={s.source}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-base">{RECON_SOURCE_LABELS[s.source]}</CardTitle>
                  <CardDescription>{s.hint}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <label
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
                  reading === s.source && 'pointer-events-none opacity-60',
                )}
              >
                <Upload className="size-4 shrink-0" />
                {reading === s.source ? 'Reading…' : `Choose ${SOURCE_SHORT[s.source]} file (.xlsx)`}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    void pick(s.source, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </CardContent>
          </Card>
        ))}
      </div>

      {parsed && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-4 shrink-0 text-primary" /> <span className="truncate">{parsed.fileName}</span>
              </CardTitle>
              <CardDescription>
                {RECON_SOURCE_LABELS[parsed.source]} · sheet “{parsed.sheet}” · {parsed.rows.length} records
                {parsed.repaired ? ` · ${parsed.repaired} broken rows joined back together` : ''}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {parsed.missingColumns.length > 0 && (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">Columns not found (they will not be checked): {parsed.missingColumns.join(', ')}</p>
            )}
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                Only these columns are sent: {RECON_COLUMNS[parsed.source].map((c) => c.label).join(', ')}. Everything else in the file (Aadhaar, PAN, bank, UAN, addresses…) stays on this computer; long card numbers are masked.
              </span>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setParsed(null)}>
                Cancel
              </Button>
              <Button loading={submit.isPending} onClick={() => submit.mutate({ source: parsed.source, fileName: parsed.fileName, repairedRows: parsed.repaired, rows: parsed.rows })}>
                <GitCompareArrows /> Check against system
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Previous checks</CardTitle>
            <CardDescription>Each upload is kept as a report</CardDescription>
          </div>
        </CardHeader>
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
        ) : runs.isLoading ? (
          <CardContent>
            <Skeleton className="h-24" />
          </CardContent>
        ) : !runs.data?.length ? (
          <EmptyState icon={GitCompareArrows} title="No checks yet" description={sources.length ? 'Upload a dump above to run the first one.' : 'You cannot run checks with your permissions.'} />
        ) : (
          <ul className="divide-y border-t">
            {runs.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/assets/reconciliation/${r.id}`)} className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition hover:bg-muted/50 sm:px-5">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex min-w-0 items-center gap-2 font-medium">
                      <Badge tone={SOURCE_TONE[r.source]}>{SOURCE_SHORT[r.source]}</Badge>
                      <span className="truncate">{r.fileName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground" title={formatDateTime(r.createdAt)}>
                      {relativeTime(r.createdAt)} · {r.rowCount} rows{r.createdByName ? ` · by ${r.createdByName}` : ''}
                    </div>
                  </div>
                  <SummaryChips summary={r.summary} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
