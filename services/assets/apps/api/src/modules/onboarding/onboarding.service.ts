import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  ONBOARDING_STATUSES,
  type OnboardingAssignAllInput,
  type OnboardingCreateInput,
  type OnboardingIssueInput,
  type OnboardingItemInput,
  type OnboardingItemUpdateInput,
  type OnboardingKitInput,
  type OnboardingUpdateInput,
} from '@eam/shared';
import { type Actor, assertCan, can, canAny } from '../../common/actor';
import { badRequest, conflict, likePattern, listFilter, listParams, notFound, today } from '../../common/http';
import { DbService } from '../../db/db.service';
import {
  assetRequests,
  assets,
  assetTypes,
  departments,
  employees,
  locations,
  onboardingCases,
  onboardingItems,
  onboardingKits,
  users,
} from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { NotificationsService } from '../../core/notifications.service';
import { SequenceService } from '../../core/sequence.service';
import { AllocationService } from '../assets/allocation.service';
import { AuthService } from '../auth/auth.service';
import { EmployeesService } from '../employees/employees.service';

type CaseRow = typeof onboardingCases.$inferSelect;
const OPEN = ['DRAFT', 'SUBMITTED', 'APPROVED'] as const;
const READY_ASSET_STATUSES = ['AVAILABLE', 'IN_INVENTORY'];

const itemCounts = {
  itemsTotal: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id)`,
  itemsPlanned: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id and i.status = 'PLANNED')`,
  itemsPrepared: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id and i.status = 'PREPARED')`,
  itemsIssued: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id and i.status = 'ISSUED')`,
  itemsSkipped: sql<number>`(select count(*)::int from onboarding_items i where i.case_id = onboarding_cases.id and i.status = 'SKIPPED')`,
};

