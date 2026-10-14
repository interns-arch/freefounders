/**
 * /console: the owner console for FreeFounders staff (PLAN.md §20.6, §21.1): totals (MRR, paid, trials, past due,
 * read-only / suspended, companies) and every company with plan, state, seats and MRR; extend a trial, give a plan
 * (complimentary…), suspend or reactivate. Every action asks first.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  type ConsoleCompany,
  formatInr,
  planLabel,
  STATE_LABELS,
  useConsoleAction,
  useConsoleCompanies,
  useConsoleSummary,
  usePlans,
} from '@freefounders/core/billing';
import { MoreHorizontal } from '@/components/icons';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { type Column, DataTable } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';
import { SeatStepper, StateBadge } from './parts';

const seatsOf = (c: ConsoleCompany) => (typeof c.seats === 'number' ? { used: c.seats, paid: c.seats } : c.seats);

export function ConsolePage() {
  const access = useAccess();
  const staff = !!access.platform?.account?.isStaff;
  const summary = useConsoleSummary(staff);
  const companies = useConsoleCompanies(staff);
  const plans = usePlans();
  const act = useConsoleAction();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [planFor, setPlanFor] = useState<ConsoleCompany | null>(null);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (companies.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q));
  }, [companies.data, search]);

  if (access.ready && !staff) return <Navigate to="/" replace />;

  const run = async (c: ConsoleCompany, kind: 'trial7' | 'trial14' | 'suspend' | 'reactivate') => {
    const what = {
      trial7: { title: `Extend ${c.name}’s trial by 7 days?`, text: 'Extend trial', a: { kind: 'trial' as const, days: 7 } },
      trial14: { title: `Extend ${c.name}’s trial by 14 days?`, text: 'Extend trial', a: { kind: 'trial' as const, days: 14 } },
      suspend: { title: `Suspend ${c.name}?`, text: 'Suspend', a: { kind: 'status' as const, status: 'suspended' } },
      reactivate: { title: `Reactivate ${c.name}?`, text: 'Reactivate', a: { kind: 'status' as const, status: 'active' } },
    }[kind];
    const ok = await confirm({
      title: what.title,
      description: kind === 'suspend' ? 'Only the owner can sign in, straight to Billing. Everyone else is refused.' : undefined,
      confirmText: what.text,
      destructive: kind === 'suspend',
    });
    if (!ok.confirmed) return;
    act.mutate({ id: c.id, ...what.a }, { onSuccess: () => toast.success('Done'), onError: (e) => toast.error(errorMessage(e)) });
  };

  const s = summary.data;
  const tiles = [
    { label: 'MRR', value: s ? formatInr(s.mrr) : undefined },
    { label: 'Active paid', value: s ? (s.activePaid ?? s.active ?? 0) : undefined },
    { label: 'Trialing', value: s?.trialing },
    { label: 'Past due', value: s?.pastDue },
    { label: 'Read-only / suspended', value: s ? `${s.readOnly} / ${s.suspended}` : undefined },
    { label: 'Companies', value: s?.companies },
  ];

  const columns: Column<ConsoleCompany>[] = [
    {
      key: 'name',
      header: 'Company',
      cell: (c) => (
        <div className="min-w-36">
          <p className="truncate font-semibold">{c.name}</p>
          {c.code && <p className="font-mono text-xs text-muted-foreground">{c.code}</p>}
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', cell: (c) => c.planName ?? planLabel(c.plan, plans.data) },
    { key: 'state', header: 'State', cell: (c) => <StateBadge state={c.state} /> },
    {
      key: 'seats',
      header: 'Users',
      cell: (c) => {
        const x = seatsOf(c);
        return (
          <span className="font-mono tabular-nums">
            {x.used} / {x.paid}
          </span>
        );
      },
    },
    { key: 'mrr', header: 'MRR', className: 'text-right', headerClassName: 'text-right', cell: (c) => <span className="font-mono tabular-nums">{formatInr(c.mrr)}</span> },
    { key: 'trial', header: 'Trial ends', hideOnMobile: true, cell: (c) => (c.state === 'trialing' ? formatDate(c.trialEndsAt) : '—') },
    { key: 'created', header: 'Created', hideOnMobile: true, cell: (c) => formatDate(c.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (c) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void run(c, 'trial7')}>Extend trial +7 days</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run(c, 'trial14')}>Extend trial +14 days</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPlanFor(c)}>Set plan…</DropdownMenuItem>
            <DropdownMenuSeparator />
            {c.state === 'suspended' ? (
              <DropdownMenuItem onSelect={() => void run(c, 'reactivate')}>Reactivate</DropdownMenuItem>
            ) : (
              <DropdownMenuItem destructive onSelect={() => void run(c, 'suspend')}>
                Suspend
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Owner console" description="FreeFounders staff only. Every action is logged." />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-card p-3 shadow-card">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className="mt-1 font-mono text-xl font-bold tabular-nums">{t.value ?? (summary.isLoading ? <Skeleton className="h-7 w-16" /> : '—')}</dd>
          </div>
        ))}
      </dl>
      <SearchField value={search} onChange={setSearch} label="Search companies" className="max-w-sm" />
      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} loading={companies.isLoading} error={companies.error} onRetry={() => void companies.refetch()} />
      {planFor && <SetPlanDialog company={planFor} onClose={() => setPlanFor(null)} />}
    </div>
  );
}

function SetPlanDialog({ company, onClose }: { company: ConsoleCompany; onClose: () => void }) {
  const plans = usePlans();
  const act = useConsoleAction();
  const [plan, setPlan] = useState(company.plan || 'complimentary');
  const [seats, setSeats] = useState(Math.max(1, seatsOf(company).paid || seatsOf(company).used || 5));
  const options = [...(plans.data ?? []).map((p) => ({ key: p.key, name: p.name }))];
  if (!options.some((o) => o.key === 'complimentary')) options.push({ key: 'complimentary', name: 'Complimentary' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set plan for {company.name}</DialogTitle>
          <DialogDescription>Applies at once without payment (for complimentary or manual deals). Current state: {STATE_LABELS[company.state] ?? company.state}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="console-plan">Plan</Label>
            <NativeSelect id="console-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="console-seats">Users</Label>
            <SeatStepper id="console-seats" value={seats} onChange={setSeats} min={1} />
          </div>
          {act.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(act.error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={act.isPending}
            onClick={() => act.mutate({ id: company.id, kind: 'plan', plan, seats }, { onSuccess: () => (toast.success('Plan set'), onClose()) })}
          >
            Set plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
