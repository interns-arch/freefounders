import { Settings2, ShieldCheck, Users } from 'lucide-react';
import type { NavItem } from '@/app/nav';

/** Admin workspace (owners and admins; the shell only shows it to them). */
export const ADMIN_NAV: NavItem[] = [
  { label: 'People & access', to: '/people', icon: Users },
  { label: 'Roles', to: '/roles', icon: ShieldCheck },
  { label: 'Settings', to: '/settings', icon: Settings2 },
];
