/**
 * /tasks/hr — Attendance & leave (old pages/HR.jsx). ?tab= opens a tab directly: today, history, leave, holidays,
 * team, approvals, settings. Salary and payroll stay on the classic screen (Payroll is not moved yet, PLAN.md §18.3).
 */
import { useAccess } from '@freefounders/core';
import { useHrConfig } from '@freefounders/core/hr';
import { ExternalLink } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { PageHeader, PageLoader } from '@/components/common/page';
import { cn } from '@/lib/utils';
import { MonthView } from './attendance';
import { HolidaysTab, MyLeaveTab } from './leave';
import { HrSettingsTab } from './settings';
import { ApprovalsTab, TeamTab } from './team';
import { TodayTab } from './today';

type Tab = 'today' | 'history' | 'leave' | 'salary' | 'holidays' | 'team' | 'approvals' | 'payroll' | 'settings';

export function HrPage() {
  const access = useAccess();
  const cfg = useHrConfig();
  const [params, setParams] = useSearchParams();
  if (!access.tasks.me) return <PageLoader />;

  const can = access.tasks.can;
  const payroll = access.tasks.module('payroll');
  // Under the "manager approves" rule a manager without hr.approve still approves their team's leave.
  const approves = can('hr.approve') || !!cfg.data?.can_approve;
  const tabs: Array<[Tab, string, string?]> = [
    ['today', 'Today'],
    ['history', 'My Attendance'],
    ['leave', 'My Leave'],
    ...(payroll ? ([['salary', 'My Salary', '/classic/tasks/hr?tab=salary']] as Array<[Tab, string, string]>) : []),
    ['holidays', 'Holidays'],
    ...(can('hr.approve') ? ([['team', 'Team']] as Array<[Tab, string]>) : []),
    ...(approves ? ([['approvals', 'Approvals']] as Array<[Tab, string]>) : []),
    ...(can('hr.manage')
      ? ([...(payroll ? [['payroll', 'Payroll', '/classic/tasks/hr?tab=payroll']] : []), ['settings', 'HR Settings']] as Array<[Tab, string, string?]>)
      : []),
  ];
  const asked = params.get('tab');
  const tab: Tab = (tabs.find(([v, , href]) => v === asked && !href)?.[0] ?? 'today') as Tab;
  const choose = (v: Tab) => {
    params.set('tab', v);
    setParams(params, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PageHeader className="mb-0" title="Leave & Attendance" />
      <nav aria-label="Attendance and leave sections" className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div className="flex w-max gap-1 border-b">
          {tabs.map(([v, label, href]) =>
            href ? (
              <a key={v} href={href} className="-mb-px inline-flex h-9 items-center gap-1 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground">
                {label} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <button
                key={v}
                type="button"
                aria-current={tab === v ? 'page' : undefined}
                onClick={() => choose(v)}
                className={cn(
                  '-mb-px inline-flex h-9 cursor-pointer items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
                  tab === v && 'border-primary text-foreground',
                )}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </nav>
      {tab === 'today' && <TodayTab />}
      {tab === 'history' && <MonthView />}
      {tab === 'leave' && <MyLeaveTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'settings' && <HrSettingsTab />}
    </div>
  );
}
