/**
 * Company switcher (PLAN.md §20.4, §21.1): in the account menu, the account's companies (current one ticked) and
 * "New company". Switching shows "Opening <company>…" over everything, signs in to that company (the cache is
 * emptied: nothing of the other company can show) and opens its Home.
 */
import type { Access } from '@kaampilot/core';
import { useMyCompanies, useSwitchCompany } from '@kaampilot/core/account';
import { errorMessage } from '@kaampilot/core';
import { Building2, Check, Loader2, Plus } from '@/components/icons';
import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/overlays';

let opening: string | null = null;
const listeners = new Set<() => void>();
function setOpening(name: string | null) {
  opening = name;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** "Opening <company>…" over the whole app while switching. */
export function SwitchingOverlay() {
  const name = useSyncExternalStore(subscribe, () => opening);
  if (!name) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background" role="status" aria-live="assertive">
      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <p className="text-lg font-semibold">Opening {name}…</p>
      </div>
    </div>
  );
}

/** The "Companies" part of the account menu (only for a person with an account). */
export function CompanyMenuItems({ access }: { access: Access }) {
  const navigate = useNavigate();
  const hasAccount = !!access.platform?.account;
  const companies = useMyCompanies(hasAccount);
  const switchTo = useSwitchCompany();
  if (!hasAccount) return null;

  const open = async (companyId: string, name: string) => {
    setOpening(name);
    const started = Date.now();
    try {
      await switchTo.mutateAsync(companyId);
      navigate('/?home=1', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      // Long enough to read, never a long wait.
      setTimeout(() => setOpening(null), Math.max(0, 600 - (Date.now() - started)));
    }
  };

  return (
    <>
      <DropdownMenuLabel className="font-mono text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Companies</DropdownMenuLabel>
      {(companies.data ?? []).map((c) => (
        <DropdownMenuItem
          key={c.companyId}
          onSelect={() => (c.current ? undefined : void open(c.companyId, c.name))}
          aria-current={c.current ? 'true' : undefined}
          className="gap-2"
        >
          <Building2 className="size-4" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{c.name}</span>
            <span className="block truncate text-xs text-muted-foreground capitalize">{c.role}</span>
          </span>
          {c.current && <Check className="size-4 text-primary" aria-label="Current company" />}
        </DropdownMenuItem>
      ))}
      {companies.isLoading && <DropdownMenuItem disabled>Loading companies…</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => navigate('/new-company')}>
        <Plus className="size-4" /> New company
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
