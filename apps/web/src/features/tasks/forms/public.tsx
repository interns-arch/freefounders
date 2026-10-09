/**
 * /f/:token (and /tasks/f/:token) — the share-link page (old PublicForm.jsx). Works with no sign-in and no app
 * shell: the public endpoint allows anyone. Same theme; one column that fits a phone.
 */
import { errorMessage } from '@freefounders/core';
import { usePublicForm, useSubmitPublicForm } from '@freefounders/core/tasks';
import { CheckCircle2, FileQuestion } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { EmptyState } from '@/components/common/page';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Logo } from '@/app/shell-parts';
import { FormRenderer } from './renderer';

export function PublicFormPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const company = params.get('c'); // which company's form (multi-company installs)
  const q = usePublicForm(token, company);
  const submit = useSubmitPublicForm();
  const [done, setDone] = useState(false);
  const title = q.data?.name ?? 'Form';
  if (typeof document !== 'undefined') document.title = `${title} · FreeFounders`;

  return (
    <div className="min-h-dvh bg-background px-4 py-6 sm:py-12">
      <main className="mx-auto w-full max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Logo subtitle="Form" />
        </div>
        <Card className="p-4 sm:p-6">
          {q.error && <EmptyState icon={FileQuestion} title="This form is not available" description={errorMessage(q.error)} />}
          {!q.data && !q.error && (
            <div className="space-y-3">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-24" />
            </div>
          )}
          {q.data && done && <EmptyState icon={CheckCircle2} title="Thank you!" description="Your response has been recorded. Our team will get back to you shortly." />}
          {q.data && !done && (
            <div className="space-y-4">
              <h1 className="text-xl font-semibold tracking-tight">{q.data.name}</h1>
              <FormRenderer description={q.data.description} fields={q.data.fields} pending={submit.isPending} submit={(answers) => submit.mutateAsync({ token: token!, company, answers })} onDone={() => setDone(true)} />
            </div>
          )}
        </Card>
        <p className="text-center text-xs text-muted-foreground">Powered by FreeFounders</p>
      </main>
    </div>
  );
}
