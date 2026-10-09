/** /tasks/forms/:formId/fill — a signed-in person fills a published form in the app. */
import { useSubmitForm, useWebForm } from '@freefounders/core/tasks';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/primitives';
import { FormRenderer } from './renderer';

export function FillFormPage() {
  const { formId } = useParams();
  const id = Number(formId);
  const q = useWebForm(Number.isFinite(id) ? id : null);
  const submit = useSubmitForm();
  const [done, setDone] = useState(false);
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader className="mb-0" title={q.data?.name ?? 'Form'} breadcrumb={[{ label: 'Forms', to: '/tasks/forms' }]} />
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-64" />}
      {q.data && q.data.status !== 'published' && <EmptyState title="This form is not accepting submissions" />}
      {q.data && q.data.status === 'published' && (
        <Card className="p-4 sm:p-5">
          {done ? (
            <EmptyState
              icon={CheckCircle2}
              title="Submitted"
              description="Your response has been recorded."
              action={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDone(false)}>
                    Fill again
                  </Button>
                  <Button asChild>
                    <Link to="/tasks/forms">Back to forms</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <FormRenderer key={String(done)} description={q.data.description} fields={q.data.fields} pending={submit.isPending} submit={(answers) => submit.mutateAsync({ formId: id, answers })} onDone={() => setDone(true)} />
          )}
        </Card>
      )}
    </div>
  );
}
