/**
 * Admin → People → Import (PLAN.md §19.40): download the template, upload a CSV/XLSX, see every row checked (errors
 * per row, seats left), then "Import N people". Each person is added like "Add person": a login with a generated
 * password when they have an email or employee ID, and the Admin or Member role. The passwords are shown once, with a
 * sign-in sheet to download.
 */
import { errorMessage } from '@freefounders/core';
import { type PeopleImportPreview, type PeopleImportResult, type PeopleImportRow, useImportPeople, usePeopleImportPreview, usePeopleImportTemplate } from '@freefounders/core/admin';
import { toCsv } from '@freefounders/core/export';
import { CheckCircle2, Download, FileUp } from '@/components/icons';
import { type FormEvent, useId, useState } from 'react';
import { type Column, DataTable } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { Chip, ErrorNote } from '../tasks/general/parts';
import { downloadBlob } from '../tasks/shared/csv';

const columns: Column<PeopleImportRow>[] = [
  {
    key: 'person',
    header: 'Person',
    cell: (r) => (
      <span className="min-w-0">
        <span className="block font-semibold">{r.fullName || '—'}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          Row {r.line}
          {r.email ? ` · ${r.email}` : ''}
          {r.employeeCode ? ` · ${r.employeeCode}` : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'work',
    header: 'Department · designation',
    cell: (r) => [r.department, r.designation].filter(Boolean).join(' · ') || '—',
  },
  { key: 'role', header: 'Role', cell: (r) => (r.level === 'admin' ? 'Admin' : 'Member') },
  {
    key: 'check',
    header: 'Check',
    cell: (r) =>
      r.errors.length ? (
        <span className="grid gap-1">
          <Chip tone="danger">Error</Chip>
          {r.errors.map((e) => (
            <span key={e} className="text-sm text-destructive">
              {e}
            </span>
          ))}
        </span>
      ) : (
        <span className="grid gap-1">
          <Chip tone="success">OK</Chip>
          {r.warnings.map((w) => (
            <span key={w} className="text-xs text-muted-foreground">
              {w}
            </span>
          ))}
        </span>
      ),
  },
];

function seatsText(p: PeopleImportPreview): string {
  if (p.seats.limit === null) return '';
  return ` · ${p.seats.free} of ${p.seats.limit} seats free`;
}

export function ImportPeopleDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const template = usePeopleImportTemplate();
  const check = usePeopleImportPreview();
  const run = useImportPeople();
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const [preview, setPreview] = useState<PeopleImportPreview | null>(null);
  const [result, setResult] = useState<PeopleImportResult | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!file) return;
    check.mutate(file, { onSuccess: setPreview });
  };
  const getTemplate = (format: 'xlsx' | 'csv') => template.mutate(format, { onSuccess: ({ filename, blob }) => downloadBlob(filename, blob) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import people</DialogTitle>
          <DialogDescription>
            One row per person: Name, Email, Mobile, Employee ID, Department, Designation, Reports to (their employee ID or email), Join date and Role (Admin or Member). Each person gets a login when they have an email or employee ID.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <ImportDone result={result} onClose={onClose} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
              <span className="font-medium">Template:</span>
              <Button size="xs" variant="outline" onClick={() => getTemplate('xlsx')} disabled={template.isPending} aria-label="Download the people template (XLSX)">
                <Download /> XLSX
              </Button>
              <Button size="xs" variant="outline" onClick={() => getTemplate('csv')} disabled={template.isPending} aria-label="Download the people template (CSV)">
                <Download /> CSV
              </Button>
            </div>
            <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`${id}-file`}>People file (.xlsx or .csv)</Label>
                <Input
                  id={`${id}-file`}
                  type="file"
                  accept=".xlsx,.csv"
                  aria-invalid={tried && !file}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
              </div>
              <Button type="submit" variant="outline" loading={check.isPending}>
                <FileUp /> Check file
              </Button>
            </form>
            {tried && !file && <p className="-mt-2 text-sm text-destructive">Choose a file first.</p>}
            {template.error && <ErrorNote>{errorMessage(template.error)}</ErrorNote>}
            {check.error && <ErrorNote>{errorMessage(check.error)}</ErrorNote>}
            {run.error && <ErrorNote>{errorMessage(run.error)}</ErrorNote>}
            {preview && (
              <div className="grid gap-2">
                <p className="text-sm" aria-live="polite">
                  <strong>{preview.ready}</strong> ready · <strong className={preview.problems ? 'text-destructive' : undefined}>{preview.problems}</strong> with errors
                  {seatsText(preview)}
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
                <Button onClick={() => run.mutate(preview.rows, { onSuccess: setResult })} disabled={preview.ready === 0} loading={run.isPending}>
                  Import {preview.ready} {preview.ready === 1 ? 'person' : 'people'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportDone({ result, onClose }: { result: PeopleImportResult; onClose: () => void }) {
  const withPassword = result.results.filter((r) => r.status === 'added' && r.password);
  const skipped = result.results.filter((r) => r.status === 'skipped');
  const sheet = () =>
    downloadBlob(
      'people-sign-in-sheet.csv',
      new Blob([toCsv({ header: ['Name', 'Sign in with', 'Password'], rows: withPassword.map((r) => [r.fullName, r.signIn ?? '', r.password ?? '']) }) as Uint8Array<ArrayBuffer>], { type: 'text/csv' }),
    );
  return (
    <div className="grid gap-3" role="status">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-success">
        <CheckCircle2 className="size-5" /> Import finished
      </p>
      <p className="text-sm">
        Added <strong>{result.added}</strong> · Skipped <strong>{result.skipped}</strong>
      </p>
      {withPassword.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm">
          <p>
            {withPassword.length} {withPassword.length === 1 ? 'person has' : 'people have'} a new login with a generated password. It is shown only now: download the sign-in sheet and
            share each line with that person. They can change the password from their account menu.
          </p>
          <div>
            <Button size="sm" variant="outline" onClick={sheet}>
              <Download /> Sign-in sheet (CSV)
            </Button>
          </div>
        </div>
      )}
      {skipped.length > 0 && (
        <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-muted-foreground" aria-label="Skipped rows">
          {skipped.map((s) => (
            <li key={s.line}>
              Row {s.line} ({s.fullName || 'no name'}): {s.error}
            </li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  );
}
