import { Banknote, CalendarCheck, CalendarDays, CalendarHeart, CalendarRange, ClipboardCheck, Clock, FileSpreadsheet, LayoutGrid, Radio, Settings2, Wallet } from '@/components/icons';
import type { Access } from '@freefounders/core';
import type { NavItem } from '@/app/nav';

/**
 * Who sees which Attendance screen (PLAN.md §19.19): each one is its own permission. The scoped ones (live, daily,
 * dashboard, reports, approvals) count at any scope; the API decides whose rows they see.
 */
export const ATTENDANCE_SCREENS = {
  history: (a: Access) => a.tasks.can('attendance.self'),
  leave: (a: Access) => a.tasks.can('leave.self'),
  salary: (a: Access) => a.tasks.module('payroll') && a.tasks.can('payroll.self'),
  holidays: (a: Access) => a.tasks.can('holidays.view') || a.tasks.can('holidays.manage'),
  team: (a: Access) => a.tasks.canAny('hr.live'),
  daily: (a: Access) => a.tasks.canAny('hr.daily'),
  dashboard: (a: Access) => a.tasks.canAny('hr.dashboard'),
  reports: (a: Access) => a.tasks.canAny('hr.reports'),
  approvals: (a: Access) => a.tasks.canAny('hr.approve'),
  payroll: (a: Access) => a.tasks.module('payroll') && (a.tasks.can('payroll.run') || a.tasks.can('payroll.salaries')),
  settings: (a: Access) => a.tasks.can('hr.settings'),
};

/** Attendance group of the one menu (PLAN.md §19.4, §19.14): the HR screens, one entry per section. Same rules as the tabs on the page. */
export const ATTENDANCE_NAV: NavItem[] = [
  { label: 'Today', to: '/attendance', icon: Clock, end: true },
  { label: 'My attendance', to: '/attendance/history', icon: CalendarDays, show: ATTENDANCE_SCREENS.history },
  { label: 'My leave', to: '/attendance/leave', icon: CalendarCheck, show: ATTENDANCE_SCREENS.leave },
  { label: 'My salary', to: '/attendance/salary', icon: Wallet, show: ATTENDANCE_SCREENS.salary },
  { label: 'Holidays', to: '/attendance/holidays', icon: CalendarHeart, show: ATTENDANCE_SCREENS.holidays },
  { label: 'Live attendance', to: '/attendance/team', icon: Radio, group: 'Manage', show: ATTENDANCE_SCREENS.team },
  { label: 'Daily attendance', to: '/attendance/daily', icon: CalendarRange, group: 'Manage', show: ATTENDANCE_SCREENS.daily },
  { label: 'Dashboard', to: '/attendance/dashboard', icon: LayoutGrid, group: 'Manage', show: ATTENDANCE_SCREENS.dashboard },
  { label: 'Reports', to: '/attendance/reports', icon: FileSpreadsheet, group: 'Manage', show: ATTENDANCE_SCREENS.reports },
  { label: 'Approvals', to: '/attendance/approvals', icon: ClipboardCheck, group: 'Manage', show: ATTENDANCE_SCREENS.approvals },
  { label: 'Payroll', to: '/attendance/payroll', icon: Banknote, group: 'Manage', show: ATTENDANCE_SCREENS.payroll },
  { label: 'HR settings', to: '/attendance/settings', icon: Settings2, group: 'Manage', show: ATTENDANCE_SCREENS.settings },
];
