import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { EXIT_CASE_STATUSES, EXIT_ITEM_CLEARED, type ExitItemStatus, humanize } from '@eam/shared';
import { type Actor, assertCan, can } from '../../common/actor';
import { badRequest, likePattern, listFilter, listParams, notFound, today } from '../../common/http';
import { DbService } from '../../db/db.service';
import {
  allocations,
  assetCategories,
  assets,
  assetTypes,
  departments,
  employees,
  exitCases,
  exitItems,
  locations,
  users,
} from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { NotificationsService } from '../../core/notifications.service';
import { SequenceService } from '../../core/sequence.service';
import { AuthService } from '../auth/auth.service';
import { AllocationService } from '../assets/allocation.service';
import { normaliseCode } from '../../common/codes';
import { LifecycleService } from '../assets/lifecycle.service';

type ExitCaseRow = typeof exitCases.$inferSelect;

const itemCounts = {
  total: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id)`,
  pending: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id and i.status = 'PENDING')`,
  returned: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id and i.status = 'RETURNED')`,
  damaged: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id and i.status = 'DAMAGED')`,
  missing: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id and i.status = 'MISSING')`,
};

/**
 * Employee exit / notice period: builds the asset recovery checklist from every ACTIVE
 * allocation, tracks each item, and blocks completion until everything is cleared or an
 * authorised override (with a reason) is recorded.
 */
@Injectable()
export class ExitService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
    private readonly allocation: AllocationService,
    private readonly lifecycle: LifecycleService,
    private readonly auth: AuthService,
  ) {}

  private async lockCase(id: string): Promise<ExitCaseRow> {
    const [c] = await this.dbs.db.select().from(exitCases).where(eq(exitCases.id, id)).for('update');
    if (!c) throw notFound('Exit case');
    return c;
  }

  private assertOpen(c: ExitCaseRow) {
    if (c.status !== 'OPEN') throw new ConflictException(`This exit case is already ${c.status.toLowerCase()}.`);
  }

  /** Called when HR moves an employee to Notice Period. Runs inside the status-change transaction. */
  async open(actor: Actor, employeeId: string, input: { lastWorkingDate: string; noticeDate?: string | null; reason?: string | null }) {
    return this.dbs.tx(async (db) => {
      const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!emp) throw notFound('Employee');
      const [existing] = await db
        .select()
        .from(exitCases)
        .where(and(eq(exitCases.employeeId, employeeId), eq(exitCases.status, 'OPEN')));
      if (existing) {
        if (existing.lastWorkingDate !== input.lastWorkingDate) {
          await db.update(exitCases).set({ lastWorkingDate: input.lastWorkingDate, updatedAt: new Date() }).where(eq(exitCases.id, existing.id));
          await this.history.record(actor, {
            entityType: 'EXIT_CASE',
            entityId: existing.id,
            entityLabel: existing.caseNumber,
            action: 'UPDATED',
            summary: `Last working date changed to ${input.lastWorkingDate}`,
            employeeId,
            changes: [{ field: 'lastWorkingDate', label: 'Last working date', from: existing.lastWorkingDate, to: input.lastWorkingDate }],
          });
        }
        return existing;
      }

      const caseNumber = await this.sequences.next('EXIT', 5);
      const [c] = await db
        .insert(exitCases)
        .values({
          caseNumber,
          employeeId,
          noticeDate: input.noticeDate ?? today(),
          lastWorkingDate: input.lastWorkingDate,
          reason: input.reason ?? null,
          initiatedBy: actor.userId,
          initiatedByName: actor.name,
        })
        .returning();

      // Every asset the employee currently holds, individual and pooled.
      const held = await db
        .select({
          allocationId: allocations.id,
          quantity: allocations.quantity,
          assetId: assets.id,
          assetTag: assets.assetTag,
          assetName: assets.name,
          typeName: assetTypes.name,
          categoryName: assetCategories.name,
        })
        .from(allocations)
        .innerJoin(assets, eq(assets.id, allocations.assetId))
        .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
        .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .where(and(eq(allocations.employeeId, employeeId), eq(allocations.status, 'ACTIVE')))
        .orderBy(asc(assetCategories.sortOrder), asc(assets.assetTag));

      if (held.length) {
        await db.insert(exitItems).values(
          held.map((h) => ({
            exitCaseId: c.id,
            assetId: h.assetId,
            allocationId: h.allocationId,
            assetTag: h.assetTag,
            assetName: h.assetName,
            assetTypeName: h.typeName,
            categoryName: h.categoryName,
            quantity: h.quantity,
            source: 'AUTO' as const,
          })),
        );
      }

      const summary = held.length
        ? `Exit initiated — ${held.length} asset(s) to recover by ${input.lastWorkingDate}`
        : `Exit initiated — no assets assigned; ready to complete`;
      await this.history.recordMany(actor, [
        { entityType: 'EXIT_CASE', entityId: c.id, entityLabel: caseNumber, action: 'CREATED', summary, employeeId },
        {
          entityType: 'EMPLOYEE',
          entityId: employeeId,
          entityLabel: emp.fullName,
          action: 'EXIT_INITIATED',
          summary: `${caseNumber}: ${held.length} asset(s) on the recovery checklist`,
          metadata: { exitCaseId: c.id },
        },
      ]);

      const names = held.map((h) => h.typeName).slice(0, 8);
      await this.notifications.notifyPermission(
        'exit:manage',
        {
          type: 'EXIT_OPENED',
          title: `${emp.fullName} is leaving — ${held.length} asset(s) to recover`,
          body: `Last working day ${input.lastWorkingDate}${names.length ? `: ${names.join(', ')}${held.length > names.length ? '…' : ''}` : ''}`,
          link: `/exits/${c.id}`,
        },
        actor.userId,
      );
      await this.notifications.notifyEmployee(employeeId, {
        type: 'EXIT_OPENED',
        title: 'Asset return checklist created',
        body: held.length ? `Please return ${held.length} asset(s) by ${input.lastWorkingDate}.` : 'You have no company assets to return.',
        link: `/exits/${c.id}`,
      });
      return c;
    });
  }

  async list(actor: Actor, q: Record<string, string>) {
    assertCan(actor, 'exit:view');
    const p = listParams(q, { sort: 'lastWorkingDate', dir: 'asc' });
    const conds: SQL[] = [];
    const statuses = listFilter(q.status, EXIT_CASE_STATUSES);
    if (statuses.length) conds.push(inArray(exitCases.status, statuses));
    if (q.pending === '1') conds.push(sql`exists (select 1 from exit_items i where i.exit_case_id = exit_cases.id and i.status in ('PENDING', 'MISSING'))`);
    if (p.search) {
      const like = likePattern(p.search);
      conds.push(or(ilike(employees.fullName, like), ilike(employees.employeeCode, like), ilike(exitCases.caseNumber, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const sortCol = { lastWorkingDate: exitCases.lastWorkingDate, createdAt: exitCases.createdAt, employee: employees.fullName }[p.sort] ?? exitCases.lastWorkingDate;
    const db = this.dbs.db;
    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          case: exitCases,
          employeeName: employees.fullName,
          employeeCode: employees.employeeCode,
          employeeStatus: employees.status,
          designation: employees.designation,
          departmentName: departments.name,
          ...itemCounts,
        })
        .from(exitCases)
        .innerJoin(employees, eq(employees.id, exitCases.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(where)
        .orderBy(p.dir === 'asc' ? asc(sortCol) : desc(sortCol), desc(exitCases.createdAt))
        .limit(p.pageSize)
        .offset(p.offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(exitCases)
        .innerJoin(employees, eq(employees.id, exitCases.employeeId))
        .where(where),
    ]);
    return {
      items: items.map(({ case: c, ...rest }) => ({ ...c, ...rest })),
      total,
      page: p.page,
      pageSize: p.pageSize,
    };
  }

  async get(actor: Actor, id: string) {
    const db = this.dbs.db;
    const [row] = await db
      .select({
        case: exitCases,
        employee: {
          id: employees.id,
          fullName: employees.fullName,
          employeeCode: employees.employeeCode,
          email: employees.email,
          phone: employees.phone,
          designation: employees.designation,
          status: employees.status,
          departmentName: departments.name,
          locationName: locations.name,
        },
        ...itemCounts,
      })
      .from(exitCases)
      .innerJoin(employees, eq(employees.id, exitCases.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(locations, eq(locations.id, employees.locationId))
      .where(eq(exitCases.id, id));
    if (!row) throw notFound('Exit case');
    if (!can(actor, 'exit:view') && actor.employeeId !== row.case.employeeId) throw notFound('Exit case');

    const items = await db
      .select({
        item: exitItems,
        assetStatus: assets.status,
        assetCondition: assets.condition,
        qrCode: assets.qrCode,
        serialNumber: assets.serialNumber,
        allocationStatus: allocations.status,
      })
      .from(exitItems)
      .leftJoin(assets, eq(assets.id, exitItems.assetId))
      .leftJoin(allocations, eq(allocations.id, exitItems.allocationId))
      .where(eq(exitItems.exitCaseId, id))
      .orderBy(asc(exitItems.createdAt), asc(exitItems.categoryName), asc(exitItems.assetTag));

    const { case: c, employee, ...counts } = row;
    const cleared = counts.returned + counts.damaged;
    return {
      ...c,
      employee,
      counts: { ...counts, cleared },
      canComplete: c.status === 'OPEN' && counts.pending === 0 && counts.missing === 0,
      items: items.map(({ item, ...rest }) => ({ ...item, ...rest })),
    };
  }

  async timeline(actor: Actor, id: string) {
    await this.get(actor, id);
    return this.history.list({ entityType: 'EXIT_CASE', entityId: id }, { page: 1, pageSize: 200, offset: 0, search: '' });
  }

  /** Marks one checklist item. Returning goes through the normal return flow so the asset and its history stay in sync. */
  async updateItem(actor: Actor, caseId: string, itemId: string, input: { status: ExitItemStatus; notes?: string | null }) {
    assertCan(actor, 'exit:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(caseId);
      this.assertOpen(c);
      const [item] = await db.select().from(exitItems).where(and(eq(exitItems.id, itemId), eq(exitItems.exitCaseId, caseId)));
      if (!item) throw notFound('Checklist item');
      if (item.status === input.status && !input.notes) return item;

      const [alloc] = item.allocationId ? await db.select().from(allocations).where(eq(allocations.id, item.allocationId)) : [];
      const custodyOpen = alloc?.status === 'ACTIVE';

      if ((input.status === 'RETURNED' || input.status === 'DAMAGED') && custodyOpen && item.assetId) {
        await this.allocation.returnAsset(actor, item.assetId, {
          allocationId: alloc.id,
          condition: input.status === 'DAMAGED' ? 'DAMAGED' : 'GOOD',
          makeAvailable: input.status === 'RETURNED',
          notes: input.notes ?? `Recovered on exit (${c.caseNumber})`,
        });
      } else {
        if (input.status === 'PENDING' && alloc && !custodyOpen) {
          throw badRequest('This asset has already been returned, so it cannot be marked pending.');
        }
        await db
          .update(exitItems)
          .set({
            status: input.status,
            notes: input.notes ?? item.notes,
            resolvedAt: input.status === 'PENDING' ? null : new Date(),
            resolvedByName: input.status === 'PENDING' ? null : actor.name,
          })
          .where(eq(exitItems.id, itemId));
        await this.history.record(actor, {
          entityType: 'EXIT_CASE',
          entityId: caseId,
          entityLabel: c.caseNumber,
          action: `ITEM_${input.status}`,
          summary: `${item.assetTag ? `${item.assetTag} ` : ''}${item.assetName} marked ${humanize(input.status).toLowerCase()}${input.notes ? ` — ${input.notes}` : ''}`,
          assetId: item.assetId,
          employeeId: c.employeeId,
        });
      }
      const [fresh] = await db.select().from(exitItems).where(eq(exitItems.id, itemId));
      return fresh;
    });
  }

  /** Scan-to-return: finds the scanned asset on this checklist and marks it returned. */
  async scan(actor: Actor, caseId: string, raw: string) {
    assertCan(actor, 'exit:manage');
    const code = normaliseCode(raw);
    const [match] = await this.dbs.db
      .select({ item: exitItems })
      .from(exitItems)
      .innerJoin(assets, eq(assets.id, exitItems.assetId))
      .where(
        and(
          eq(exitItems.exitCaseId, caseId),
          or(eq(assets.qrCode, code), sql`upper(${assets.assetTag}) = upper(${code})`, sql`lower(${assets.serialNumber}) = lower(${code})`),
        ),
      )
      .limit(1);
    if (!match) throw new NotFoundException(`"${code}" is not on this checklist`);
    if (EXIT_ITEM_CLEARED.includes(match.item.status)) return { item: match.item, alreadyCleared: true };
    const item = await this.updateItem(actor, caseId, match.item.id, { status: 'RETURNED' });
    return { item, alreadyCleared: false };
  }

  async addManualItem(actor: Actor, caseId: string, input: { assetName: string; notes?: string | null }) {
    assertCan(actor, 'exit:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(caseId);
      this.assertOpen(c);
      const [item] = await db
        .insert(exitItems)
        .values({ exitCaseId: caseId, assetName: input.assetName, notes: input.notes ?? null, source: 'MANUAL' })
        .returning();
      await this.history.record(actor, {
        entityType: 'EXIT_CASE',
        entityId: caseId,
        entityLabel: c.caseNumber,
        action: 'ITEM_ADDED',
        summary: `Manual item "${input.assetName}" added to the checklist`,
        employeeId: c.employeeId,
      });
      return item;
    });
  }

  async complete(actor: Actor, caseId: string) {
    assertCan(actor, 'exit:manage');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(caseId);
      this.assertOpen(c);
      const items = await db.select().from(exitItems).where(eq(exitItems.exitCaseId, caseId));
      const blocking = items.filter((i) => !EXIT_ITEM_CLEARED.includes(i.status));
      if (blocking.length) {
        throw new ConflictException({
          message: `Exit is blocked: ${blocking.length} asset(s) not cleared (${blocking
            .slice(0, 5)
            .map((i) => `${i.assetName} — ${humanize(i.status).toLowerCase()}`)
            .join(', ')}). Recover them or record an authorised override.`,
          blocking: blocking.map((i) => ({ id: i.id, assetTag: i.assetTag, assetName: i.assetName, status: i.status })),
        });
      }
      return this.finalise(actor, c, null);
    });
  }

  /** Completes the exit with uncleared items. Requires `exit:override` and a reason; unrecovered assets are written off as lost. */
  async override(actor: Actor, caseId: string, reason: string) {
    assertCan(actor, 'exit:override', 'Only authorised users can override exit clearance');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(caseId);
      this.assertOpen(c);
      const items = await db.select().from(exitItems).where(eq(exitItems.exitCaseId, caseId));
      const uncleared = items.filter((i) => !EXIT_ITEM_CLEARED.includes(i.status));
      if (!uncleared.length) return this.finalise(actor, c, null);

      const note = `Exit ${c.caseNumber} completed by override: ${reason}`;
      for (const item of uncleared) {
        if (item.allocationId) await this.lifecycle.writeOffAllocation(actor, item.allocationId, note);
      }
      await db
        .update(exitItems)
        .set({ status: 'MISSING', resolvedAt: new Date(), resolvedByName: actor.name })
        .where(and(eq(exitItems.exitCaseId, caseId), inArray(exitItems.status, ['PENDING'])));
      await this.history.record(actor, {
        entityType: 'EXIT_CASE',
        entityId: caseId,
        entityLabel: c.caseNumber,
        action: 'OVERRIDDEN',
        summary: `Clearance overridden with ${uncleared.length} uncleared item(s): ${reason}`,
        employeeId: c.employeeId,
        metadata: { reason, items: uncleared.map((i) => ({ id: i.id, assetTag: i.assetTag, assetName: i.assetName, status: i.status })) },
      });
      return this.finalise(actor, c, reason);
    });
  }

  private async finalise(actor: Actor, c: ExitCaseRow, overrideReason: string | null) {
    const db = this.dbs.db;
    await db
      .update(exitCases)
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
        completedByName: actor.name,
        overridden: overrideReason !== null,
        overrideReason,
        updatedAt: new Date(),
      })
      .where(eq(exitCases.id, c.id));
    const [emp] = await db
      .update(employees)
      .set({ status: 'EXITED', exitDate: today(), updatedAt: new Date() })
      .where(eq(employees.id, c.employeeId))
      .returning();
    // The leaver's login is switched off.
    const logins = await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.employeeId, c.employeeId)).returning({ id: users.id });
    for (const u of logins) await this.auth.revokeUserSessions(u.id);

    await this.history.recordMany(actor, [
      {
        entityType: 'EXIT_CASE',
        entityId: c.id,
        entityLabel: c.caseNumber,
        action: 'COMPLETED',
        summary: overrideReason ? 'Exit completed with authorised override' : 'Exit completed — all assets cleared',
        employeeId: c.employeeId,
      },
      {
        entityType: 'EMPLOYEE',
        entityId: c.employeeId,
        entityLabel: emp.fullName,
        action: 'STATUS_CHANGED',
        summary: `Exited (${c.caseNumber})${overrideReason ? ' — clearance overridden' : ''}`,
        changes: [{ field: 'status', label: 'Status', from: 'NOTICE_PERIOD', to: 'EXITED' }],
      },
    ]);
    await this.notifications.notifyPermission(
      'employee:status',
      {
        type: 'EXIT_COMPLETED',
        title: `${emp.fullName} exit completed`,
        body: overrideReason ? `Completed with override: ${overrideReason}` : 'All assets recovered.',
        link: `/exits/${c.id}`,
      },
      actor.userId,
    );
    return { ok: true, overridden: overrideReason !== null };
  }

  /** Notice withdrawn: the case is cancelled and the employee returns to Active. */
  async cancel(actor: Actor, caseId: string, reason?: string | null, opts: { restoreEmployee?: boolean } = { restoreEmployee: true }) {
    assertCan(actor, 'employee:status');
    return this.dbs.tx(async (db) => {
      const c = await this.lockCase(caseId);
      this.assertOpen(c);
      await db.update(exitCases).set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(exitCases.id, caseId));
      if (opts.restoreEmployee) {
        await db
          .update(employees)
          .set({ status: 'ACTIVE', lastWorkingDate: null, noticeDate: null, updatedAt: new Date() })
          .where(eq(employees.id, c.employeeId));
      }
      await this.history.recordMany(actor, [
        {
          entityType: 'EXIT_CASE',
          entityId: caseId,
          entityLabel: c.caseNumber,
          action: 'CANCELLED',
          summary: `Exit cancelled${reason ? ` — ${reason}` : ''}`,
          employeeId: c.employeeId,
        },
        ...(opts.restoreEmployee
          ? [
              {
                entityType: 'EMPLOYEE' as const,
                entityId: c.employeeId,
                action: 'STATUS_CHANGED',
                summary: `Notice withdrawn (${c.caseNumber} cancelled)`,
                changes: [{ field: 'status', label: 'Status', from: 'NOTICE_PERIOD', to: 'ACTIVE' }],
              },
            ]
          : []),
      ]);
      return { ok: true };
    });
  }

  async openCaseFor(employeeId: string) {
    const [c] = await this.dbs.db
      .select()
      .from(exitCases)
      .where(and(eq(exitCases.employeeId, employeeId), eq(exitCases.status, 'OPEN')));
    return c ?? null;
  }
}
