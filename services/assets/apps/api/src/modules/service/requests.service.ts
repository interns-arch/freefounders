import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { PRIORITIES, REQUEST_STATUSES, type RequestInput } from '@eam/shared';
import { type Actor, assertCan, canAny } from '../../common/actor';
import { badRequest, conflict, likePattern, listFilter, listParams, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assetCategories, assetRequests, assets, assetTypes, departments, employees } from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { NotificationsService } from '../../core/notifications.service';
import { SequenceService } from '../../core/sequence.service';
import { AllocationService } from '../assets/allocation.service';
import { PRIORITY_RANK } from './queue.service';

/** Asset requests: employee asks → manager approves → IT fulfils by assigning an asset. */
@Injectable()
export class RequestsService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
    private readonly allocation: AllocationService,
  ) {}

  private seesAll(actor: Actor) {
    return canAny(actor, 'request:approve', 'request:fulfil');
  }

  async list(actor: Actor, q: Record<string, string>) {
    const p = listParams(q, { sort: 'createdAt', dir: 'desc' });
    const conds: SQL[] = [];
    if (!this.seesAll(actor)) {
      if (!actor.employeeId) return { items: [], total: 0, page: p.page, pageSize: p.pageSize };
      conds.push(eq(assetRequests.employeeId, actor.employeeId));
    }
    const statuses = listFilter(q.status, REQUEST_STATUSES);
    if (statuses.length) conds.push(inArray(assetRequests.status, statuses));
    const priorities = listFilter(q.priority, PRIORITIES);
    if (priorities.length) conds.push(inArray(assetRequests.priority, priorities));
    if (p.search) {
      const like = likePattern(p.search);
      conds.push(or(ilike(assetRequests.number, like), ilike(employees.fullName, like), ilike(assetTypes.name, like), ilike(assetRequests.itemName, like), ilike(assetRequests.reason, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const db = this.dbs.db;
    const base = () =>
      db
        .select({
          request: assetRequests,
          employeeName: employees.fullName,
          employeeCode: employees.employeeCode,
          departmentName: departments.name,
          typeName: sql<string>`coalesce(${assetTypes.name}, ${assetRequests.itemName})`,
          custom: sql<boolean>`${assetRequests.assetTypeId} is null`,
          typeIcon: assetTypes.icon,
          categoryName: assetCategories.name,
          fulfilledAssetTag: assets.assetTag,
          availableCount: sql<number>`(select coalesce(sum(case when a.tracking_mode = 'QUANTITY' then a.available_quantity else 1 end), 0)::int from assets a where a.asset_type_id = ${assetRequests.assetTypeId} and a.status in ('AVAILABLE', 'IN_INVENTORY') and (a.tracking_mode = 'INDIVIDUAL' or a.available_quantity > 0))`,
        })
        .from(assetRequests)
        .innerJoin(employees, eq(employees.id, assetRequests.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(assetTypes, eq(assetTypes.id, assetRequests.assetTypeId))
        .leftJoin(assetCategories, eq(assetCategories.id, assetTypes.categoryId))
        .leftJoin(assets, eq(assets.id, assetRequests.fulfilledAssetId));
    const [rows, [{ total }]] = await Promise.all([
      base()
        .where(where)
        .orderBy(
          sql`case ${assetRequests.status} when 'PENDING' then 0 when 'APPROVED' then 1 else 2 end`,
          sql`case when ${assetRequests.status} in ('PENDING', 'APPROVED') then ${PRIORITY_RANK(assetRequests.priority)} else 0 end`,
          p.dir === 'asc' ? asc(assetRequests.createdAt) : desc(assetRequests.createdAt),
        )
        .limit(p.pageSize)
        .offset(p.offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(assetRequests)
        .innerJoin(employees, eq(employees.id, assetRequests.employeeId))
        .leftJoin(assetTypes, eq(assetTypes.id, assetRequests.assetTypeId))
        .where(where),
    ]);
    return { items: rows.map(({ request, ...rest }) => ({ ...request, ...rest })), total, page: p.page, pageSize: p.pageSize };
  }

  private async load(id: string) {
    const [r] = await this.dbs.db.select().from(assetRequests).where(eq(assetRequests.id, id)).for('update');
    if (!r) throw notFound('Request');
    return r;
  }

  async create(actor: Actor, input: RequestInput) {
    assertCan(actor, 'request:create');
    const employeeId = input.employeeId && this.seesAll(actor) ? input.employeeId : actor.employeeId;
    if (!employeeId) throw badRequest('Choose the employee this request is for', { employeeId: 'Required' });
    return this.dbs.tx(async (db) => {
      const [emp] = await db.select({ fullName: employees.fullName, status: employees.status }).from(employees).where(eq(employees.id, employeeId));
      if (!emp) throw badRequest('Employee not found', { employeeId: 'Not found' });
      if (emp.status === 'EXITED') throw badRequest(`${emp.fullName} has exited`);
      let what = input.itemName ?? '';
      if (input.assetTypeId) {
        const [type] = await db.select({ name: assetTypes.name }).from(assetTypes).where(eq(assetTypes.id, input.assetTypeId));
        if (!type) throw badRequest('Asset type not found', { assetTypeId: 'Not found' });
        what = type.name;
      }
      const number = await this.sequences.next('REQ', 5);
      const [row] = await db
        .insert(assetRequests)
        .values({ ...input, employeeId, number, requestedBy: actor.userId, requestedByName: actor.name })
        .returning();
      await this.history.record(actor, {
        entityType: 'REQUEST',
        entityId: row.id,
        entityLabel: number,
        action: 'CREATED',
        summary: `${emp.fullName} requested ${input.quantity} × ${what}`,
        employeeId,
      });
      await this.notifications.notifyPermission(
        'request:approve',
        { type: 'REQUEST_CREATED', title: `New request ${number}`, body: `${emp.fullName} needs ${input.quantity} × ${what}`, link: `/requests?open=${row.id}` },
        actor.userId,
      );
      return row;
    });
  }

  async decide(actor: Actor, id: string, decision: 'APPROVE' | 'REJECT', note?: string | null) {
    assertCan(actor, 'request:approve');
    return this.dbs.tx(async (db) => {
      const r = await this.load(id);
      if (r.status !== 'PENDING') throw conflict(`This request is already ${r.status.toLowerCase()}.`);
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const [row] = await db
        .update(assetRequests)
        .set({ status, decidedByName: actor.name, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date() })
        .where(eq(assetRequests.id, id))
        .returning();
      await this.history.record(actor, {
        entityType: 'REQUEST',
        entityId: id,
        entityLabel: r.number,
        action: status,
        summary: `Request ${status.toLowerCase()}${note ? ` — ${note}` : ''}`,
        employeeId: r.employeeId,
      });
      await this.notifications.notifyEmployee(r.employeeId, {
        type: `REQUEST_${status}`,
        title: `Your request ${r.number} was ${status.toLowerCase()}`,
        body: note ?? null,
        link: `/requests?open=${id}`,
      });
      if (status === 'APPROVED') {
        await this.notifications.notifyPermission(
          'request:fulfil',
          { type: 'REQUEST_APPROVED', title: `${r.number} approved — ready to fulfil`, body: null, link: `/requests?open=${id}` },
          actor.userId,
        );
      }
      return row;
    });
  }

  async fulfil(actor: Actor, id: string, assetId: string, notes?: string | null) {
    assertCan(actor, 'request:fulfil');
    return this.dbs.tx(async (db) => {
      const r = await this.load(id);
      if (r.status !== 'APPROVED') throw conflict(r.status === 'PENDING' ? 'Approve the request first.' : `This request is already ${r.status.toLowerCase()}.`);
      const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
      if (!asset) throw badRequest('Asset not found', { assetId: 'Not found' });
      // A free-text request can be fulfilled with any asset; a catalog request needs that type.
      if (r.assetTypeId && asset.assetTypeId !== r.assetTypeId) {
        const [type] = await db.select({ name: assetTypes.name }).from(assetTypes).where(eq(assetTypes.id, r.assetTypeId));
        throw badRequest(`Pick a ${type?.name ?? 'matching'} asset`, { assetId: 'Wrong asset type' });
      }
      const alloc = await this.allocation.assign(actor, assetId, {
        holderType: 'EMPLOYEE',
        holderId: r.employeeId,
        quantity: asset.trackingMode === 'QUANTITY' ? r.quantity : 1,
        notes: notes ?? `Fulfils ${r.number}`,
      });
      const [row] = await db
        .update(assetRequests)
        .set({ status: 'FULFILLED', fulfilledAssetId: assetId, fulfilledAt: new Date(), updatedAt: new Date() })
        .where(eq(assetRequests.id, id))
        .returning();
      await this.history.record(actor, {
        entityType: 'REQUEST',
        entityId: id,
        entityLabel: r.number,
        action: 'FULFILLED',
        summary: `Fulfilled with ${asset.assetTag} ${asset.name}`,
        employeeId: r.employeeId,
        assetId,
      });
      return { ...row, allocationId: alloc.id };
    });
  }

  async cancel(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const r = await this.load(id);
      const own = actor.employeeId === r.employeeId || actor.userId === r.requestedBy;
      if (!own && !canAny(actor, 'request:approve')) throw new ForbiddenException('You can only cancel your own requests');
      if (r.status !== 'PENDING' && r.status !== 'APPROVED') throw conflict(`This request is already ${r.status.toLowerCase()}.`);
      const [row] = await db.update(assetRequests).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(assetRequests.id, id)).returning();
      await this.history.record(actor, {
        entityType: 'REQUEST',
        entityId: id,
        entityLabel: r.number,
        action: 'CANCELLED',
        summary: 'Request cancelled',
        employeeId: r.employeeId,
      });
      return row;
    });
  }
}
