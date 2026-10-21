/**
 * The line under a field that is checked live on the server (username PLAN.md §21.5, company name §21.6): the problem
 * (error text), "Available" (success text), "Checking…", or a quiet hint. Announced politely as it changes.
 */
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from '@/components/icons';

export function LiveCheckLine({ id, problem, state, idle }: { id: string; problem?: string | null; state: string; idle?: ReactNode }) {
  return (
    <p id={id} aria-live="polite" className="min-h-5 text-[13px]">
      {problem ? (
        <span className="flex items-start gap-1.5 font-medium text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {problem}
        </span>
      ) : state === 'available' ? (
        <span className="flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          Available
        </span>
      ) : state === 'checking' ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          Checking…
        </span>
      ) : idle ? (
        <span className="text-muted-foreground">{idle}</span>
      ) : null}
    </p>
  );
}
