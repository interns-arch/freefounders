import { Banknote, CalendarCheck, CalendarDays, CalendarHeart, CalendarRange, ClipboardCheck, Clock, FileSpreadsheet, LayoutGrid, Radio, Settings2, Wallet } from 'lucide-react';
import type { Access } from '@freefounders/core';
import type { NavItem } from '@/app/nav';

/** Everyone's attendance (PLAN.md §19.15): approvers see their team, HR and view-all the company (the API decides the scope). */
const manages = (a: Access) => a.tasks.can('hr.approve') || a.tasks.can('hr.manage') || a.tasks.can('tasks.view_all');

/** Attendance group of the one menu (PLAN.md §19.4, §19.14): the HR screens, one entry per section. Same rules as the tabs on the page. */
export const ATTENDANCE_NAV: NavItem[] = [
  { label: 'Today', to: '/attendance', icon: Clock, end: true },
  { label: 'My attendance', to: '/attendance/history', icon: CalendarDays },
  { label: 'My leave', to: '/attendance/leave', icon: CalendarCheck },
  { label: 'My salary', to: '/attendance/salary', icon: Wallet, show: (a) => a.tasks.module('payroll') },
  { label: 'Holidays', to: '/attendance/holidays', icon: CalendarHeart },
  { label: 'Live attendance', to: '/attendance/team', icon: Radio, group: 'Manage', show: manages },
  { label: 'Daily attendance', to: '/attendance/daily', icon: CalendarRange, group: 'Manage', show: manages },
  { label: 'Dashboard', to: '/attendance/dashboard', icon: LayoutGrid, group: 'Manage', show: manages },
  { label: 'Reports', to: '/attendance/reports', icon: FileSpreadsheet, group: 'Manage', show: manages },
  { label: 'Approvals', to: '/attendance/approvals', icon: ClipboardCheck, group: 'Manage', show: (a) => a.tasks.can('hr.approve') || a.tasks.can('tasks.view_department') },
  { label: 'Payroll', to: '/attendance/payroll', icon: Banknote, group: 'Manage', show: (a) => a.tasks.module('payroll') && a.tasks.can('hr.manage') },
  { label: 'HR settings', to: '/attendance/settings', icon: Settings2, group: 'Manage', show: (a) => a.tasks.can('hr.manage') },
];
