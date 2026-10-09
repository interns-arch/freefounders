/** The founder's "action required" card, process smells, repeat offenders and department scores (managers and admin). */
import { useMistakeDepartmentScores, useMistakeFounderSummary, useMistakePatterns } from '@freefounders/core/tasks';
import { BarChart3, ChevronDown, ChevronRight, Flag } from 'lucide-react';
import { useState } from 'react';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives';
import { rupees } from './format';

export function MistakeInsights({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(true);
  const summary = useMistakeFounderSummary(isAdmin);
  const patterns = useMistakePatterns(true, 90);
  const depts = useMistakeDepartmentScores(true, 'this_month');
  const smells = patterns.data?.categories?.filter((c) => c.process_suspect) ?? [];
  const offenders = patterns.data?.repeat_offenders ?? [];
  const rows = depts.data?.rows ?? [];
  const s = summary.data;
  const title = isAdmin ? 'Action required (founder view)' : 'Team insights';
  const Icon = isAdmin ? Flag : BarChart3;

  return (
    <Card>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
        {open ? <ChevronDown className="ml-auto size-4 text-muted-foreground" /> : <ChevronRight className="ml-auto size-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-4 px-4 pb-4">
          {s && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Critical open" value={s.critical_open} alert={s.critical_open > 0} />
              <Stat label="SLA missed" value={s.sla_missed} alert={s.sla_missed > 0} />
              <Stat label="Escalated to you" value={s.escalated_to_founder} alert={s.escalated_to_founder > 0} />
              <Stat label="3rd occurrences" value={s.level3_open} />
              <Stat label="Loss this month" value={rupees(s.loss_this_month)} />
              <Stat label="Open total" value={s.open_total} />
            </dl>
          )}
          {smells.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold">Process smells (90 days) — fix the process, not the people</p>
              <ul className="mt-1 space-y-0.5">
                {smells.map((c) => (
                  <li key={c.category}>
                    <strong>{c.category}</strong> — {c.message}
                    {Number(c.financial_loss) > 0 && <> {rupees(c.financial_loss)} loss.</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {offenders.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Repeat (90 days):{' '}
              {offenders
                .slice(0, 5)
                .map((o) => `${o.name} ×${o.count} ${o.category}`)
                .join(' · ')}
            </p>
          )}
          {rows.length > 0 && (
            <div>
              <p className="text-sm font-semibold" title={depts.data?.formula}>
                Department accountability score (this month)
              </p>
              {depts.data?.formula && <p className="text-xs text-muted-foreground">{depts.data.formula}</p>}
              <div className="mt-2 overflow-x-auto">
                <Table className="max-w-3xl">
                  <THead>
                    <TR>
                      <TH>Department</TH>
                      <TH>Score</TH>
                      <TH>Mistakes</TH>
                      <TH>Repeats</TH>
                      <TH>SLA</TH>
                      <TH>Loss</TH>
                      <TH>vs last period</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.department}>
                        <TD className="font-medium">{r.label}</TD>
                        <TD className="font-mono font-semibold" title={`−${r.breakdown.repeat_penalty} repeats · −${r.breakdown.sla_penalty} SLA · −${r.breakdown.loss_penalty} loss · +${r.breakdown.improvement_bonus} improvement`}>
                          {r.score}
                        </TD>
                        <TD>{r.mistakes}</TD>
                        <TD className={cn(r.repeats > 0 && 'font-semibold text-destructive')}>{r.repeats}</TD>
                        <TD>{r.sla_compliance == null ? '—' : `${r.sla_compliance}%`}</TD>
                        <TD>{r.financial_loss ? rupees(r.financial_loss) : '—'}</TD>
                        <TD>
                          {/* Positive = fewer mistakes than last period (shown as a fall). */}
                          {r.improvement_pct == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={cn('font-semibold', r.improvement_pct > 0 ? 'text-success' : r.improvement_pct < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                              {r.improvement_pct > 0 ? '▼' : r.improvement_pct < 0 ? '▲' : ''} {Math.abs(r.improvement_pct)}%
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          )}
          {!s && smells.length === 0 && offenders.length === 0 && rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing to flag right now.</p>}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, alert }: { label: string; value: React.ReactNode; alert?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2.5', alert && 'border-destructive/40 bg-destructive/5')}>
      <dt className="font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn('mt-0.5 font-mono text-lg font-semibold tabular-nums', alert && 'text-destructive')}>{value}</dd>
    </div>
  );
}
