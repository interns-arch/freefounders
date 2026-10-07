import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ASSET_STATUS_LABELS, type AssetStatus, canPerform, LIFECYCLE, type LifecycleInput } from '@eam/shared';
import { type Actor, assertCan } from '../../common/actor';
import { badRequest, conflict } from '../../common/http';
import { DbService } from '../../db/db.service';
import { allocations, assets, maintenanceRecords } from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { AllocationService, type AssetRow } from './allocation.service';

const HISTORY_ACTION: Record<string, string> = {
  receive: 'RECEIVED',
  make_available: 'MADE_AVAILABLE',
  retire: 'RETIRED',
  reinstate: 'REINSTATED',
  mark_lost: 'MARKED_LOST',
  mark_found: 'MARKED_FOUND',
  dispose: 'DISPOSED',
};

/** Status transitions that are not custody changes: receive, release, retire, lost/found, dispose. */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly allocation: AllocationService,
  ) {}

  async perform(actor: Actor, assetId: string, input: LifecycleInput) {
    const rule = LIFECYCLE[input.action];
    assertCan(actor, rule.permission);

    switch (input.action) {
      case 'assign':
      case 'transfer':
      case 'return':
        throw badRequest(`Use the ${rule.label.toLowerCase()} form for this action.`);
      case 'start_maintenance':
      case 'complete_maintenance':
        throw badRequest('Use the maintenance module for this action.');
      case 'move_to_inventory':
        return this.allocation.assign(actor, assetId, {
          holderType: 'INVENTORY',
          holderId: input.locationId ?? null,
          quantity: 1,
          notes: input.notes ?? null,
        });
    }

    return this.dbs.tx(async (db) => {
      const asset = await this.allocation.lock(assetId);
      const active = await this.allocation.active(assetId);
      const ctx = {
        status: asset.status,
        trackingMode: asset.trackingMode,
        availableQuantity: asset.availableQuantity,
        activeAllocations: active.length,
      };
      if (!canPerform(input.action, ctx)) {
        throw conflict(
          asset.trackingMode === 'QUANTITY' && active.length > 0 && input.action === 'retire'
            ? `Recover the ${asset.quantity - asset.availableQuantity} assigned unit(s) before retiring.`
            : `Cannot ${rule.label.toLowerCase()} an asset that is ${ASSET_STATUS_LABELS[asset.status].toLowerCase()}.`,
        );
      }

      const to = rule.to as AssetStatus;
      const patch: Partial<AssetRow> = {};
      const note = input.notes ?? null;

      // Leaving custody-bearing states closes the open allocation.
      if (input.action === 'mark_lost') {
        await this.allocation.endActive(actor, asset, 'LOST', note ?? 'Marked lost');
        Object.assign(patch, { holderType: null, holderId: null, holderName: null, assignedAt: null });
      } else if ((input.action === 'make_available' || input.action === 'retire') && active.length && asset.trackingMode === 'INDIVIDUAL') {
        await this.allocation.endActive(actor, asset, 'RELEASED', note ?? `Released (${rule.label.toLowerCase()})`);
        Object.assign(patch, { holderType: null, holderId: null, holderName: null, assignedAt: null });
      }
      if (input.action === 'retire' && asset.status === 'IN_MAINTENANCE') {
        await db
          .update(maintenanceRecords)
          .set({ status: 'COMPLETED', completedAt: new Date(), resolution: sql`coalesce(${maintenanceRecords.resolution}, 'Asset retired')`, updatedAt: new Date() })
          .where(and(eq(maintenanceRecords.assetId, assetId), inArray(maintenanceRecords.status, ['SCHEDULED', 'IN_PROGRESS'])));
      }

      await db
        .update(assets)
        .set({ ...patch, status: to, version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(eq(assets.id, assetId));
      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: asset.id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: HISTORY_ACTION[input.action] ?? input.action.toUpperCase(),
        summary: `${rule.label}${note ? ` — ${note}` : ''}`,
        changes: [{ field: 'status', label: 'Status', from: asset.status, to }],
        employeeId: active[0]?.employeeId ?? null,
      });
      return { ok: true, status: to };
    });
  }

  /**
   * Writes off one allocation as lost (used when an exit is completed with an authorised
   * override). Individual assets become LOST; for pooled assets the lost units leave the pool.
   */
  async writeOffAllocation(actor: Actor, allocationId: string, note: string) {
    return this.dbs.tx(async (db) => {
      const [alloc] = await db.select().from(allocations).where(eq(allocations.id, allocationId));
      if (!alloc || alloc.status !== 'ACTIVE') return;
      const asset = await this.allocation.lock(alloc.assetId);
      if (asset.trackingMode === 'QUANTITY') {
        await this.allocation.endActiveOne(actor, alloc, 'LOST', note);
        const quantity = Math.max(asset.quantity - alloc.quantity, asset.availableQuantity);
        await db
          .update(assets)
          .set({
            quantity,
            status: asset.availableQuantity > 0 ? 'AVAILABLE' : quantity === 0 ? 'LOST' : asset.status,
            version: sql`${assets.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, asset.id));
        await this.history.record(actor, {
          entityType: 'ASSET',
          entityId: asset.id,
          entityLabel: `${asset.assetTag} · ${asset.name}`,
          action: 'UNITS_LOST',
          summary: `${alloc.quantity} unit(s) not returned by ${alloc.holderName} — written off. ${note}`,
          employeeId: alloc.employeeId,
          changes: [{ field: 'quantity', label: 'Quantity', from: asset.quantity, to: quantity }],
        });
        return;
      }
      await this.allocation.endActive(actor, asset, 'LOST', note);
      await db
        .update(assets)
        .set({ status: 'LOST', holderType: null, holderId: null, holderName: null, assignedAt: null, version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: asset.id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: 'MARKED_LOST',
        summary: `Not returned by ${alloc.holderName} — marked lost. ${note}`,
        employeeId: alloc.employeeId,
        changes: [{ field: 'status', label: 'Status', from: asset.status, to: 'LOST' }],
      });
    });
  }
}
