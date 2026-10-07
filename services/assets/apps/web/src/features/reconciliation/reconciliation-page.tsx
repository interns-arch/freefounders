import { detectSource, extractRows, RECON_COLUMNS, RECON_SOURCE_LABELS, type ReconSource } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CardSim, FileSpreadsheet, GitCompareArrows, ShieldCheck, Upload, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import { SummaryChips } from './summary';

export interface ReconRunSummary {
  id: string;
  source: ReconSource;
  fileName: string;
  rowCount: number;
  summary: Record<string, number>;
  createdByName: string | null;
  createdAt: string;
}

interface Parsed {
  source: ReconSource;
  fileName: string;
  sheet: string;
  rows: Record<string, string | null>[];
  repaired: number;
  missingColumns: string[];
}

const SOURCES: { source: ReconSource; icon: typeof CardSim; perm: 'asset:assign' | 'employee:manage'; hint: string }[] = [
  { source: 'AIRTEL', icon: CardSim, perm: 'asset:assign', hint: 'Connections export from the Airtel business portal. Checked against the SIM register.' },
  { source: 'SALARYBOX', icon: Users, perm: 'employee:manage', hint: 'Employee export from Salary Box. Checked against employees and the laptops / SIMs they hold.' },
];

async function parseFile(file: File, expected: ReconSource): Promise<Parsed> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  let sheets;
  try {
    sheets = await readXlsxFile(file);
  } catch {
    throw new Error('Could not read this file. Save it as an Excel workbook (.xlsx) and try again.');
  }
  for (const s of sheets) {
    const found = detectSource(s.data);
    if (!found) continue;
    if (found.source !== expected) throw new Error(`This looks like a ${RECON_SOURCE_LABELS[found.source]} file — use the other upload button.`);
    const { rows, repaired, missingColumns } = extractRows(s.data, found.source, found.headerRow);
    if (!rows.length) throw new Error('No data rows found under the header.');
    return { source: found.source, fileName: file.name, sheet: s.sheet, rows, repaired, missingColumns };
  }
  throw new Error(`Could not find the ${RECON_SOURCE_LABELS[expected]} header row (e.g. “${RECON_COLUMNS[expected][0].label}”) in any sheet.`);
}

export default function ReconciliationPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState<ReconSource | null>(null);
  const runs = useQuery({ queryKey: ['reconciliations'], queryFn: () => api.get<ReconRunSummary[]>('/reconciliations') });

  const submit = useMutation({
    mutationFn: (p: Parsed) => api.post<{ id: string }>('/reconciliations', { source: p.source, fileName: p.fileName, repairedRows: p.repaired, rows: p.rows }),
    onSuccess: async (res) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['reconciliations'] }), queryClient.invalidateQueries({ queryKey: ['notifications'] })]);
      toast.success('Check complete — the team has been notified');
      setParsed(null);
      navigate(`/reconciliation/${res.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const pick = async (source: ReconSource, file: File | undefined) => {
    if (!file) return;
    setReading(source);
    try {
      setParsed(await parseFile(file, source));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReading(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reconciliation" description="Upload the latest Airtel or Salary Box dump. Every upload is checked against this system and the team gets a notification with the result." />

      <div className="grid gap-4 md:grid-cols-2">
        {SOURCES.filter((s) => can(s.perm)).map((s) => (
          <Card key={s.source}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <div>
                  <CardTitle className="text-base">{RECON_SOURCE_LABELS[s.source]}</CardTitle>
                  <CardDescription>{s.hint}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary', reading === s.source && 'pointer-events-none opacity-60')}>
                <Upload className="size-4" />
                {reading === s.source ? 'Reading…' : 'Choose Excel file (.xlsx)'}
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
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-4 text-primary" /> {parsed.fileName}
              </CardTitle>
              <CardDescription>
                {RECON_SOURCE_LABELS[parsed.source]} · sheet “{parsed.sheet}” · {parsed.rows.length} records
                {parsed.repaired ? ` · ${parsed.repaired} broken rows joined back together` : ''}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {parsed.missingColumns.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Columns not found (they will not be checked): {parsed.missingColumns.join(', ')}</p>}
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>
                Only these columns are sent: {RECON_COLUMNS[parsed.source].map((c) => c.label).join(', ')}. Everything else in the file (Aadhaar, PAN, bank, UAN, addresses…) stays on this computer; long card numbers are masked.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setParsed(null)}>
                Cancel
              </Button>
              <Button loading={submit.isPending} onClick={() => submit.mutate(parsed)}>
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
          <EmptyState icon={GitCompareArrows} title="No checks yet" description="Upload a dump above to run the first one." />
        ) : (
          <ul className="divide-y border-t">
            {runs.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/reconciliation/${r.id}`)} className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-left transition hover:bg-muted/50">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Badge tone={r.source === 'AIRTEL' ? 'red' : 'violet'}>{r.source === 'AIRTEL' ? 'Airtel' : 'Salary Box'}</Badge>
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
