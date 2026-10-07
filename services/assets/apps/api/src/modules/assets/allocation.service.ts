import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  type AssignInput,
  type ExitItemStatus,
  HOLDER_TYPE_LABELS,
  humanize,
  LIFECYCLE,
  type ReturnInput,
  type TransferInput,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { badRequest, conflict, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { allocations, assetCategories, assets, assetTypes, exitCases, exitItems } from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { NotificationsService } from '../../core/notifications.service';
import { HoldersService, type ResolvedHolder } from './holders.service';

export type AssetRow = typeof assets.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;

const label = (s: AssetStatus) => ASSET_STATUS_LABELS[s].toLowerCase();

/**
 * Custody: assign, transfer and return. Every operation locks the asset row, validates the
 * lifecycle rule, writes the allocation, mirrors the holder onto the asset, records history
 * and keeps any open exit checklist in sync — all in one transaction.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly holders: HoldersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** SELECT … FOR UPDATE: serialises concurrent changes to the same asset. */
  async lock(assetId: string): Promise<AssetRow> {
    const [asset] = await this.dbs.db.select().from(assets).where(eq(assets.id, assetId)).for('update');
    if (!asset) throw notFound('Asset');
    return asset;
  }

  async active(assetId: string): Promise<AllocationRow[]> {
    return this.dbs.db
      .select()
      .from(allocations)
      .where(and(eq(allocations.assetId, assetId), eq(allocations.status, 'ACTIVE')))
      .orderBy(asc(allocations.assignedAt));
  }

  async listForAsset(assetId: string) {
    return this.dbs.db.select().from(allocations).where(eq(allocations.assetId, assetId)).orderBy(desc(allocations.assignedAt));
  }

  /** One-time items (joining kit, stationery) are given away: no custody to return. */
  private async isConsumable(assetTypeId: string) {
    const [t] = await this.dbs.db.select({ consumable: assetTypes.consumable }).from(assetTypes).where(eq(assetTypes.id, assetTypeId));
    return !!t?.consumable;
  }

  private async insertAllocation(actor: Actor, asset: AssetRow, holder: ResolvedHolder, quantity: number, notes?: string | null, expectedReturnDate?: string | null, consumed = false) {
    const [alloc] = await this.dbs.db
      .insert(allocations)
      .values({
        ...(consumed ? { status: 'CONSUMED' as const, endedAt: new Date(), endedBy: actor.userId, endedByName: actor.name } : {}),
        assetId: asset.id,
        holderType: holder.holderType,
        ...holder.columns,
        holderName: holder.name,
        quantity,
        exclusive: asset.trackingMode === 'INDIVIDUAL',
        assignedBy: actor.userId,
        assignedByName: actor.name,
        expectedReturnDate: expectedReturnDate ?? null,
        notes: notes ?? null,
      })
      .returning();
    return alloc;
  }

  private async setHolder(asset: AssetRow, holder: ResolvedHolder | null, status: AssetStatus, extra: Partial<AssetRow> = {}) {
    await this.dbs.db
      .update(assets)
      .set({
        status,
        holderType: holder?.holderType ?? null,
        holderId: holder?.holderId ?? null,
        holderName: holder?.name ?? null,
        assignedAt: holder ? new Date() : null,
        locationId: holder?.impliedLocationId ?? asset.locationId,
        version: sql`${assets.version} + 1`,
        updatedAt: new Date(),
        ...extra,
      })
      .where(eq(assets.id, asset.id));
  }

  async assign(actor: Actor, assetId: string, input: AssignInput): Promise<AllocationRow> {
    return this.dbs.tx(async () => {
      const asset = await this.lock(assetId);
      const holder = await this.holders.resolve(input.holderType, input.holderId);
      const toInventory = input.holderType === 'INVENTORY';
      let alloc: AllocationRow;
      let consumed = false;

      if (asset.trackingMode === 'QUANTITY') {
        if (toInventory) throw badRequest('Quantity-tracked assets are stocked at a location; assign units to a holder instead.');
        if (asset.status !== 'AVAILABLE' && asset.status !== 'ASSIGNED') {
          throw conflict(`Cannot assign an asset that is ${label(asset.status)}.`);
        }
        const qty = input.quantity ?? 1;
        if (qty > asset.availableQuantity) throw conflict(asset.availableQuantity ? `Only ${asset.availableQuantity} of ${asset.quantity} available.` : `${asset.name} is out of stock — add more stock first.`);
        consumed = await this.isConsumable(asset.assetTypeId);
        alloc = await this.insertAllocation(actor, asset, holder, qty, input.notes, consumed ? null : input.expectedReturnDate, consumed);
        const remaining = asset.availableQuantity - qty;
        await this.dbs.db
          .update(assets)
          .set({
            availableQuantity: remaining,
            // Stock of a one-time item stays "available" (it's never out with anyone), even at 0 left.
            status: remaining === 0 && !consumed ? 'ASSIGNED' : 'AVAILABLE',
            version: sql`${assets.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, asset.id));
        await this.history.record(actor, {
          entityType: 'ASSET',
          entityId: asset.id,
          entityLabel: `${asset.assetTag} · ${asset.name}`,
          action: consumed ? 'ISSUED' : 'ASSIGNED',
          summary: consumed ? `${qty} × ${asset.name} given to ${holder.name} (no return)` : `${qty} × ${asset.name} assigned to ${holder.name}`,
          employeeId: holder.columns.employeeId,
          metadata: { allocationId: alloc.id, holderType: holder.holderType, holderId: holder.holderId, quantity: qty },
        });
      } else {
        const rule = LIFECYCLE[toInventory ? 'move_to_inventory' : 'assign'];
        if (!rule.from.includes(asset.status)) {
          throw conflict(
            asset.status === 'ASSIGNED'
              ? `${asset.assetTag} is already assigned to ${asset.holderName}. Transfer or return it first.`
              : `Cannot ${rule.label.toLowerCase()} an asset that is ${label(asset.status)}.`,
          );
        }
        let from = '';
        if (asset.status === 'IN_INVENTORY') {
          await this.endActive(actor, asset, 'TRANSFERRED', `Issued to ${holder.name}`);
          from = ` from ${asset.holderName}`;
        }
        alloc = await this.insertAllocation(actor, asset, holder, 1, input.notes, input.expectedReturnDate);
        await this.setHolder(asset, holder, toInventory ? 'IN_INVENTORY' : 'ASSIGNED');
        await this.history.record(actor, {
          entityType: 'ASSET',
          entityId: asset.id,
          entityLabel: `${asset.assetTag} · ${asset.name}`,
          action: toInventory ? 'MOVED_TO_INVENTORY' : 'ASSIGNED',
          summary: toInventory
            ? `Moved to inventory at ${holder.name}`
            : `Assigned${from} to ${holder.name}${holder.holderType !== 'EMPLOYEE' ? ` (${HOLDER_TYPE_LABELS[holder.holderType]})` : ''}`,
          employeeId: holder.columns.employeeId,
          changes: [{ field: 'status', label: 'Status', from: asset.status, to: toInventory ? 'IN_INVENTORY' : 'ASSIGNED' }],
          metadata: { allocationId: alloc.id, holderType: holder.holderType, holderId: holder.holderId, notes: input.notes ?? null },
        });
      }

      await this.afterNewEmployeeHolder(actor, asset, holder, alloc, consumed);
      return alloc;
    });
  }

  async transfer(actor: Actor, assetId: string, input: TransferInput): Promise<AllocationRow> {
    return this.dbs.tx(async () => {
      const asset = await this.lock(assetId);
      const current = await this.active(assetId);
      let old: AllocationRow | undefined;
      if (asset.trackingMode === 'QUANTITY') {
        old = current.find((a) => a.id === input.allocationId);
        if (!old) throw badRequest('Choose which allocation to transfer', { allocationId: 'Required' });
      } else {
        if (asset.status !== 'ASSIGNED' && asset.status !== 'IN_INVENTORY') {
          throw conflict(`Cannot transfer an asset that is ${label(asset.status)}.`);
        }
        old = current[0];
        if (!old) throw conflict('This asset has no current holder to transfer from.');
      }

      const holder = await this.holders.resolve(input.holderType, input.holderId);
      if (holder.holderType === old.holderType && holder.holderId === (old.employeeId ?? old.departmentId ?? old.locationId ?? old.companyId ?? old.vendorId)) {
        throw badRequest(`Already held by ${holder.name}`);
      }
      if (asset.trackingMode === 'QUANTITY' && holder.holderType === 'INVENTORY') {
        throw badRequest('Quantity-tracked assets cannot be moved to inventory; return the units instead.');
      }

      await this.endAllocation(actor, old, 'TRANSFERRED', `Transferred to ${holder.name}${input.notes ? ` — ${input.notes}` : ''}`);
      await this.syncExitItems(actor, old.id, 'RETURNED', `Transferred to ${holder.name}`);
      const alloc = await this.insertAllocation(actor, asset, holder, old.quantity, input.notes, input.expectedReturnDate);

      if (asset.trackingMode === 'INDIVIDUAL') {
        await this.setHolder(asset, holder, holder.holderType === 'INVENTORY' ? 'IN_INVENTORY' : 'ASSIGNED');
      } else {
        await this.dbs.db.update(assets).set({ version: sql`${assets.version} + 1`, updatedAt: new Date() }).where(eq(assets.id, asset.id));
      }
      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: asset.id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: 'TRANSFERRED',
        summary: `${asset.trackingMode === 'QUANTITY' ? `${old.quantity} × ` : ''}Transferred from ${old.holderName} to ${holder.name}`,
        employeeId: holder.columns.employeeId ?? old.employeeId,
        metadata: {
          fromAllocationId: old.id,
          toAllocationId: alloc.id,
          fromEmployeeId: old.employeeId,
          toHolderType: holder.holderType,
          toHolderId: holder.holderId,
          notes: input.notes ?? null,
        },
      });
      // The previous employee also sees this in their history.
      if (old.employeeId && old.employeeId !== holder.columns.employeeId) {
        await this.history.record(actor, {
          entityType: 'EMPLOYEE',
          entityId: old.employeeId,
          entityLabel: old.holderName,
          action: 'ASSET_TRANSFERRED_OUT',
          summary: `${asset.assetTag} ${asset.name} transferred to ${holder.name}`,
          metadata: { assetId: asset.id },
        });
      }
      await this.afterNewEmployeeHolder(actor, asset, holder, alloc);
      return alloc;
    });
  }

  async returnAsset(actor: Actor, assetId: string, input: ReturnInput) {
    return this.dbs.tx(async () => {
      const asset = await this.lock(assetId);
      const current = await this.active(assetId);
      let alloc: AllocationRow | undefined;
      if (asset.trackingMode === 'QUANTITY') {
        alloc = input.allocationId ? current.find((a) => a.id === input.allocationId) : current.length === 1 ? current[0] : undefined;
        if (!alloc) throw badRequest('Choose which allocation is being returned', { allocationId: 'Required' });
      } else {
        alloc = current[0];
        const inMaintenance = asset.status === 'IN_MAINTENANCE' && !!alloc;
        if (asset.status !== 'ASSIGNED' && !inMaintenance) {
          throw conflict(
            asset.status === 'IN_INVENTORY'
              ? 'The asset is in inventory. Use "Make available" to release it from the store.'
              : `Cannot return an asset that is ${label(asset.status)}.`,
          );
        }
        if (!alloc) throw conflict('This asset has no current holder.');
      }

      const damaged = input.condition === 'DAMAGED';
      await this.endAllocation(actor, alloc, 'RETURNED', input.notes ?? null, input.condition);
      await this.syncExitItems(actor, alloc.id, damaged ? 'DAMAGED' : 'RETURNED', input.notes ?? null);

      let newStatus: AssetStatus;
      if (asset.trackingMode === 'QUANTITY') {
        newStatus = 'AVAILABLE';
        await this.dbs.db
          .update(assets)
          .set({
            availableQuantity: sql`${assets.availableQuantity} + ${alloc.quantity}`,
            status: 'AVAILABLE',
            version: sql`${assets.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, asset.id));
      } else {
        newStatus =
          asset.status === 'IN_MAINTENANCE'
            ? 'IN_MAINTENANCE'
            : input.makeAvailable && !damaged && input.condition !== 'POOR'
              ? 'AVAILABLE'
              : 'RETURNED';
        await this.setHolder(asset, null, newStatus, { condition: input.condition });
      }

      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: asset.id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: 'RETURNED',
        summary: `${asset.trackingMode === 'QUANTITY' ? `${alloc.quantity} × ` : ''}Returned by ${alloc.holderName} in ${humanize(input.condition).toLowerCase()} condition`,
        employeeId: alloc.employeeId,
        changes: [
          ...(asset.status !== newStatus ? [{ field: 'status', label: 'Status', from: asset.status, to: newStatus }] : []),
          ...(asset.condition !== input.condition && asset.trackingMode === 'INDIVIDUAL'
            ? [{ field: 'condition', label: 'Condition', from: asset.condition, to: input.condition }]
            : []),
        ],
        metadata: { allocationId: alloc.id, notes: input.notes ?? null },
      });
      return { ok: true, status: newStatus, allocationId: alloc.id };
    });
  }

  /** Ends every ACTIVE allocation of an asset (used by lifecycle actions such as mark lost). */
  async endActive(actor: Actor, asset: AssetRow, status: 'TRANSFERRED' | 'RELEASED' | 'LOST', note: string | null) {
    const current = await this.active(asset.id);
    for (const a of current) {
      await this.endAllocation(actor, a, status, note);
      if (status === 'LOST') await this.syncExitItems(actor, a.id, 'MISSING', note);
      if (status === 'RELEASED') await this.syncExitItems(actor, a.id, 'RETURNED', note);
    }
    return current;
  }

  /** Ends a single allocation (and syncs a lost item to its exit checklist). */
  async endActiveOne(actor: Actor, alloc: AllocationRow, status: 'RELEASED' | 'LOST', note: string | null) {
    await this.endAllocation(actor, alloc, status, note);
    await this.syncExitItems(actor, alloc.id, status === 'LOST' ? 'MISSING' : 'RETURNED', note);
  }

  private async endAllocation(actor: Actor, alloc: AllocationRow, status: 'RETURNED' | 'TRANSFERRED' | 'RELEASED' | 'LOST', notes: string | null, condition?: AllocationRow['returnCondition']) {
    const [ended] = await this.dbs.db
      .update(allocations)
      .set({
        status,
        endedAt: new Date(),
        endedBy: actor.userId,
        endedByName: actor.name,
        endNotes: notes,
        returnCondition: condition ?? null,
      })
      .where(and(eq(allocations.id, alloc.id), eq(allocations.status, 'ACTIVE')))
      .returning({ id: allocations.id });
    if (!ended) throw conflict('This assignment was already closed by someone else. Refresh and try again.');
  }

  /** Updates checklist items of OPEN exit cases that track this allocation. */
  async syncExitItems(actor: Actor, allocationId: string, status: ExitItemStatus, note: string | null) {
    const db = this.dbs.db;
    const fromStatuses: ExitItemStatus[] = status === 'MISSING' ? ['PENDING'] : ['PENDING', 'MISSING'];
    const updated = await db
      .update(exitItems)
      .set({
        status,
        resolvedAt: new Date(),
        resolvedByName: actor.name,
        notes: note ? sql`coalesce(${exitItems.notes} || E'\\n', '') || ${note}` : exitItems.notes,
      })
      .where(
        and(
          eq(exitItems.allocationId, allocationId),
          inArray(exitItems.status, fromStatuses),
          inArray(exitItems.exitCaseId, db.select({ id: exitCases.id }).from(exitCases).where(eq(exitCases.status, 'OPEN'))),
        ),
      )
      .returning();
    await this.history.recordMany(
      actor,
      updated.map((item) => ({
        entityType: 'EXIT_CASE' as const,
        entityId: item.exitCaseId,
        action: `ITEM_${status}`,
        summary: `${item.assetTag ? `${item.assetTag} ` : ''}${item.assetName} marked ${humanize(status).toLowerCase()}`,
        assetId: item.assetId,
        metadata: { itemId: item.id, note },
      })),
    );
    return updated;
  }

  /** New assignment to an employee: notify them, and add it to their open exit checklist if any. */
  private async afterNewEmployeeHolder(actor: Actor, asset: AssetRow, holder: ResolvedHolder, alloc: AllocationRow, consumed = false) {
    const employeeId = holder.columns.employeeId;
    if (!employeeId) return;
    const db = this.dbs.db;
    await this.notifications.notifyEmployee(employeeId, {
      type: 'ASSET_ASSIGNED',
      title: consumed ? `${asset.name} given to you` : `${asset.name} assigned to you`,
      body: `${asset.assetTag}${alloc.quantity > 1 ? ` · qty ${alloc.quantity}` : ''}`,
      link: `/assets/${asset.id}`,
    });
    // Nothing to recover later for a one-time item.
    if (consumed) return;
    const [openCase] = await db
      .select({ id: exitCases.id, caseNumber: exitCases.caseNumber })
      .from(exitCases)
      .where(and(eq(exitCases.employeeId, employeeId), eq(exitCases.status, 'OPEN')));
    if (!openCase) return;
    const [meta] = await db
      .select({ typeName: assetTypes.name, categoryName: assetCategories.name })
      .from(assetTypes)
      .innerJoin(assetCategories, eq(assetCategories.id, assetTypes.categoryId))
      .where(eq(assetTypes.id, asset.assetTypeId));
    await db.insert(exitItems).values({
      exitCaseId: openCase.id,
      assetId: asset.id,
      allocationId: alloc.id,
      assetTag: asset.assetTag,
      assetName: asset.name,
      assetTypeName: meta?.typeName ?? null,
      categoryName: meta?.categoryName ?? null,
      quantity: alloc.quantity,
      source: 'ADDED_LATER',
    });
    await this.history.record(actor, {
      entityType: 'EXIT_CASE',
      entityId: openCase.id,
      entityLabel: openCase.caseNumber,
      action: 'ITEM_ADDED',
      summary: `${asset.assetTag} ${asset.name} added to the recovery checklist (assigned during notice period)`,
      assetId: asset.id,
      employeeId,
    });
    await this.notifications.notifyPermission(
      'exit:manage',
      {
        type: 'EXIT_ITEM_ADDED',
        title: `Asset added to ${openCase.caseNumber}`,
        body: `${asset.assetTag} ${asset.name} was assigned to ${holder.name}, who is on notice period`,
        link: `/exits/${openCase.id}`,
      },
      actor.userId,
    );
  }
}
