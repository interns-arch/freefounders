/**
 * Import attendance (hr.import, PLAN.md §19.15, §19.19): download the template, upload an XLSX/CSV, check every row (dry run), then
 * "Import N rows". This is how a company brings its old attendance across (e.g. from SalaryBox).
 */
import { errorMessage } from '@freefounders/core';
import { type ImportResult, type ImportRow, useImportAttendance, useImportTemplate } from '@freefounders/core/hr';
import { CheckCircle2, Download, FileUp } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { type Column, DataTable } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { Chip, ErrorNote } from '../tasks/general/parts';
import { downloadBlob } from '../tasks/shared/csv';

const STATUS_LABEL: Record<string, string> = { present: 'Present', half_day: 'Half day', absent: 'Absent', leave: 'Leave' };
const dmy = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('-') : d);

const columns: Column<ImportRow>[] = [
  {
    key: 'person',
    header: 'Employee',
    cell: (r) => (
      <span className="min-w-0">
        <span className="block font-semibold">{r.name || r.employee_id || '—'}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          Row {r.line}
          {r.name && r.employee_id ? ` · ${r.employee_id}` : ''}
        </span>
      </span>
    ),
  },
  { key: 'date', header: 'Date', className: 'whitespace-nowrap font-mono tabular-nums', cell: (r) => dmy(r.date) || '—' },
  { key: 'times', header: 'In – out', className: 'whitespace-nowrap font-mono tabular-nums', cell: (r) => (r.check_in ? `${r.check_in} – ${r.check_out || '…'}` : '—') },
  { key: 'status', header: 'Status', cell: (r) => STATUS_LABEL[r.status] ?? (r.status || '—') },
  {
    key: 'result',
    header: 'Check',
    cell: (r) =>
      r.ok ? (
        <Chip tone="success">OK</Chip>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip tone="danger">Error</Chip>
          <span className="text-sm text-destructive">{r.error}</span>
        </span>
      ),
  },
];

export function ImportAttendanceDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const template = useImportTemplate();
  const upload = useImportAttendance();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [tried, setTried] = useState(false);

  const ok = preview?.rows.filter((r) => r.ok).length ?? 0;
  const bad = (preview?.rows.length ?? 0) - ok;

  const check = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!file) return;
    setResult(null);
    upload.mutate({ file, dryRun: true }, { onSuccess: setPreview });
  };
  const apply = () => file && upload.mutate({ file, dryRun: false }, { onSuccess: setResult });
  const getTemplate = (format: 'xlsx' | 'csv') => template.mutate(format, { onSuccess: ({ filename, blob }) => downloadBlob(filename, blob) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import attendance</DialogTitle>
          <DialogDescription>
            One row per person per day: Employee ID, Date (YYYY-MM-DD), Check in and Check out (HH:MM), Status (present, half_day, absent or leave; blank = worked out from the times) and a Note. A day that already exists is overwritten.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3" role="status">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-success">
              <CheckCircle2 className="size-5" /> Import finished
            </p>
            <p className="text-sm">
              Created <strong>{result.created}</strong> · Updated <strong>{result.updated}</strong> · Skipped <strong>{result.skipped}</strong>
            </p>
            {result.skipped_rows.length > 0 && (
              <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-muted-foreground" aria-label="Skipped rows">
                {result.skipped_rows.map((s) => (
                  <li key={s.line}>
                    Row {s.line}: {s.error}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
              <span className="font-medium">Template:</span>
              <Button size="xs" variant="outline" onClick={() => getTemplate('xlsx')} disabled={template.isPending} aria-label="Download the template (XLSX)">
                <Download /> XLSX
              </Button>
              <Button size="xs" variant="outline" onClick={() => getTemplate('csv')} disabled={template.isPending} aria-label="Download the template (CSV)">
                <Download /> CSV
              </Button>
            </div>
            <form onSubmit={check} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`${id}-file`}>Attendance file (.xlsx or .csv)</Label>
                <Input
                  id={`${id}-file`}
                  type="file"
                  accept=".xlsx,.csv"
                  aria-invalid={tried && !file}
                  aria-describedby={tried && !file ? `${id}-file-error` : undefined}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
              </div>
              <Button type="submit" variant="outline" loading={upload.isPending && !preview}>
                <FileUp /> Check file
              </Button>
            </form>
            {tried && !file && (
              <p id={`${id}-file-error`} className="-mt-2 text-sm text-destructive">
                Choose a file first.
              </p>
            )}
            {template.error && <ErrorNote>{errorMessage(template.error)}</ErrorNote>}
            {upload.error && <ErrorNote>{errorMessage(upload.error)}</ErrorNote>}
            {preview && (
              <div className="grid gap-2">
                <p className="text-sm" aria-live="polite">
                  <strong>{ok}</strong> ready ({preview.created} new, {preview.updated} {preview.updated === 1 ? 'update' : 'updates'}) · <strong className={bad ? 'text-destructive' : undefined}>{bad}</strong> with errors
                </p>
                <Card className="max-h-[45dvh] overflow-auto">
                  <DataTable columns={columns} rows={preview.rows} rowKey={(r) => String(r.line)} />
                </Card>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {preview && (
                <Button onClick={apply} disabled={ok === 0} loading={upload.isPending}>
                  Import {ok} row{ok === 1 ? '' : 's'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
