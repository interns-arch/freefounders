import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { PRIORITIES, TICKET_STATUSES, TICKET_TYPES, type TicketInput, type TicketUpdateInput } from '@eam/shared';
import { type Actor, assertCan, can } from '../../common/actor';
import { badRequest, likePattern, listFilter, listParams, notFound, uuidParam } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assets, tickets, users } from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';
import { NotificationsService } from '../../core/notifications.service';
import { SequenceService } from '../../core/sequence.service';
import { PRIORITY_RANK } from './queue.service';

/** Tickets: issues, damage, loss or repair requests raised against an asset. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
  ) {}

  async list(actor: Actor, q: Record<string, string>) {
    const p = listParams(q, { sort: 'createdAt', dir: 'desc' });
    const conds: SQL[] = [];
    if (!can(actor, 'ticket:manage')) conds.push(eq(tickets.reportedBy, actor.userId ?? '00000000-0000-0000-0000-000000000000'));
    const statuses = listFilter(q.status, TICKET_STATUSES);
    if (statuses.length) conds.push(inArray(tickets.status, statuses));
    const priorities = listFilter(q.priority, PRIORITIES);
    if (priorities.length) conds.push(inArray(tickets.priority, priorities));
    const types = listFilter(q.type, TICKET_TYPES);
    if (types.length) conds.push(inArray(tickets.type, types));
    const assetId = uuidParam(q.assetId);
    if (assetId) conds.push(eq(tickets.assetId, assetId));
    if (q.mine === '1' && actor.userId) conds.push(eq(tickets.assigneeId, actor.userId));
    if (p.search) {
      const like = likePattern(p.search);
      conds.push(or(ilike(tickets.number, like), ilike(tickets.title, like), ilike(assets.assetTag, like), ilike(tickets.reportedByName, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const db = this.dbs.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ ticket: tickets, assetTag: assets.assetTag, assetName: assets.name, assigneeName: users.name })
        .from(tickets)
        .leftJoin(assets, eq(assets.id, tickets.assetId))
        .leftJoin(users, eq(users.id, tickets.assigneeId))
        .where(where)
        .orderBy(
          sql`case ${tickets.status} when 'OPEN' then 0 when 'IN_PROGRESS' then 1 else 2 end`,
          PRIORITY_RANK(tickets.priority),
          desc(tickets.createdAt),
        )
        .limit(p.pageSize)
        .offset(p.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(tickets).leftJoin(assets, eq(assets.id, tickets.assetId)).where(where),
    ]);
    return { items: rows.map(({ ticket, ...rest }) => ({ ...ticket, ...rest })), total, page: p.page, pageSize: p.pageSize };
  }

  async get(actor: Actor, id: string) {
    const [row] = await this.dbs.db
      .select({ ticket: tickets, assetTag: assets.assetTag, assetName: assets.name, assigneeName: users.name })
      .from(tickets)
      .leftJoin(assets, eq(assets.id, tickets.assetId))
      .leftJoin(users, eq(users.id, tickets.assigneeId))
      .where(eq(tickets.id, id));
    if (!row || (!can(actor, 'ticket:manage') && row.ticket.reportedBy !== actor.userId)) throw notFound('Ticket');
    const history = await this.history.list({ entityType: 'TICKET', entityId: id }, { page: 1, pageSize: 100, offset: 0, search: '' });
    return { ...row.ticket, assetTag: row.assetTag, assetName: row.assetName, assigneeName: row.assigneeName, history: history.items };
  }

  async create(actor: Actor, input: TicketInput) {
    assertCan(actor, 'ticket:create');
    return this.dbs.tx(async (db) => {
      let assetLabel = '';
      if (input.assetId) {
        const [a] = await db.select({ assetTag: assets.assetTag, name: assets.name }).from(assets).where(eq(assets.id, input.assetId));
        if (!a) throw badRequest('Asset not found', { assetId: 'Not found' });
        assetLabel = ` on ${a.assetTag}`;
      }
      const number = await this.sequences.next('TKT', 5);
      const [row] = await db
        .insert(tickets)
        .values({ ...input, number, reportedBy: actor.userId, reportedByName: actor.name, reporterEmployeeId: actor.employeeId })
        .returning();
      await this.history.record(actor, {
        entityType: 'TICKET',
        entityId: row.id,
        entityLabel: number,
        action: 'CREATED',
        summary: `${number} raised${assetLabel}: ${row.title}`,
        assetId: row.assetId,
        employeeId: actor.employeeId,
      });
      if (row.assetId) {
        await this.history.record(actor, {
          entityType: 'ASSET',
          entityId: row.assetId,
          action: 'TICKET_RAISED',
          summary: `${number} (${row.type.toLowerCase()}): ${row.title}`,
          metadata: { ticketId: row.id },
        });
      }
      await this.notifications.notifyPermission(
        'ticket:manage',
        { type: 'TICKET_CREATED', title: `${number}: ${row.title}`, body: `${row.priority} · ${row.type}${assetLabel}`, link: `/tickets?open=${row.id}` },
        actor.userId,
      );
      return row;
    });
  }

  async update(actor: Actor, id: string, input: TicketUpdateInput) {
    assertCan(actor, 'ticket:manage');
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(tickets).where(eq(tickets.id, id)).for('update');
      if (!before) throw notFound('Ticket');
      const changes = diffChanges(before, input, { status: 'Status', priority: 'Priority', assigneeId: 'Assignee', resolution: 'Resolution' });
      if (!changes.length) return before;
      const resolving = input.status && ['RESOLVED', 'CLOSED'].includes(input.status) && !before.resolvedAt;
      const [row] = await db
        .update(tickets)
        .set({ ...input, ...(resolving ? { resolvedAt: new Date() } : {}), updatedAt: new Date() })
        .where(eq(tickets.id, id))
        .returning();
      await this.history.record(actor, {
        entityType: 'TICKET',
        entityId: id,
        entityLabel: before.number,
        action: input.status && input.status !== before.status ? `STATUS_${input.status}` : 'UPDATED',
        summary: input.status && input.status !== before.status ? `Status changed to ${input.status.replace('_', ' ').toLowerCase()}` : 'Ticket updated',
        changes,
        assetId: before.assetId,
      });
      if (input.status && input.status !== before.status && before.reportedBy && before.reportedBy !== actor.userId) {
        await this.notifications.notifyUsers([before.reportedBy], {
          type: 'TICKET_UPDATED',
          title: `${before.number} is now ${input.status.replace('_', ' ').toLowerCase()}`,
          body: input.resolution ?? null,
          link: `/tickets?open=${id}`,
        });
      }
      if (input.assigneeId && input.assigneeId !== before.assigneeId && input.assigneeId !== actor.userId) {
        await this.notifications.notifyUsers([input.assigneeId], {
          type: 'TICKET_ASSIGNED',
          title: `${before.number} assigned to you`,
          body: before.title,
          link: `/tickets?open=${id}`,
        });
      }
      return row;
    });
  }
}
