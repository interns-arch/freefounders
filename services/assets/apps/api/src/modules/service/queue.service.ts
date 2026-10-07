import { Injectable } from '@nestjs/common';
import { type AnyColumn, eq, inArray, sql } from 'drizzle-orm';
import { PRIORITIES, type Priority, type RequestStatus } from '@eam/shared';
import { type Actor, can } from '../../common/actor';
import { listFilter, today } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assetRequests, assets, assetTypes, employees, onboardingCases, tickets, users } from '../../db/schema';

export const PRIORITY_RANK = (col: AnyColumn) => sql`case ${col} when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`;

const RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const QUEUE_LIMIT = 300;

export interface QueueItem {
  kind: 'TICKET' | 'REQUEST' | 'ONBOARDING';
  id: string;
  number: string;
  title: string;
  detail: string;
  priority: Priority;
  status: string;
  createdAt: Date;
  dueDate: string | null;
  overdue: boolean;
  assigneeName: string | null;
  link: string;
}

/**
 * One worklist of everything waiting on the support team (open tickets, requests to approve or
 * fulfil), ordered URGENT → LOW, then overdue first, then oldest first.
 */
@Injectable()
export class QueueService {
  constructor(private readonly dbs: DbService) {}

  async list(actor: Actor, q: Record<string, string>) {
    const db = this.dbs.db;
    const now = today();
    const requestStatuses: RequestStatus[] = [...(can(actor, 'request:approve') ? (['PENDING'] as const) : []), ...(can(actor, 'request:fulfil') ? (['APPROVED'] as const) : [])];

    const [ticketRows, requestRows, joinerRows] = await Promise.all([
      can(actor, 'ticket:manage')
        ? db
            .select({ t: tickets, assetTag: assets.assetTag, assigneeName: users.name })
            .from(tickets)
            .leftJoin(assets, eq(assets.id, tickets.assetId))
            .leftJoin(users, eq(users.id, tickets.assigneeId))
            .where(inArray(tickets.status, ['OPEN', 'IN_PROGRESS']))
            .orderBy(PRIORITY_RANK(tickets.priority), tickets.createdAt)
            .limit(QUEUE_LIMIT)
        : [],
      requestStatuses.length
        ? db
            .select({
              r: assetRequests,
              employeeName: employees.fullName,
              typeName: sql<string>`coalesce(${assetTypes.name}, ${assetRequests.itemName})`,
            })
            .from(assetRequests)
            .innerJoin(employees, eq(employees.id, assetRequests.employeeId))
            .leftJoin(assetTypes, eq(assetTypes.id, assetRequests.assetTypeId))
            .where(inArray(assetRequests.status, requestStatuses))
            .orderBy(PRIORITY_RANK(assetRequests.priority), assetRequests.createdAt)
            .limit(QUEUE_LIMIT)
        : [],
      // New joiners IT still has to prepare for.
      can(actor, 'asset:assign')
        ? db
            .select({
              c: onboardingCases,
              employeeName: employees.fullName,
              designation: employees.designation,
              toPrepare: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id and i.status in ('PLANNED', 'PREPARED'))`,
            })
            .from(onboardingCases)
            .innerJoin(employees, eq(employees.id, onboardingCases.employeeId))
            // Waiting for approval, or approved with items still to assign.
            .where(sql`${onboardingCases.status} = 'SUBMITTED' or (${onboardingCases.status} = 'APPROVED' and exists (select 1 from onboarding_items i where i.case_id = onboarding_cases.id and i.status in ('PLANNED', 'PREPARED')))`)
            .limit(QUEUE_LIMIT)
        : [],
    ]);
    const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(now)) / 86_400_000);

    const all: QueueItem[] = [
      ...ticketRows.map(({ t, assetTag, assigneeName }) => ({
        kind: 'TICKET' as const,
        id: t.id,
        number: t.number,
        title: t.title,
        detail: [t.reportedByName, assetTag].filter(Boolean).join(' · '),
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        dueDate: null,
        overdue: false,
        assigneeName,
        link: `/tickets?open=${t.id}`,
      })),
      ...requestRows.map(({ r, employeeName, typeName }) => ({
        kind: 'REQUEST' as const,
        id: r.id,
        number: r.number,
        title: `${r.quantity > 1 ? `${r.quantity} × ` : ''}${typeName}`,
        detail: `For ${employeeName}`,
        priority: r.priority,
        status: r.status,
        createdAt: r.createdAt,
        dueDate: r.neededBy,
        overdue: !!r.neededBy && r.neededBy < now,
        assigneeName: null,
        link: `/requests?status=${r.status}&search=${encodeURIComponent(r.number)}`,
      })),
    ];
    for (const { c, employeeName, designation, toPrepare } of joinerRows) {
      const d = daysTo(c.joinDate);
      all.push({
        kind: 'ONBOARDING',
        id: c.id,
        number: c.caseNumber,
        title: `New joiner: ${employeeName}`,
        detail: `${toPrepare} item${toPrepare === 1 ? '' : 's'} ${c.status === 'SUBMITTED' ? 'requested' : 'to assign'}${designation ? ` · ${designation}` : ''}`,
        priority: d <= 1 ? 'URGENT' : d <= 3 ? 'HIGH' : d <= 7 ? 'MEDIUM' : 'LOW',
        status: c.status,
        createdAt: c.submittedAt ?? c.createdAt,
        dueDate: c.joinDate,
        overdue: c.joinDate < now,
        assigneeName: null,
        link: `/onboarding/${c.id}`,
      });
    }
    all.sort((a, b) => RANK[a.priority] - RANK[b.priority] || Number(b.overdue) - Number(a.overdue) || a.createdAt.getTime() - b.createdAt.getTime());

    const counts = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
    for (const i of all) counts[i.priority]++;

    const priorities = listFilter(q.priority, PRIORITIES);
    const kind = q.kind === 'TICKET' || q.kind === 'REQUEST' || q.kind === 'ONBOARDING' ? q.kind : null;
    const conds: ((i: QueueItem) => boolean)[] = [];
    if (priorities.length) conds.push((i) => priorities.includes(i.priority));
    if (kind) conds.push((i) => i.kind === kind);
    const items = all.filter((i) => conds.every((c) => c(i)));
    return { items, counts, total: all.length, overdue: all.filter((i) => i.overdue).length };
  }
}
