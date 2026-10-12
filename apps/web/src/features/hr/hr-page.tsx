/**
 * /attendance — the Attendance workspace (old pages/HR.jsx; PLAN.md §19.4). /attendance/<tab> opens a section directly:
 * history, leave, salary, holidays, team (live), daily, dashboard, reports, approvals, payroll, settings (old /tasks/hr?tab= links
 * redirect here). Salary and Payroll show only while the `payroll` module is on. Each section is its own permission
 * (PLAN.md §19.19, ATTENDANCE_SCREENS in nav.ts). /attendance/history?user=<id>&name= opens someone else's month (the API
 * checks they may).
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
import { ATTENDANCE_SCREENS as S } from './nav';
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

  // Each section is its own permission (PLAN.md §19.19). Under the "manager approves" rule a reports-to manager
  // also approves for, and sees, their own team (the API says so in screens / can_approve).
  const screens = cfg.data?.screens ?? {};
  const shown: Record<Tab, boolean> = {
    today: true,
    history: S.history(access),
    leave: S.leave(access),
    salary: S.salary(access),
    holidays: S.holidays(access),
    team: S.team(access) || !!screens.live,
    daily: S.daily(access) || !!screens.daily,
    dashboard: S.dashboard(access) || !!screens.dashboard,
    reports: S.reports(access) || !!screens.reports,
    approvals: S.approvals(access) || !!cfg.data?.can_approve,
    payroll: S.payroll(access),
    settings: S.settings(access),
  };
  // Someone else's month, opened from a manager's screen.
  if (params.get('user') && (shown.team || shown.daily || shown.dashboard || shown.reports || shown.approvals)) shown.history = true;
  const tabs = (
    [
      ['today', 'Today'],
      ['history', 'My Attendance'],
      ['leave', 'My Leave'],
      ['salary', 'My Salary'],
      ['holidays', 'Holidays'],
      ['team', 'Live team'],
      ['daily', 'Daily'],
      ['dashboard', 'Dashboard'],
      ['reports', 'Reports'],
      ['approvals', 'Approvals'],
      ['payroll', 'Payroll'],
      ['settings', 'HR Settings'],
    ] as Array<[Tab, string]>
  ).filter(([v]) => shown[v]);
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
