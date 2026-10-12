/**
 * /attendance — the Attendance workspace (old pages/HR.jsx; PLAN.md §19.4). /attendance/<tab> opens a section directly:
 * history, leave, salary, holidays, team (live), daily, dashboard, reports, approvals, payroll, settings (old /tasks/hr?tab= links
 * redirect here). Salary and Payroll show only while the `payroll` module is on; Payroll needs hr.manage. The manager sections
 * (team, daily, dashboard, reports; PLAN.md §19.15) show to approvers, HR and view-all. /attendance/history?user=<id>&name=
 * opens someone else's month (the API checks they may).
 */
import { useAccess } from '@freefounders/core';
import { useHrConfig } from '@freefounders/core/hr';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MonthView } from './attendance';
import { DailyTab } from './daily';
import { DashboardTab } from './dashboard';
import { HolidaysTab, MyLeaveTab } from './leave';
import { LiveTab } from './live';
import { MySalaryTab, PayrollTab } from './payroll';
import { ReportsTab } from './reports';
import { HrSettingsTab } from './settings';
import { ApprovalsTab } from './team';
import { TodayTab } from './today';

type Tab = 'today' | 'history' | 'leave' | 'salary' | 'holidays' | 'team' | 'daily' | 'dashboard' | 'reports' | 'approvals' | 'payroll' | 'settings';

const BACK: Record<string, string> = { team: 'Live team', daily: 'Daily attendance', dashboard: 'Attendance dashboard' };

export function HrPage() {
  const access = useAccess();
  const cfg = useHrConfig();
  const navigate = useNavigate();
  const { tab: asked } = useParams();
  const [params] = useSearchParams();
  if (!access.tasks.me) return <PageLoader />;

  const can = access.tasks.can;
  const payroll = access.tasks.module('payroll');
  // Under the "manager approves" rule a manager without hr.approve still approves their team's leave.
  const approves = can('hr.approve') || !!cfg.data?.can_approve;
  // Everyone's attendance (PLAN.md §19.15): approvers see their team, HR and view-all the company.
  const manages = approves || can('hr.manage') || can('tasks.view_all');
  const tabs: Array<[Tab, string]> = [
    ['today', 'Today'],
    ['history', 'My Attendance'],
    ['leave', 'My Leave'],
    ...(payroll ? ([['salary', 'My Salary']] as Array<[Tab, string]>) : []),
    ['holidays', 'Holidays'],
    ...(manages
      ? ([
          ['team', 'Live team'],
          ['daily', 'Daily'],
          ['dashboard', 'Dashboard'],
          ['reports', 'Reports'],
        ] as Array<[Tab, string]>)
      : []),
    ...(approves ? ([['approvals', 'Approvals']] as Array<[Tab, string]>) : []),
    ...(can('hr.manage') ? ([...(payroll ? [['payroll', 'Payroll']] : []), ['settings', 'HR Settings']] as Array<[Tab, string]>) : []),
  ];
  const tab: Tab = (tabs.find(([v]) => v === asked)?.[0] ?? 'today') as Tab;
  const choose = (v: Tab) => navigate(v === 'today' ? '/attendance' : `/attendance/${v}`);
  const otherUser = tab === 'history' && params.get('user') ? Number(params.get('user')) : undefined;
  const from = params.get('from') ?? '';

  return (
    <div className="space-y-4">
      <PageHeader className="mb-0" title="Leave & Attendance" />
      <nav aria-label="Attendance and leave sections" className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div className="flex w-max gap-0.5 rounded-full border bg-muted/60 p-0.5">
          {tabs.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-current={tab === v ? 'page' : undefined}
              onClick={() => choose(v)}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
                tab === v && 'bg-card font-semibold text-primary shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-border',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      {tab === 'today' && <TodayTab />}
      {tab === 'history' && !otherUser && <MonthView />}
      {tab === 'history' && otherUser && (
        <div className="space-y-3">
          {BACK[from] && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/attendance/${from}`)}>
              <ArrowLeft /> Back to {BACK[from].toLowerCase()}
            </Button>
          )}
          <MonthView key={otherUser} userId={otherUser} userName={params.get('name') ?? undefined} />
        </div>
      )}
      {tab === 'leave' && <MyLeaveTab />}
      {tab === 'salary' && <MySalaryTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'team' && <LiveTab />}
      {tab === 'daily' && <DailyTab />}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'settings' && <HrSettingsTab />}
    </div>
  );
}
