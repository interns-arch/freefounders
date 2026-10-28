import type { Access } from '@kaampilot/core';
import { UsersRound } from '@/components/icons';
import type { NavItem } from '@/app/nav';

/**
 * Team 360 (PLAN.md §25): owners, admins, HR and anyone people report to. Its own menu entry under Home (not inside
 * Admin, so managers without Admin permissions get it too); on phones it is in More. The Tasks API decides whom they see.
 */
export const canOpenTeam = (a: Access) => a.tasks.on && !!a.tasks.me?.team360;

export const TEAM_LINK: NavItem = {
  label: 'Team',
  to: '/team',
  icon: UsersRound,
  show: canOpenTeam,
};
