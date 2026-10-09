/**
 * Attendance → My Salary (everyone, module `payroll`) and Payroll (hr.manage): old pages/Payroll.jsx.
 * Payroll has three parts: monthly runs (draft → recalculate → finalise → CSV), salary structures and advances.
 */
import { errorMessage, useAccess } from '@freefounders/core';
import {
  type Advance,
  type PayrollRun,
  type Payslip,
  type SalaryStructure,
  useAddAdvance,
  useAddSalaryStructure,
  useAdvances,
  useCreatePayrollRun,
  useDeleteAdvance,
  useExportPayrollRun,
  useMyPayslips,
  usePayrollRunAction,
  usePayrollRuns,
  useRunPayslips,
  useSalaryStructures,
} from '@freefounders/core/hr';
import { useTeamDirectory } from '@freefounders/core/tasks';
import { Banknote, Download, FileText, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/common/confirm';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, Panel, Segmented, Tile } from '../tasks/general/parts';
import { downloadBlob } from '../tasks/shared/csv';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inr = (n: string | number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const monthName = (r: { month: number; year: number }) => `${MONTHS[r.month - 1]} ${r.year}`;
const num = (v: string | number | null | undefined) => Number(v || 0);

/* ───────────────────────── Payroll (hr.manage) ───────────────────────── */

export function PayrollTab() {
  const [part, setPart] = useState<'runs' | 'salaries' | 'advances'>('runs');
  return (
    <div className="space-y-4">
      <Segmented
        label="Payroll sections"
        value={part}
        onChange={setPart}
        options={[
          ['runs', 'Monthly payroll'],
          ['salaries', 'Salaries'],
          ['advances', 'Advances'],
        ]}
      />
      {part === 'runs' && <Runs />}
      {part === 'salaries' && <Salaries />}
      {part === 'advances' && <Advances />}
    </div>
  );
}

function Runs() {
  const today = new Date();
  const runs = usePayrollRuns();
  const create = useCreatePayrollRun();
  const act = usePayrollRunAction();
  const exportRun = useExportPayrollRun();
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<number | null>(null);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const slips = useRunPayslips(openId);
  const open = runs.data?.find((r) => r.id === openId) ?? null;

  const fail = (e: unknown) => setErr(errorMessage(e));
  const runPayroll = () => {
    setErr('');
    setMsg('');
    create.mutate(
      { year, month },
      {
        onSuccess: (run) => {
          setMsg(`Draft payroll created for ${MONTHS[month - 1]} ${year}.`);
          setOpenId(run.id);
        },
        onError: fail,
      },
    );
  };
  const recalc = (r: PayrollRun) => {
    setErr('');
    setMsg('');
    act.mutate(
      { id: r.id, action: 'generate' },
      {
        onSuccess: (res) => {
          const skipped = res.skipped_no_salary?.length ? ` · skipped (no salary set): ${res.skipped_no_salary.join(', ')}` : '';
          setMsg(`Recalculated: ${res.payslips ?? 0} payslip(s)${skipped}`);
          setOpenId(r.id);
        },
        onError: fail,
      },
    );
  };
  const finalise = async (r: PayrollRun) => {
    const ok = await confirm({
      title: `Finalise payroll for ${monthName(r)}?`,
      description: 'Payslips become visible to everyone in My Salary and pending advances are settled. A finalised month cannot be recalculated.',
      confirmText: 'Finalise',
    });
    if (!ok.confirmed) return;
    setErr('');
    setMsg('');
    act.mutate(
      { id: r.id, action: 'finalise' },
      {
        onSuccess: (res) => {
          setMsg(`Payroll finalised. ${res.advances_settled ?? 0} advance(s) settled.`);
          setOpenId(r.id);
        },
        onError: fail,
      },
    );
  };
  const exportCsv = (r: PayrollRun) => {
    setErr('');
    exportRun.mutate(r.id, { onSuccess: (blob) => downloadBlob(`payroll-${r.year}-${String(r.month).padStart(2, '0')}.csv`, blob), onError: fail });
  };

  if (runs.error) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} />;
  if (!runs.data) return <Skeleton className="h-64 max-w-5xl" />;

  return (
    <div className="max-w-5xl space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        aria-label="Run payroll"
        onSubmit={(e) => {
          e.preventDefault();
          runPayroll();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="pr-month">Month</Label>
          <NativeSelect id="pr-month" className="w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pr-year">Year</Label>
          <NativeSelect id="pr-year" className="w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" loading={create.isPending}>
          <Play /> Run payroll
        </Button>
      </form>
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{msg}</OkNote>
      {runs.data.length === 0 ? (
        <Card>
          <EmptyState icon={Banknote} title="No payroll run yet" description='Pick a month and press "Run payroll" — salaries are computed from attendance.' />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH>Status</TH>
                <TH className="text-right">Working days</TH>
                <TH className="text-right">Payslips</TH>
                <TH className="text-right">Total net</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {runs.data.map((r) => (
                <TR key={r.id} className={cn(openId === r.id && 'bg-primary/5')}>
                  <TD className="font-medium whitespace-nowrap">{monthName(r)}</TD>
                  <TD>
                    <Chip tone={r.status === 'finalised' ? 'success' : 'warning'}>{r.status === 'finalised' ? 'Finalised' : 'Draft'}</Chip>
                  </TD>
                  <TD className="text-right tabular-nums">{r.working_days}</TD>
                  <TD className="text-right tabular-nums">{r.payslip_count}</TD>
                  <TD className="text-right font-medium tabular-nums">{inr(r.total_net)}</TD>
                  <TD>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="xs" variant="outline" aria-label={`View ${monthName(r)}`} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                        {openId === r.id ? 'Hide' : 'View'}
                      </Button>
                      {r.status === 'draft' && (
                        <Button size="xs" variant="outline" aria-label={`Recalculate ${monthName(r)}`} onClick={() => recalc(r)} disabled={act.isPending}>
                          Recalculate
                        </Button>
                      )}
                      {r.status === 'draft' && (
                        <Button size="xs" aria-label={`Finalise ${monthName(r)}`} onClick={() => finalise(r)} disabled={act.isPending}>
                          Finalise
                        </Button>
                      )}
                      <Button size="xs" variant="outline" aria-label={`Download CSV for ${monthName(r)}`} onClick={() => exportCsv(r)} disabled={exportRun.isPending}>
                        <Download /> CSV
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {open && (
        <Panel
          title={
            <>
              {monthName(open)} <span className="font-normal text-muted-foreground">— {slips.data?.length ?? 0} payslip(s)</span>
            </>
          }
          bodyClassName="px-0 sm:px-0"
        >
          {slips.error && <ErrorNote className="mx-4">{errorMessage(slips.error)}</ErrorNote>}
          {!slips.data && !slips.error && <Skeleton className="mx-4 h-24" />}
          {slips.data?.length === 0 && <p className="px-4 text-sm text-muted-foreground sm:px-5">No payslips. Employees need a salary structure first (Salaries).</p>}
          {slips.data && slips.data.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH className="text-right">Gross</TH>
                  <TH className="text-right">Paid days</TH>
                  <TH className="text-right">LWP</TH>
                  <TH className="text-right">Earned</TH>
                  <TH className="text-right">PF</TH>
                  <TH className="text-right">PT</TH>
                  <TH className="text-right">Advance</TH>
                  <TH className="text-right">Other</TH>
                  <TH className="text-right">Net</TH>
                </TR>
              </THead>
              <TBody>
                {slips.data.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium whitespace-nowrap">{s.user_detail?.name}</TD>
                    <TD className="text-right tabular-nums">{inr(s.monthly_gross)}</TD>
                    <TD className="text-right tabular-nums whitespace-nowrap">
                      {num(s.payable_days)} / {s.working_days}
                    </TD>
                    <TD className={cn('text-right tabular-nums', num(s.lwp_days) > 0 && 'font-medium text-destructive')}>{num(s.lwp_days)}</TD>
                    <TD className="text-right tabular-nums">{inr(s.earned_gross)}</TD>
                    <TD className="text-right tabular-nums">{inr(s.pf)}</TD>
                    <TD className="text-right tabular-nums">{inr(s.professional_tax)}</TD>
                    <TD className="text-right tabular-nums">{inr(s.advance_deduction)}</TD>
                    <TD className="text-right tabular-nums">{inr(s.other_deduction)}</TD>
                    <TD className="text-right font-medium tabular-nums">{inr(s.net_payable)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}

const EMPTY_SALARY = { user: '' as number | '', monthly_gross: '', basic: '', pf_percent: '0', professional_tax: '0', other_deduction: '0', effective_from: '', note: '' };

function Salaries() {
  const rows = useSalaryStructures();
  const team = useTeamDirectory().data ?? [];
  const add = useAddSalaryStructure();
  const [f, setF] = useState(EMPTY_SALARY);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof EMPTY_SALARY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const ready = !!f.user && !!f.monthly_gross && !!f.effective_from;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setErr('');
    setMsg('');
    add.mutate(
      { ...f, user: Number(f.user), basic: f.basic || null },
      {
        onSuccess: (s) => {
          setMsg(`Salary saved for ${s.user_detail?.name}, effective ${fmtDate(s.effective_from)}.`);
          setF((p) => ({ ...p, user: '', monthly_gross: '', basic: '', note: '' }));
        },
        onError: (ex) => setErr(errorMessage(ex)),
      },
    );
  };

  if (rows.error) return <ErrorState error={rows.error} onRetry={() => rows.refetch()} />;
  if (!rows.data) return <Skeleton className="h-64 max-w-5xl" />;

  return (
    <div className="max-w-5xl space-y-4">
      <Panel title="Set a salary" description="A new entry doesn’t overwrite the old one — the latest date that has arrived is used, so past payslips stay explainable.">
        <form onSubmit={save} className="grid gap-4" aria-label="Set a salary">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="sal-user">Employee *</Label>
              <NativeSelect id="sal-user" value={f.user} onChange={set('user')}>
                <option value="">Choose…</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-gross">Monthly gross (₹) *</Label>
              <Input id="sal-gross" type="number" min={0} step="0.01" inputMode="decimal" value={f.monthly_gross} onChange={set('monthly_gross')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-basic">Basic (optional)</Label>
              <Input id="sal-basic" type="number" min={0} step="0.01" inputMode="decimal" value={f.basic} onChange={set('basic')} placeholder="PF base" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-pf">PF % (employee)</Label>
              <Input id="sal-pf" type="number" min={0} step="0.01" inputMode="decimal" value={f.pf_percent} onChange={set('pf_percent')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-pt">Professional tax (₹)</Label>
              <Input id="sal-pt" type="number" min={0} step="0.01" inputMode="decimal" value={f.professional_tax} onChange={set('professional_tax')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-other">Other deduction (₹)</Label>
              <Input id="sal-other" type="number" min={0} step="0.01" inputMode="decimal" value={f.other_deduction} onChange={set('other_deduction')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-from">Effective from *</Label>
              <Input id="sal-from" type="date" value={f.effective_from} onChange={set('effective_from')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sal-note">Note</Label>
              <Input id="sal-note" value={f.note} onChange={set('note')} placeholder="e.g. Appraisal 2026" />
            </div>
          </div>
          <ErrorNote>{err}</ErrorNote>
          <OkNote>{msg}</OkNote>
          <div>
            <Button type="submit" disabled={!ready} loading={add.isPending}>
              Save salary
            </Button>
          </div>
        </form>
      </Panel>
      {rows.data.length === 0 ? (
        <Card>
          <EmptyState icon={Banknote} title="No salaries set yet" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Basic</TH>
                <TH className="text-right">PF %</TH>
                <TH className="text-right">PT</TH>
                <TH className="text-right">Other</TH>
                <TH>Effective from</TH>
              </TR>
            </THead>
            <TBody>
              {rows.data.map((s: SalaryStructure) => (
                <TR key={s.id}>
                  <TD>
                    <span className="font-medium">{s.user_detail?.name}</span>
                    {s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}
                  </TD>
                  <TD className="text-right tabular-nums">{inr(s.monthly_gross)}</TD>
                  <TD className="text-right tabular-nums">{s.basic ? inr(s.basic) : '—'}</TD>
                  <TD className="text-right tabular-nums">{num(s.pf_percent)}%</TD>
                  <TD className="text-right tabular-nums">{inr(s.professional_tax)}</TD>
                  <TD className="text-right tabular-nums">{inr(s.other_deduction)}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(s.effective_from)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

const EMPTY_ADVANCE = { user: '' as number | '', amount: '', given_on: '', reason: '' };

function Advances() {
  const rows = useAdvances();
  const team = useTeamDirectory().data ?? [];
  const add = useAddAdvance();
  const remove = useDeleteAdvance();
  const confirm = useConfirm();
  const [f, setF] = useState(EMPTY_ADVANCE);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof EMPTY_ADVANCE) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const ready = !!f.user && !!f.amount && !!f.given_on;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setErr('');
    add.mutate({ ...f, user: Number(f.user) }, { onSuccess: () => setF(EMPTY_ADVANCE), onError: (ex) => setErr(errorMessage(ex)) });
  };
  const removeAdvance = async (a: Advance) => {
    const ok = await confirm({ title: `Remove the ${inr(a.amount)} advance for ${a.user_detail?.name}?`, description: 'It will no longer be deducted from the next payroll.', confirmText: 'Remove', destructive: true });
    if (!ok.confirmed) return;
    setErr('');
    remove.mutate(a.id, { onError: (ex) => setErr(errorMessage(ex)) });
  };

  if (rows.error) return <ErrorState error={rows.error} onRetry={() => rows.refetch()} />;
  if (!rows.data) return <Skeleton className="h-64 max-w-4xl" />;

  return (
    <div className="max-w-4xl space-y-4">
      <Panel title="Record an advance" description="Pending advances are deducted from the next payroll automatically, and never push a payslip below zero.">
        <form onSubmit={save} className="grid gap-4" aria-label="Record an advance">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="adv-user">Employee *</Label>
              <NativeSelect id="adv-user" value={f.user} onChange={set('user')}>
                <option value="">Choose…</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adv-amount">Amount (₹) *</Label>
              <Input id="adv-amount" type="number" min={0} step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adv-date">Given on *</Label>
              <Input id="adv-date" type="date" value={f.given_on} onChange={set('given_on')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adv-reason">Reason</Label>
              <Input id="adv-reason" value={f.reason} onChange={set('reason')} />
            </div>
          </div>
          <ErrorNote>{err}</ErrorNote>
          <div>
            <Button type="submit" disabled={!ready} loading={add.isPending}>
              Add advance
            </Button>
          </div>
        </form>
      </Panel>
      {rows.data.length === 0 ? (
        <Card>
          <EmptyState icon={Banknote} title="No advances recorded" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH className="text-right">Amount</TH>
                <TH>Given on</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.data.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium">{a.user_detail?.name}</TD>
                  <TD className="text-right tabular-nums">{inr(a.amount)}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(a.given_on)}</TD>
                  <TD>{a.reason || '—'}</TD>
                  <TD>
                    <Chip tone={a.recovered ? 'success' : 'warning'}>{a.recovered ? 'Recovered' : 'Pending'}</Chip>
                  </TD>
                  <TD>
                    {!a.recovered && (
                      <div className="flex justify-end">
                        <Button size="icon-xs" variant="ghost" aria-label={`Remove advance for ${a.user_detail?.name}`} title="Remove advance" onClick={() => removeAdvance(a)}>
                          <Trash2 />
                        </Button>
                      </div>
                    )}
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

/* ───────────────────────── My salary (everyone) ───────────────────────── */

export function MySalaryTab() {
  const access = useAccess();
  const me = access.tasks.me;
  const slips = useMyPayslips(me?.id);
  const salary = useSalaryStructures({ user: me?.id, enabled: me != null });
  const [openId, setOpenId] = useState<number | null>(null);

  if (slips.error) return <ErrorState error={slips.error} onRetry={() => slips.refetch()} />;
  if (!slips.data || !me) return <Skeleton className="h-64 max-w-3xl" />;
  const current = salary.data?.[0];
  const open = slips.data.find((s) => s.id === openId) ?? null;

  return (
    <div className="max-w-3xl space-y-4">
      {current ? (
        <div className="grid grid-cols-2 gap-3">
          <Tile label="My monthly salary" value={inr(current.monthly_gross)} icon={Banknote} />
          <Tile label="Effective from" value={<span className="text-base">{fmtDate(current.effective_from)}</span>} sub={current.note || undefined} tone="info" />
        </div>
      ) : (
        salary.data && <p className="text-sm text-muted-foreground">Your salary hasn’t been set yet — ask HR.</p>
      )}
      {slips.data.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No payslips yet" description="They appear here once HR finalises the month." />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH className="text-right">Paid days</TH>
                <TH className="text-right">Earned</TH>
                <TH className="text-right">Deductions</TH>
                <TH className="text-right">Net paid</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {slips.data.map((s) => (
                <TR key={s.id} className={cn(openId === s.id && 'bg-primary/5')}>
                  <TD className="font-medium whitespace-nowrap">{monthName(s)}</TD>
                  <TD className="text-right tabular-nums whitespace-nowrap">
                    {num(s.payable_days)} / {s.working_days}
                  </TD>
                  <TD className="text-right tabular-nums">{inr(s.earned_gross)}</TD>
                  <TD className="text-right tabular-nums">{inr(s.total_deductions)}</TD>
                  <TD className="text-right font-medium tabular-nums">{inr(s.net_payable)}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button size="xs" variant="outline" aria-label={`${openId === s.id ? 'Hide' : 'Details of'} payslip ${monthName(s)}`} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                        {openId === s.id ? 'Hide' : 'Details'}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {open && <PayslipDetail slip={open} name={me.first_name || me.username} />}
    </div>
  );
}

function PayslipDetail({ slip: s, name }: { slip: Payslip; name: string }) {
  const b = s.breakdown ?? {};
  const rows: Array<[string, React.ReactNode, boolean?]> = [
    ['Present days', b.present ?? '—'],
    ['Half days', b.half_day ?? 0],
    ['Paid leave', b.paid_leave ?? 0],
    ['Unpaid leave / absent (LWP)', num(s.lwp_days)],
    ['Per-day rate', inr(b.per_day as string | number | undefined)],
    ['Earned gross', inr(s.earned_gross)],
    ...(num(s.pf) > 0 ? ([['PF', `− ${inr(s.pf)}`, true]] as Array<[string, React.ReactNode, boolean]>) : []),
    ...(num(s.professional_tax) > 0 ? ([['Professional tax', `− ${inr(s.professional_tax)}`, true]] as Array<[string, React.ReactNode, boolean]>) : []),
    ...(num(s.advance_deduction) > 0 ? ([['Advance recovered', `− ${inr(s.advance_deduction)}`, true]] as Array<[string, React.ReactNode, boolean]>) : []),
    ...(num(s.other_deduction) > 0 ? ([['Other deduction', `− ${inr(s.other_deduction)}`, true]] as Array<[string, React.ReactNode, boolean]>) : []),
  ];
  return (
    <Panel title={`Payslip — ${monthName(s)} · ${name}`}>
      <dl className="divide-y text-sm">
        {rows.map(([label, value, deduction]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('font-medium tabular-nums', deduction && 'text-destructive')}>{value}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 py-2 text-base">
          <dt className="font-semibold">Net paid</dt>
          <dd className="font-mono font-semibold tabular-nums">{inr(s.net_payable)}</dd>
        </div>
      </dl>
      {s.note && <p className="mt-2 text-xs text-muted-foreground">{s.note}</p>}
    </Panel>
  );
}
