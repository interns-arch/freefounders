/**
 * Count badges (PLAN.md §19.42): the numbers behind the red counters on tabs, menu items and the phone bottom bar.
 * Plain functions (no React) so they are unit-tested; the hook is in badges.ts.
 */

/** GET /tasks/api/badges/ */
export interface TasksBadgesResponse {
  tasks?: { my_tasks?: number; to_accept?: number; requests?: number };
  hr?: { leave?: number; corrections?: number; approvals?: number };
  /** Visitors (PLAN.md §22): QR sign-ins waiting at the gate (gate only), my visitors waiting for my Allow, my parcels at the gate. */
  visitors?: { waiting?: number; approvals?: number; parcels?: number };
}

/** GET /assets/api/badges */
export interface AssetsBadgesResponse {
  approve?: number;
  fulfil?: number;
  tickets?: number;
  exits?: number;
}

export interface Badges {
  /** My Tasks (open / in progress, assigned to me), To accept (work waiting for my review), Requests (to decide). */
  tasks: { myTasks: number; toAccept: number; requests: number; total: number };
  /** Approvals = leave + attendance corrections I may decide. */
  attendance: { leave: number; corrections: number; approvals: number; total: number };
  /** Requests = approve + fulfil; tickets assigned to me or unassigned; exits with assets to collect. */
  assets: { approve: number; fulfil: number; requests: number; tickets: number; exits: number; total: number };
  /** Waiting at the gate (guards) + my visitors waiting for my answer (hosts) + my parcels at the gate. */
  visitors: { waiting: number; approvals: number; parcels: number; total: number };
  total: number;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Both services' answers as one shape (a missing or failed service counts as zero). */
export function toBadges(t: TasksBadgesResponse | null | undefined, a: AssetsBadgesResponse | null | undefined): Badges {
  const myTasks = n(t?.tasks?.my_tasks);
  const toAccept = n(t?.tasks?.to_accept);
  const requests = n(t?.tasks?.requests);
  const leave = n(t?.hr?.leave);
  const corrections = n(t?.hr?.corrections);
  const approve = n(a?.approve);
  const fulfil = n(a?.fulfil);
  const tickets = n(a?.tickets);
  const exits = n(a?.exits);
  const tasks = { myTasks, toAccept, requests, total: myTasks + toAccept + requests };
  const attendance = { leave, corrections, approvals: leave + corrections, total: leave + corrections };
  const assets = { approve, fulfil, requests: approve + fulfil, tickets, exits, total: approve + fulfil + tickets + exits };
  const waiting = n(t?.visitors?.waiting);
  const visitorApprovals = n(t?.visitors?.approvals);
  const parcels = n(t?.visitors?.parcels);
  const visitors = { waiting, approvals: visitorApprovals, parcels, total: waiting + visitorApprovals + parcels };
  return { tasks, attendance, assets, visitors, total: tasks.total + attendance.total + assets.total + visitors.total };
}

export const NO_BADGES: Badges = toBadges(null, null);

/** The text in a counter: '' for none (hidden), 1–99, then "99+". */
export function countLabel(value: number | null | undefined): string {
  const v = n(value);
  if (!v) return '';
  return v > 99 ? '99+' : String(v);
}
