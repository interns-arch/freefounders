/**
 * /tasks/forms — web forms (old pages/Forms.jsx). "Fill": the published forms anyone signed in may fill.
 * "My forms" (?view=manage, forms.build; forms.all sees every form): create, build, publish and read submissions.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import { type FormStatus, type WebForm, useCreateForm, useFormAction, useManagedForms, usePublishedForms } from '@freefounders/core/tasks';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Chip, ErrorNote, Segmented, type Tone } from '../general/parts';

export const FORM_STATUS_TONE: Record<FormStatus, Tone> = { draft: 'neutral', published: 'success', closed: 'warning' };

export function FormsPage() {
  const access = useAccess();
  const canBuild = access.tasks.can('forms.build') || access.tasks.can('forms.all');
  const [params, setParams] = useSearchParams();
  const mode = canBuild && params.get('view') === 'manage' ? 'manage' : 'fill';
  const setMode = (m: 'fill' | 'manage') => {
    const next = new URLSearchParams(params);
    if (m === 'manage') next.set('view', 'manage');
    else next.delete('view');
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Forms"
        description={mode === 'fill' ? 'Forms you can fill in right here.' : 'Build a form, share its link, collect submissions.'}
        actions={
          canBuild && (
            <Segmented
              label="Forms view"
              value={mode}
              onChange={setMode}
              options={[
                ['fill', 'Fill'],
                ['manage', 'My forms'],
              ]}
            />
          )
        }
      />
      {mode === 'fill' ? <FillList /> : <ManageList />}
    </div>
  );
}

function FillList() {
  const q = usePublishedForms();
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40" />;
  if (q.data.length === 0)
    return (
      <Card>
        <EmptyState icon={FileText} title="No published forms right now" />
      </Card>
    );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Forms to fill">
      {q.data.map((f) => (
        <li key={f.id}>
          <Link to={`/tasks/forms/${f.id}/fill`} className="block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <Card className="flex h-full flex-col gap-1 p-4 transition hover:border-primary/40 hover:shadow-sm">
              <span className="text-sm font-semibold">{f.name}</span>
              {f.description && <span className="line-clamp-3 text-sm text-muted-foreground">{f.description}</span>}
              <span className="mt-auto pt-2 text-xs text-muted-foreground">
                {f.fields.length} field{f.fields.length === 1 ? '' : 's'}
              </span>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ManageList() {
  const navigate = useNavigate();
  const q = useManagedForms();
  const create = useCreateForm();
  const action = useFormAction();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const make = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setErr('');
    create.mutate(name.trim(), { onSuccess: (f) => navigate(`/tasks/forms/${f.id}`), onError: (x) => setErr(errorMessage(x)) });
  };
  const remove = async (f: WebForm) => {
    const r = await confirm({ title: `Delete the form "${f.name}"?`, description: 'Only a form without submissions can be deleted; close it instead to stop collecting.', confirmText: 'Delete', destructive: true });
    if (!r.confirmed) return;
    setErr('');
    action.mutate({ id: f.id, action: 'delete' }, { onError: (x) => setErr(errorMessage(x)) });
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3">
      <form onSubmit={make} className="flex flex-wrap items-center gap-2">
        <Input aria-label="New form name" placeholder="New form name…" className="w-full sm:w-72" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
          <Plus /> Create form
        </Button>
      </form>
      <ErrorNote>{err}</ErrorNote>
      {q.data.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No forms yet" description="Create your first one above." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Form</TH>
                <TH>Status</TH>
                <TH>Fields</TH>
                <TH>Submissions</TH>
                <TH>Integrations</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {q.data.map((f) => (
                <TR key={f.id}>
                  <TD>
                    <Link to={`/tasks/forms/${f.id}`} className="font-semibold hover:underline">
                      {f.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">by {f.created_by_detail?.name ?? '—'}</div>
                  </TD>
                  <TD>
                    <Chip tone={FORM_STATUS_TONE[f.status] ?? 'neutral'}>{f.status_display}</Chip>
                  </TD>
                  <TD>{f.fields.length}</TD>
                  <TD>{f.submission_count}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {f.create_lead && <Chip tone="primary">→ Lead</Chip>}
                      {f.create_task && <Chip tone="primary">→ Task</Chip>}
                      {!f.create_lead && !f.create_task && <span className="text-muted-foreground">—</span>}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button asChild size="xs" variant="outline">
                        <Link to={`/tasks/forms/${f.id}`} aria-label={`Build ${f.name}`}>
                          Build
                        </Link>
                      </Button>
                      <Button asChild size="xs" variant="outline">
                        <Link to={`/tasks/forms/${f.id}/submissions`} aria-label={`Submissions of ${f.name}`}>
                          Submissions
                        </Link>
                      </Button>
                      {f.submission_count === 0 && (
                        <Button size="xs" variant="ghost" aria-label={`Delete ${f.name}`} onClick={() => remove(f)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
