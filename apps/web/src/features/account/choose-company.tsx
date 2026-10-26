/** "Choose a company" (PLAN.md §21.2): an account in several companies picks one after its password (sign-in, password reset). */
import { type ChooseCompany, errorMessage } from '@kaampilot/core';
import { useSignInWithTicket } from '@kaampilot/core/account';
import { ArrowRight, Building2 } from '@/components/icons';
import { Button } from '@/components/ui/button';

export function ChooseCompanyCard({ choose, onDone, onBack }: { choose: ChooseCompany; onDone: () => void; onBack: () => void }) {
  const withTicket = useSignInWithTicket();
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-card sm:p-7" aria-labelledby="choose-title">
      <h1 id="choose-title" className="text-2xl font-bold tracking-tight">
        Choose a company
      </h1>
      <p className="text-sm text-muted-foreground">Your account works in more than one company. Which one do you want to open?</p>
      <ul className="space-y-2">
        {choose.chooseCompany.map((c) => (
          <li key={c.companyId}>
            <button
              type="button"
              disabled={withTicket.isPending}
              onClick={() => withTicket.mutate({ ticket: choose.ticket, companyId: c.companyId }, { onSuccess: onDone })}
              className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left transition outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden>
                <Building2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground capitalize">{c.role}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {withTicket.isError && (
        <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {/* The 5-minute choice ran out (or was used): sign in again. */}
          {/unauthorized|sign in again/i.test(errorMessage(withTicket.error)) ? 'This choice has timed out. Go back and sign in again.' : errorMessage(withTicket.error)}
        </p>
      )}
      <Button variant="ghost" className="w-full" onClick={() => (withTicket.reset(), onBack())}>
        Back
      </Button>
    </section>
  );
}
