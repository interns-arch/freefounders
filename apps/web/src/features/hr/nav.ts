import { CalendarCheck } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** HR lives in the Tasks workspace (attendance, leave, approvals, HR settings). */
export const HR_NAV: NavItem[] = [{ label: 'Attendance & leave', to: '/tasks/hr', icon: CalendarCheck, group: 'People' }];
