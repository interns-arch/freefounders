/** /tasks/forms/:formId/submissions — every submission of a form, one opened at a time, and the CSV export. */
import { errorMessage } from '@freefounders/core';
import { type FormSubmission, useExportFormCsv, useFormSubmissions, useWebForm } from '@freefounders/core/tasks';
import { Download, Inbox, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DetailList, EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorNote, Panel, fmtWhen } from '../general/parts';
import { downloadBlob } from '../shared/csv';

export function FormSubmissionsPage() {
  const { formId } = useParams();
  const id = Number(formId);
  const form = useWebForm(Number.isFinite(id) ? id : null);
  const subs = useFormSubmissions(Number.isFinite(id) ? id : null);
  const exportCsv = useExportFormCsv();
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const download = () => {
    setErr('');
    exportCsv.mutate(id, {
      onSuccess: (blob) => void downloadBlob(`${form.data?.name ?? 'form'}-submissions.csv`, blob),
      onError: (e) => setErr(errorMessage(e)),
    });
  };
  const fieldLabel = (fid: string | number) => form.data?.fields.find((f) => String(f.id) === String(fid))?.label || `#${fid}`;
  const current = subs.data?.find((s) => s.id === open);

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        className="mb-0"
        title={form.data ? `${form.data.name} — submissions` : 'Submissions'}
        breadcrumb={[
          { label: 'Forms', to: '/tasks/forms' },
          { label: 'My forms', to: '/tasks/forms?view=manage' },
          ...(form.data ? [{ label: form.data.name, to: `/tasks/forms/${form.data.id}` }] : []),
        ]}
        actions={
          !!subs.data?.length && (
            <Button onClick={download} loading={exportCsv.isPending}>
              <Download /> Export CSV
            </Button>
          )
        }
      />
      <ErrorNote>{err}</ErrorNote>
      {(subs.error || form.error) && <ErrorState error={subs.error ?? form.error} onRetry={() => subs.refetch()} />}
      {!subs.data && !subs.error && <Skeleton className="h-40" />}
      {subs.data?.length === 0 && (
        <Card>
          <EmptyState
            icon={Inbox}
            title="No submissions yet"
            description="Share the form link to start collecting."
            action={
              form.data && (
                <Button asChild variant="outline">
                  <Link to={`/tasks/forms/${form.data.id}`}>Open the builder</Link>
                </Button>
              )
            }
          />
        </Card>
      )}
      {!!subs.data?.length && (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>Date</TH>
                <TH>Person</TH>
                <TH>Lead</TH>
                <TH>Task</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {subs.data.map((s) => (
                <TR key={s.id}>
                  <TD className="font-mono text-xs">#{s.id}</TD>
                  <TD className="whitespace-nowrap">{fmtWhen(s.created_at)}</TD>
                  <TD className="font-medium">{s.person}</TD>
                  <TD>{s.lead_name || '—'}</TD>
                  <TD>{s.task ? <Link to={`/tasks/tasks/${s.task}`} className="text-primary hover:underline">{s.task_title}</Link> : '—'}</TD>
                  <TD className="text-right">
                    <Button size="xs" variant="outline" aria-expanded={open === s.id} aria-label={`${open === s.id ? 'Hide' : 'View'} submission ${s.id}`} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? 'Hide' : 'View'}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {current && <SubmissionDetail s={current} fieldLabel={fieldLabel} />}
    </div>
  );
}

function SubmissionDetail({ s, fieldLabel }: { s: FormSubmission; fieldLabel: (fid: string | number) => string }) {
  return (
    <Panel title={`Submission #${s.id}`} description={`${s.person} · ${fmtWhen(s.created_at)}`}>
      <DetailList
        columns={2}
        items={[
          ...Object.entries(s.answers).map(([fid, v]) => ({ label: fieldLabel(fid), value: Array.isArray(v) ? v.join(', ') : String(v) })),
          ...s.files.map((f) => ({
            label: fieldLabel(f.field_id),
            value: (
              <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <Paperclip className="size-3.5" /> {f.filename}
              </a>
            ),
          })),
        ]}
      />
    </Panel>
  );
}
