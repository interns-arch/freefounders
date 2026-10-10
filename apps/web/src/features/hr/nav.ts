import { Banknote, CalendarCheck, CalendarDays, CalendarHeart, ClipboardCheck, Clock, Settings2, Users, Wallet } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** Attendance group of the one menu (PLAN.md §19.4, §19.14): the HR screens, one entry per section. Same rules as the tabs on the page. */
export const ATTENDANCE_NAV: NavItem[] = [
  { label: 'Today', to: '/attendance', icon: Clock, end: true },
  { label: 'My attendance', to: '/attendance/history', icon: CalendarDays },
  { label: 'My leave', to: '/attendance/leave', icon: CalendarCheck },
  { label: 'My salary', to: '/attendance/salary', icon: Wallet, show: (a) => a.tasks.module('payroll') },
  { label: 'Holidays', to: '/attendance/holidays', icon: CalendarHeart },
  { label: 'Team', to: '/attendance/team', icon: Users, group: 'Manage', show: (a) => a.tasks.can('hr.approve') },
  { label: 'Approvals', to: '/attendance/approvals', icon: ClipboardCheck, group: 'Manage', show: (a) => a.tasks.can('hr.approve') || a.tasks.can('tasks.view_department') },
  { label: 'Payroll', to: '/attendance/payroll', icon: Banknote, group: 'Manage', show: (a) => a.tasks.module('payroll') && a.tasks.can('hr.manage') },
  { label: 'HR settings', to: '/attendance/settings', icon: Settings2, group: 'Manage', show: (a) => a.tasks.can('hr.manage') },
];