/**
 * Onboarding (pre-boarding): HR plans what a new joiner should get, IT prepares and issues it,
 * and on joining day the employee becomes Active. Anything not issued turns into asset requests.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
    private readonly allocation: AllocationService,
    private readonly auth: AuthService,
    private readonly employees: EmployeesService,
  ) {}

  private assertView(actor: Actor) {
    if (!canAny(actor, 'onboarding:manage', 'asset:assign')) assertCan(actor, 'onboarding:manage');
  }

  private async lockCase(id: string): Promise<CaseRow> {
    const [row] = await this.dbs.db.select().from(onboardingCases).where(eq(onboardingCases.id, id)).for('update');
    if (!row) throw notFound('Onboarding');
    return row;
  }

  private assertOpen(c: CaseRow) {
    if (!(OPEN as readonly string[]).includes(c.status)) throw conflict(`This onboarding is already ${c.status === 'COMPLETED' ? 'completed' : 'cancelled'}.`);
  }

  /** HR can change the plan until IT approves it; after that only IT can. */
  private assertCanEditPlan(actor: Actor, c: CaseRow) {
    if (c.status === 'APPROVED' && !can(actor, 'asset:assign')) throw conflict('IT has already approved this plan — ask IT to change it.');
  }

  private async employeeName(id: string) {
    const [e] = await this.dbs.db.select({ fullName: employees.fullName, code: employees.employeeCode }).from(employees).where(eq(employees.id, id));
    return e ? `${e.fullName} (${e.code})` : 'New joiner';
  }

  private async resolveItems(items: OnboardingItemInput[]) {
    const typeIds = [...new Set(items.map((i) => i.assetTypeId).filter((v): v is string => !!v))];
    const types = typeIds.length ? await this.dbs.db.select({ id: assetTypes.id, name: assetTypes.name }).from(assetTypes).where(inArray(assetTypes.id, typeIds)) : [];
    const names = new Map(types.map((t) => [t.id, t.name]));
    return items.map((i) => {
      if (i.assetTypeId && !names.has(i.assetTypeId)) throw badRequest('That asset type no longer exists', { assetTypeId: 'Not found' });
      return { assetTypeId: i.assetTypeId ?? null, itemName: i.assetTypeId ? names.get(i.assetTypeId)! : i.itemName!, quantity: i.quantity, notes: i.notes ?? null };
    });
  }

  private async insertItems(caseId: string, items: OnboardingItemInput[]) {
    if (!items.length) return [];
    const resolved = await this.resolveItems(items);
    const [{ n }] = await this.dbs.db.select({ n: sql<number>`coalesce(max(${onboardingItems.sortOrder}), -1)::int` }).from(onboardingItems).where(eq(onboardingItems.caseId, caseId));
    return this.dbs.db
      .insert(onboardingItems)
      .values(resolved.map((r, i) => ({ ...r, caseId, sortOrder: n + 1 + i })))
      .returning();
  }

  // ─── Read ────────────────────────────────────────────────────────────────
  async list(actor: Actor, q: Record<string, string>) {
    this.assertView(actor);
    const p = listParams(q, { sort: 'joinDate', dir: 'asc' });
    const conds: SQL[] = [];
    const statuses = listFilter(q.status, ONBOARDING_STATUSES);
    conds.push(inArray(onboardingCases.status, statuses.length ? statuses : [...OPEN]));
    if (p.search) {
      const like = likePattern(p.search);
      conds.push(or(ilike(onboardingCases.caseNumber, like), ilike(employees.fullName, like), ilike(employees.employeeCode, like), ilike(employees.designation, like))!);
    }
    const where = and(...conds);
    const closed = statuses.length && statuses.every((s) => s === 'COMPLETED' || s === 'CANCELLED');
    const db = this.dbs.db;
    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          id: onboardingCases.id,
          caseNumber: onboardingCases.caseNumber,
          status: onboardingCases.status,
          joinDate: onboardingCases.joinDate,
          createdByName: onboardingCases.createdByName,
          completedAt: onboardingCases.completedAt,
          employeeId: employees.id,
          employeeName: employees.fullName,
          employeeCode: employees.employeeCode,
          designation: employees.designation,
          departmentName: departments.name,
          ...itemCounts,
        })
        .from(onboardingCases)
        .innerJoin(employees, eq(employees.id, onboardingCases.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(where)
        .orderBy(closed ? desc(onboardingCases.updatedAt) : asc(onboardingCases.joinDate), asc(onboardingCases.caseNumber))
        .limit(p.pageSize)
        .offset(p.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(onboardingCases).innerJoin(employees, eq(employees.id, onboardingCases.employeeId)).where(where),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async get(actor: Actor, id: string) {
    this.assertView(actor);
    const db = this.dbs.db;
    const [row] = await db
      .select({
        c: onboardingCases,
        employee: {
          id: employees.id,
          employeeCode: employees.employeeCode,
          fullName: employees.fullName,
          designation: employees.designation,
          email: employees.email,
          phone: employees.phone,
          status: employees.status,
          departmentName: departments.name,
          locationName: locations.name,
        },
        login: { id: users.id, isActive: users.isActive },
      })
      .from(onboardingCases)
      .innerJoin(employees, eq(employees.id, onboardingCases.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(locations, eq(locations.id, employees.locationId))
      .leftJoin(users, eq(users.employeeId, employees.id))
      .where(eq(onboardingCases.id, id));
    if (!row) throw notFound('Onboarding');
    const items = await db
      .select({
        item: onboardingItems,
        typeIcon: assetTypes.icon,
        consumable: assetTypes.consumable,
        assetTag: assets.assetTag,
        assetName: assets.name,
        assetStatus: assets.status,
        assetHolderName: assets.holderName,
        assetTrackingMode: assets.trackingMode,
      })
      .from(onboardingItems)
      .leftJoin(assetTypes, eq(assetTypes.id, onboardingItems.assetTypeId))
      .leftJoin(assets, eq(assets.id, onboardingItems.preparedAssetId))
      .where(eq(onboardingItems.caseId, id))
      .orderBy(asc(onboardingItems.sortOrder), asc(onboardingItems.createdAt));

    const list = items.map(({ item, ...a }) => ({
      ...item,
      typeIcon: a.typeIcon,
      consumable: !!a.consumable,
      preparedAsset: item.preparedAssetId ? { id: item.preparedAssetId, assetTag: a.assetTag, name: a.assetName, status: a.assetStatus, holderName: a.assetHolderName, trackingMode: a.assetTrackingMode } : null,
      // The pick is only a note: warn when that asset has since gone to someone else.
      preparedUnavailable: item.status === 'PREPARED' && !!a.assetStatus && !READY_ASSET_STATUSES.includes(a.assetStatus),
    }));
    const count = (s: string) => list.filter((i) => i.status === s).length;
    const counts = { total: list.length, planned: count('PLANNED'), prepared: count('PREPARED'), issued: count('ISSUED'), skipped: count('SKIPPED') };
    return {
      ...row.c,
      employee: row.employee,
      login: row.login?.id ? row.login : null,
      items: list,
      counts,
      ready: counts.total > 0 && counts.planned + counts.prepared === 0,
    };
  }

  async timeline(actor: Actor, id: string) {
    this.assertView(actor);
    return this.history.list({ entityType: 'ONBOARDING_CASE', entityId: id }, { page: 1, pageSize: 200, offset: 0, search: '' });
  }

  // ─── HR: plan ────────────────────────────────────────────────────────────
  async create(actor: Actor, input: OnboardingCreateInput) {
    assertCan(actor, 'onboarding:manage');
    const { items, kitId, notes, ...person } = input;
    return this.dbs.tx(async (db) => {
      const emp = await this.employees.create(actor, { ...person, joinDate: input.joinDate });
      await db.update(employees).set({ status: 'JOINING', updatedAt: new Date() }).where(eq(employees.id, emp.id));
      const caseNumber = await this.sequences.next('ONB', 5);
      const [c] = await db
        .insert(onboardingCases)
        .values({ caseNumber, employeeId: emp.id, joinDate: input.joinDate, notes: notes ?? null, createdBy: actor.userId, createdByName: actor.name })
        .returning();
      let planned: OnboardingItemInput[] = items;
      if (kitId) {
        const [kit] = await db.select().from(onboardingKits).where(eq(onboardingKits.id, kitId));
        if (!kit) throw badRequest('That kit no longer exists', { kitId: 'Not found' });
        planned = [...kit.items.map((k) => ({ ...k, assetTypeId: k.assetTypeId ?? undefined, itemName: k.itemName ?? undefined, notes: k.notes ?? undefined })), ...items];
      }
      await this.insertItems(c.id, planned);
      await this.history.recordMany(actor, [
        {
          entityType: 'ONBOARDING_CASE',
          entityId: c.id,
          entityLabel: caseNumber,
          action: 'CREATED',
          summary: `Onboarding planned for ${emp.fullName}, joining ${input.joinDate}`,
          employeeId: emp.id,
        },
        { entityType: 'EMPLOYEE', entityId: emp.id, entityLabel: emp.fullName, action: 'ONBOARDING_STARTED', summary: `New joiner — onboarding ${caseNumber}` },
      ]);
      return { id: c.id, caseNumber, employeeId: emp.id };
    });
  }

  async update(actor: Actor, id: string, input: OnboardingUpdateInput) {
    assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      await db
        .update(onboardingCases)
        .set({ ...(input.joinDate ? { joinDate: input.joinDate } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), updatedAt: new Date() })
        .where(eq(onboardingCases.id, id));
      if (input.joinDate && input.joinDate !== c.joinDate) {
        await db.update(employees).set({ joinDate: input.joinDate, updatedAt: new Date() }).where(eq(employees.id, c.employeeId));
        await this.history.record(actor, {
          entityType: 'ONBOARDING_CASE',
          entityId: id,
          entityLabel: c.caseNumber,
          action: 'UPDATED',
          summary: `Joining date moved to ${input.joinDate}`,
          employeeId: c.employeeId,
          changes: [{ field: 'joinDate', label: 'Joining date', from: c.joinDate, to: input.joinDate }],
        });
      }
      return { ok: true };
    });
  }

  async addItems(actor: Actor, id: string, items: OnboardingItemInput[]) {
    if (!canAny(actor, 'onboarding:manage', 'asset:assign')) assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async () => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      this.assertCanEditPlan(actor, c);
      const added = await this.insertItems(id, items);
      await this.history.record(actor, {
        entityType: 'ONBOARDING_CASE',
        entityId: id,
        entityLabel: c.caseNumber,
        action: 'ITEM_ADDED',
        summary: added.length === 1 ? `${added[0].quantity > 1 ? `${added[0].quantity} × ` : ''}${added[0].itemName} added to the plan` : `${added.length} items added to the plan`,
        employeeId: c.employeeId,
      });
      return added;
    });
  }

  async submit(actor: Actor, id: string) {
    assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      if (c.status !== 'DRAFT') throw conflict('This onboarding has already been sent to IT.');
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(onboardingItems).where(eq(onboardingItems.caseId, id));
      if (!n) throw badRequest('Add at least one item they need.');
      await db
        .update(onboardingCases)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), submittedByName: actor.name, returnNote: null, updatedAt: new Date() })
        .where(eq(onboardingCases.id, id));
      const who = await this.employeeName(c.employeeId);
      await this.history.record(actor, {
        entityType: 'ONBOARDING_CASE',
        entityId: id,
        entityLabel: c.caseNumber,
        action: 'SUBMITTED',
        summary: `Sent to IT for approval — ${n} item${n > 1 ? 's' : ''}`,
        employeeId: c.employeeId,
      });
      await this.notifications.notifyPermission(
        'asset:assign',
        { type: 'ONBOARDING_SUBMITTED', title: `New joiner to approve: ${who}`, body: `Joins ${c.joinDate} — ${n} item${n > 1 ? 's' : ''} requested (${c.caseNumber})`, link: `/onboarding/${id}` },
        actor.userId,
      );
      return { ok: true };
    });
  }

  /** IT accepts HR's list; assigning can start. */
  async approve(actor: Actor, id: string) {
    assertCan(actor, 'asset:assign');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      if (c.status !== 'SUBMITTED') throw conflict(c.status === 'DRAFT' ? 'HR has not sent this yet.' : 'This onboarding is not waiting for approval.');
      await db.update(onboardingCases).set({ status: 'APPROVED', approvedAt: new Date(), approvedByName: actor.name, updatedAt: new Date() }).where(eq(onboardingCases.id, id));
      const who = await this.employeeName(c.employeeId);
      await this.history.record(actor, { entityType: 'ONBOARDING_CASE', entityId: id, entityLabel: c.caseNumber, action: 'APPROVED', summary: 'Approved by IT', employeeId: c.employeeId });
      if (c.createdBy) {
        await this.notifications.notifyUsers([c.createdBy], { type: 'ONBOARDING_APPROVED', title: `IT approved ${who}`, body: `${c.caseNumber} — IT is getting everything ready for ${c.joinDate}`, link: `/onboarding/${id}` });
      }
      return { ok: true };
    });
  }

  /** IT sends the plan back to HR with a note (e.g. a wrong item); HR edits and sends again. */
  async sendBack(actor: Actor, id: string, note: string) {
    assertCan(actor, 'asset:assign');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      if (c.status !== 'SUBMITTED' && c.status !== 'APPROVED') throw conflict('Only a plan sent to IT can be sent back.');
      const [{ issued }] = await db
        .select({ issued: sql<number>`count(*)::int` })
        .from(onboardingItems)
        .where(and(eq(onboardingItems.caseId, id), eq(onboardingItems.status, 'ISSUED')));
      if (issued) throw conflict('Some items are already assigned — change the remaining items here instead.');
      await db.update(onboardingCases).set({ status: 'DRAFT', returnNote: note, approvedAt: null, approvedByName: null, updatedAt: new Date() }).where(eq(onboardingCases.id, id));
      const who = await this.employeeName(c.employeeId);
      await this.history.record(actor, { entityType: 'ONBOARDING_CASE', entityId: id, entityLabel: c.caseNumber, action: 'RETURNED', summary: `Sent back to HR: ${note}`, employeeId: c.employeeId });
      if (c.createdBy) {
        await this.notifications.notifyUsers([c.createdBy], { type: 'ONBOARDING_RETURNED', title: `IT sent back ${who}`, body: note, link: `/onboarding/${id}` });
      }
      return { ok: true };
    });
  }

  // ─── IT: prepare and issue ───────────────────────────────────────────────
  async updateItem(actor: Actor, id: string, itemId: string, input: OnboardingItemUpdateInput) {
    const preparing = input.status === 'PREPARED' || input.status === 'PLANNED';
    if (preparing) assertCan(actor, 'asset:assign');
    else if (!canAny(actor, 'onboarding:manage', 'asset:assign')) assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      const [item] = await db.select().from(onboardingItems).where(and(eq(onboardingItems.id, itemId), eq(onboardingItems.caseId, id)));
      if (!item) throw notFound('Item');
      if (item.status === 'ISSUED') throw conflict('This item has already been issued.');

      const patch: Partial<typeof onboardingItems.$inferInsert> = {};
      if (input.quantity !== undefined) patch.quantity = input.quantity;
      if (input.notes !== undefined) patch.notes = input.notes;
      let summary: string | null = null;
      let action = 'ITEM_UPDATED';
      if (input.status === 'PREPARED') {
        if (!input.preparedAssetId) throw badRequest('Pick the asset to give', { preparedAssetId: 'Required' });
        const [a] = await db.select().from(assets).where(eq(assets.id, input.preparedAssetId));
        if (!a) throw badRequest('Asset not found', { preparedAssetId: 'Not found' });
        if (!READY_ASSET_STATUSES.includes(a.status)) throw badRequest(`${a.assetTag} is not available (${a.status.toLowerCase().replace(/_/g, ' ')})`, { preparedAssetId: 'Not available' });
        if (item.assetTypeId && a.assetTypeId !== item.assetTypeId) throw badRequest(`Pick a ${item.itemName}`, { preparedAssetId: 'Wrong asset type' });
        Object.assign(patch, { status: 'PREPARED', preparedAssetId: a.id, preparedByName: actor.name, skipReason: null });
        action = 'ITEM_PREPARED';
        summary = `${item.itemName}: ${a.assetTag} ${a.name} set aside`;
      } else if (input.status === 'PLANNED') {
        Object.assign(patch, { status: 'PLANNED', preparedAssetId: null, preparedByName: null, skipReason: null });
        action = 'ITEM_UNPREPARED';
        summary = `${item.itemName}: pick cleared`;
      } else if (input.status === 'SKIPPED') {
        Object.assign(patch, { status: 'SKIPPED', skipReason: input.skipReason ?? null });
        action = 'ITEM_SKIPPED';
        summary = `${item.itemName} will not be given${input.skipReason ? ` — ${input.skipReason}` : ''}`;
      }
      if (!Object.keys(patch).length) return { ok: true };
      await db.update(onboardingItems).set(patch).where(eq(onboardingItems.id, itemId));
      await this.history.record(actor, {
        entityType: 'ONBOARDING_CASE',
        entityId: id,
        entityLabel: c.caseNumber,
        action,
        summary: summary ?? `${item.itemName} updated`,
        employeeId: c.employeeId,
        assetId: input.status === 'PREPARED' ? input.preparedAssetId : undefined,
      });
      return { ok: true };
    });
  }

  async removeItem(actor: Actor, id: string, itemId: string) {
    if (!canAny(actor, 'onboarding:manage', 'asset:assign')) assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      this.assertCanEditPlan(actor, c);
      const [item] = await db.select().from(onboardingItems).where(and(eq(onboardingItems.id, itemId), eq(onboardingItems.caseId, id)));
      if (!item) throw notFound('Item');
      if (item.status === 'ISSUED') throw conflict('An assigned item cannot be removed — return the asset instead.');
      await db.delete(onboardingItems).where(eq(onboardingItems.id, itemId));
      await this.history.record(actor, { entityType: 'ONBOARDING_CASE', entityId: id, entityLabel: c.caseNumber, action: 'ITEM_REMOVED', summary: `${item.itemName} removed from the plan`, employeeId: c.employeeId });
      return { ok: true };
    });
  }

  async issueItem(actor: Actor, id: string, itemId: string, input: OnboardingIssueInput) {
    assertCan(actor, 'asset:assign');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      if (c.status !== 'APPROVED') throw conflict('Approve the plan first, then assign.');
      const [item] = await db.select().from(onboardingItems).where(and(eq(onboardingItems.id, itemId), eq(onboardingItems.caseId, id))).for('update');
      if (!item) throw notFound('Item');
      if (item.status === 'ISSUED') throw conflict('This item has already been issued.');
      const assetId = input.assetId ?? item.preparedAssetId;
      if (!assetId) throw badRequest('Pick the asset to give', { assetId: 'Required' });
      const [a] = await db.select({ assetTypeId: assets.assetTypeId, trackingMode: assets.trackingMode }).from(assets).where(eq(assets.id, assetId));
      if (!a) throw badRequest('Asset not found', { assetId: 'Not found' });
      if (item.assetTypeId && a.assetTypeId !== item.assetTypeId) throw badRequest(`Pick a ${item.itemName}`, { assetId: 'Wrong asset type' });

      const alloc = await this.allocation.assign(actor, assetId, {
        holderType: 'EMPLOYEE',
        holderId: c.employeeId,
        quantity: a.trackingMode === 'QUANTITY' ? item.quantity : 1,
        notes: input.notes ?? `Onboarding ${c.caseNumber}`,
      });
      await db
        .update(onboardingItems)
        .set({ status: 'ISSUED', preparedAssetId: assetId, allocationId: alloc.id, issuedAt: new Date(), issuedByName: actor.name })
        .where(eq(onboardingItems.id, itemId));
      await this.history.record(actor, {
        entityType: 'ONBOARDING_CASE',
        entityId: id,
        entityLabel: c.caseNumber,
        action: 'ITEM_ISSUED',
        summary: `${item.itemName} issued`,
        employeeId: c.employeeId,
        assetId,
        metadata: { allocationId: alloc.id },
      });
      return { ok: true, allocationId: alloc.id, assetId };
    });
  }

  /** Assigns each chosen asset to its item; each one on its own so a single failure does not block the rest. */
  async assignAll(actor: Actor, id: string, input: OnboardingAssignAllInput) {
    assertCan(actor, 'asset:assign');
    const names = new Map(
      (await this.dbs.db.select({ id: onboardingItems.id, itemName: onboardingItems.itemName }).from(onboardingItems).where(eq(onboardingItems.caseId, id))).map((i) => [i.id, i.itemName]),
    );
    const results: { itemId: string; itemName: string; ok: boolean; allocationId?: string; assetId?: string; error?: string }[] = [];
    for (const a of input.assignments) {
      const itemName = names.get(a.itemId) ?? 'Item';
      try {
        const r = await this.issueItem(actor, id, a.itemId, { assetId: a.assetId });
        results.push({ itemId: a.itemId, itemName, ok: true, allocationId: r.allocationId, assetId: r.assetId });
      } catch (err) {
        const res = (err as { getResponse?: () => unknown }).getResponse?.();
        const message = typeof res === 'object' && res && 'message' in res ? String((res as { message: unknown }).message) : (err as Error).message;
        results.push({ itemId: a.itemId, itemName, ok: false, error: message });
      }
    }
    return { results, assigned: results.filter((r) => r.ok).length };
  }

  // ─── Day 1 and after ─────────────────────────────────────────────────────
  /** Marks the joiner as joined: employee → Active, and anything not issued becomes an approved asset request. */
  async complete(actor: Actor, id: string) {
    if (!canAny(actor, 'onboarding:manage', 'asset:assign')) assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      if (c.status !== 'APPROVED') throw conflict('IT has to approve the plan before the joiner can be marked as joined.');
      const leftovers = await db
        .select()
        .from(onboardingItems)
        .where(and(eq(onboardingItems.caseId, id), inArray(onboardingItems.status, ['PLANNED', 'PREPARED'])));
      const requests: string[] = [];
      for (const item of leftovers) {
        const number = await this.sequences.next('REQ', 5);
        const [r] = await db
          .insert(assetRequests)
          .values({
            number,
            employeeId: c.employeeId,
            requestedBy: actor.userId,
            requestedByName: actor.name,
            assetTypeId: item.assetTypeId,
            itemName: item.assetTypeId ? null : item.itemName,
            quantity: item.quantity,
            priority: 'HIGH',
            neededBy: c.joinDate,
            reason: `Onboarding ${c.caseNumber}: not issued by joining day${item.notes ? ` (${item.notes})` : ''}`,
            status: 'APPROVED',
            decidedByName: actor.name,
            decidedAt: new Date(),
            decisionNote: `Planned in onboarding ${c.caseNumber}`,
          })
          .returning({ id: assetRequests.id });
        requests.push(number);
        await this.history.record(actor, {
          entityType: 'REQUEST',
          entityId: r.id,
          entityLabel: number,
          action: 'CREATED',
          summary: `${item.quantity > 1 ? `${item.quantity} × ` : ''}${item.itemName} still to give (from ${c.caseNumber})`,
          employeeId: c.employeeId,
        });
      }
      await db.update(onboardingCases).set({ status: 'COMPLETED', completedAt: new Date(), completedByName: actor.name, updatedAt: new Date() }).where(eq(onboardingCases.id, id));
      const [emp] = await db.select().from(employees).where(eq(employees.id, c.employeeId));
      if (emp.status === 'JOINING') {
        await db.update(employees).set({ status: 'ACTIVE', joinDate: emp.joinDate ?? c.joinDate ?? today(), updatedAt: new Date() }).where(eq(employees.id, c.employeeId));
      }
      await this.history.recordMany(actor, [
        {
          entityType: 'ONBOARDING_CASE',
          entityId: id,
          entityLabel: c.caseNumber,
          action: 'COMPLETED',
          summary: `Joined${requests.length ? ` — ${requests.length} item${requests.length > 1 ? 's' : ''} moved to requests (${requests.join(', ')})` : ''}`,
          employeeId: c.employeeId,
        },
        {
          entityType: 'EMPLOYEE',
          entityId: c.employeeId,
          entityLabel: emp.fullName,
          action: 'STATUS_CHANGED',
          summary: `${emp.fullName} joined`,
          changes: [{ field: 'status', label: 'Status', from: emp.status, to: 'ACTIVE' }],
        },
      ]);
      if (requests.length) {
        await this.notifications.notifyPermission('request:fulfil', {
          type: 'ONBOARDING_LEFTOVERS',
          title: `${emp.fullName} joined — ${requests.length} item${requests.length > 1 ? 's' : ''} still to give`,
          body: `Added as approved requests ${requests.join(', ')}`,
          link: '/requests?status=APPROVED',
        });
      }
      return { ok: true, requests };
    });
  }

  /** The person did not join: close the plan and mark the record exited. */
  async cancel(actor: Actor, id: string, reason: string) {
    assertCan(actor, 'onboarding:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(id);
      this.assertOpen(c);
      const [{ issued }] = await db
        .select({ issued: sql<number>`count(*)::int` })
        .from(onboardingItems)
        .where(and(eq(onboardingItems.caseId, id), eq(onboardingItems.status, 'ISSUED')));
      if (issued) throw conflict(`${issued} item${issued > 1 ? 's were' : ' was'} already issued. Return ${issued > 1 ? 'them' : 'it'} from the person’s page first.`);
      await db.update(onboardingCases).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(onboardingCases.id, id));
      const [emp] = await db.select().from(employees).where(eq(employees.id, c.employeeId));
      if (emp.status === 'JOINING') {
        await db.update(employees).set({ status: 'EXITED', notes: [emp.notes, `Did not join (${c.caseNumber}): ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() }).where(eq(employees.id, c.employeeId));
        const [login] = await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.employeeId, c.employeeId)).returning({ id: users.id });
        if (login) await this.auth.revokeUserSessions(login.id);
      }
      await this.history.recordMany(actor, [
        { entityType: 'ONBOARDING_CASE', entityId: id, entityLabel: c.caseNumber, action: 'CANCELLED', summary: `Cancelled — ${reason}`, employeeId: c.employeeId },
        { entityType: 'EMPLOYEE', entityId: c.employeeId, entityLabel: emp.fullName, action: 'STATUS_CHANGED', summary: `${emp.fullName} did not join`, changes: [{ field: 'status', label: 'Status', from: emp.status, to: 'EXITED' }] },
      ]);
      return { ok: true };
    });
  }

  // ─── Kits ────────────────────────────────────────────────────────────────
  async listKits(actor: Actor) {
    this.assertView(actor);
    return this.dbs.db.select().from(onboardingKits).orderBy(asc(onboardingKits.name));
  }

  async saveKit(actor: Actor, input: OnboardingKitInput) {
    assertCan(actor, 'onboarding:manage');
    const items = (await this.resolveItems(input.items)).map((i) => ({ assetTypeId: i.assetTypeId, itemName: i.assetTypeId ? null : i.itemName, quantity: i.quantity, notes: i.notes }));
    const [existing] = await this.dbs.db.select({ id: onboardingKits.id }).from(onboardingKits).where(sql`lower(${onboardingKits.name}) = lower(${input.name})`);
    if (existing) {
      await this.dbs.db.update(onboardingKits).set({ items, updatedAt: new Date() }).where(eq(onboardingKits.id, existing.id));
      return { id: existing.id, updated: true };
    }
    const [kit] = await this.dbs.db.insert(onboardingKits).values({ name: input.name, items, createdByName: actor.name }).returning({ id: onboardingKits.id });
    return { id: kit.id, updated: false };
  }

  async deleteKit(actor: Actor, id: string) {
    assertCan(actor, 'onboarding:manage');
    const [gone] = await this.dbs.db.delete(onboardingKits).where(eq(onboardingKits.id, id)).returning({ id: onboardingKits.id });
    if (!gone) throw notFound('Kit');
    return { ok: true };
  }
}
