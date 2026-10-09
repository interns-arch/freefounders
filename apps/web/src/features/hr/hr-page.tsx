/**
 * /attendance — the Attendance workspace (old pages/HR.jsx; PLAN.md §19.4). /attendance/<tab> opens a section directly:
 * history, leave, salary, holidays, team, approvals, payroll, settings (old /tasks/hr?tab= links redirect here).
 * Salary and Payroll show only while the `payroll` module is on; Payroll needs hr.manage.
 */
import { useAccess } from '@freefounders/core';
import { useHrConfig } from '@freefounders/core/hr';
import { useNavigate, useParams } from 'react-router';
import { PageHeader, PageLoader } from '@/components/common/page';
import { cn } from '@/lib/utils';
import { MonthView } from './attendance';
import { HolidaysTab, MyLeaveTab } from './leave';
import { MySalaryTab, PayrollTab } from './payroll';
import { HrSettingsTab } from './settings';
import { ApprovalsTab, TeamTab } from './team';
import { TodayTab } from './today';

type Tab = 'today' | 'history' | 'leave' | 'salary' | 'holidays' | 'team' | 'approvals' | 'payroll' | 'settings';

export function HrPage() {
  const access = useAccess();
  const cfg = useHrConfig();
  const navigate = useNavigate();
  const { tab: asked } = useParams();
  if (!access.tasks.me) return <PageLoader />;

  const can = access.tasks.can;
  const payroll = access.tasks.module('payroll');
  // Under the "manager approves" rule a manager without hr.approve still approves their team's leave.
  const approves = can('hr.approve') || !!cfg.data?.can_approve;
  const tabs: Array<[Tab, string]> = [
    ['today', 'Today'],
    ['history', 'My Attendance'],
    ['leave', 'My Leave'],
    ...(payroll ? ([['salary', 'My Salary']] as Array<[Tab, string]>) : []),
    ['holidays', 'Holidays'],
    ...(can('hr.approve') ? ([['team', 'Team']] as Array<[Tab, string]>) : []),
    ...(approves ? ([['approvals', 'Approvals']] as Array<[Tab, string]>) : []),
    ...(can('hr.manage') ? ([...(payroll ? [['payroll', 'Payroll']] : []), ['settings', 'HR Settings']] as Array<[Tab, string]>) : []),
  ];
  const tab: Tab = (tabs.find(([v]) => v === asked)?.[0] ?? 'today') as Tab;
  const choose = (v: Tab) => navigate(v === 'today' ? '/attendance' : `/attendance/${v}`);

  return (
    <div className="space-y-4">
      <PageHeader className="mb-0" title="Leave & Attendance" />
      <nav aria-label="Attendance and leave sections" className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div className="flex w-max gap-1 border-b">
          {tabs.map(([v, label]) => (
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
          ))}
        </div>
      </nav>
      {tab === 'today' && <TodayTab />}
      {tab === 'history' && <MonthView />}
      {tab === 'leave' && <MyLeaveTab />}
      {tab === 'salary' && <MySalaryTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'settings' && <HrSettingsTab />}
    </div>
  );
}
