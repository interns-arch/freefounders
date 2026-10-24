import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { type Actor, can } from '../../common/actor';
import { DbService } from '../../db/db.service';
import { assetRequests, employees, exitCases, tickets } from '../../db/schema';

export interface AssetBadges {
  /** Pending requests this person may approve (approvers: all; a manager: their team's, never their own). */
  approve: number;
  /** Approved requests waiting to be handed out (fulfillers). */
  fulfil: number;
  /** approve + fulfil: the Requests menu item. */
  requests: number;
  /** Open / in-progress tickets assigned to me, plus open unassigned ones (ticket managers). */
  tickets: number;
  /** Open exit cases with assets still to collect (exit managers). */
  exits: number;
  total: number;
}

/**
 * Count badges (PLAN.md §19.42): what waits for the signed-in person in Assets, as a few COUNT queries in the request's
 * company schema. Same visibility rules as the lists they stand for (requests, tickets, exits).
 */
@Injectable()
export class BadgesService {
  constructor(private readonly dbs: DbService) {}

  async counts(actor: Actor): Promise<AssetBadges> {
    const db = this.dbs.db;
    const count = sql<number>`count(*)::int`;
    const approveWhere = (): SQL | null => {
      if (can(actor, 'request:approve')) return eq(assetRequests.status, 'PENDING');
      if (!actor.employeeId) return null;
      return and(eq(assetRequests.status, 'PENDING'), eq(employees.managerId, actor.employeeId), ne(assetRequests.employeeId, actor.employeeId))!;
    };
    const aw = approveWhere();
    const [approve, fulfil, open, exits] = await Promise.all([
      aw
        ? db
            .select({ n: count })
            .from(assetRequests)
            .innerJoin(employees, eq(employees.id, assetRequests.employeeId))
            .where(aw)
            .then((r) => r[0]?.n ?? 0)
        : 0,
      can(actor, 'request:fulfil')
        ? db
            .select({ n: count })
            .from(assetRequests)
            .where(eq(assetRequests.status, 'APPROVED'))
            .then((r) => r[0]?.n ?? 0)
        : 0,
      can(actor, 'ticket:manage')
        ? db
            .select({ n: count })
            .from(tickets)
            .where(
              and(
                inArray(tickets.status, ['OPEN', 'IN_PROGRESS']),
                actor.userId ? or(eq(tickets.assigneeId, actor.userId), and(isNull(tickets.assigneeId), eq(tickets.status, 'OPEN'))) : and(isNull(tickets.assigneeId), eq(tickets.status, 'OPEN')),
              ),
            )
            .then((r) => r[0]?.n ?? 0)
        : 0,
      can(actor, 'exit:manage')
        ? db
            .select({ n: count })
            .from(exitCases)
            .where(and(eq(exitCases.status, 'OPEN'), sql`exists (select 1 from exit_items i where i.exit_case_id = ${exitCases.id} and i.status in ('PENDING', 'MISSING'))`))
            .then((r) => r[0]?.n ?? 0)
        : 0,
    ]);
    const requests = approve + fulfil;
    return { approve, fulfil, requests, tickets: open, exits, total: requests + open + exits };
  }
}
