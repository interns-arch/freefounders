import type { Permission } from '@eam/shared';

/** One line under each Assets permission in the Kaampilot role builder (PLAN.md §19.19). */
export const PERMISSION_HINTS: Record<Permission, string> = {
  'dashboard:view': 'The organisation dashboard: totals, alerts and recent activity.',
  'asset:view': 'See every asset, not only the ones they hold.',
  'asset:create': 'Add new assets, one by one or from a spreadsheet.',
  'asset:edit': "Change an asset's details and custom fields.",
  'asset:assign': 'Hand assets out, transfer and take them back; scanning, the priority queue and SIM cards.',
  'asset:lifecycle': 'Receive, retire or dispose of assets, and mark them lost or found.',
  'catalog:manage': 'Asset categories, types and their custom fields.',
  'org:manage': 'Companies, departments, locations and vendors.',
  'employee:view': 'See employee records and what each person holds.',
  'employee:manage': 'Add and edit employee records.',
  'employee:status': 'Put people on notice or leave, or start their exit.',
  'exit:view': 'See exit cases.',
  'exit:manage': 'Recover assets from people who are leaving.',
  'exit:override': 'Close an exit even with assets still out.',
  'request:create': 'Ask for an asset.',
  'request:approve': 'Approve or reject asset requests.',
  'request:fulfil': 'Hand out what an approved request asked for.',
  'ticket:create': 'Report a problem with an asset.',
  'ticket:manage': 'Work on every ticket, not only their own.',
  'maintenance:manage': 'Plan and record maintenance.',
  'history:view': 'The organisation-wide activity log.',
  'user:manage': "Assets' own users and roles (standalone installs).",
  'onboarding:manage': 'Plan the kit for new joiners.',
  'insights:leadership': 'The leadership overview, for the CEO.',
};
