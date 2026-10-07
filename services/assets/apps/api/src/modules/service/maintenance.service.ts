import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  LIFECYCLE,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  type MaintenanceInput,
  type MaintenanceUpdateInput,
} from '@eam/shared';
import { type Actor, assertCan, canAny } from '../../common/actor';
import { badRequest, conflict, likePattern, listFilter, listParams, notFound, uuidParam } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assets, maintenanceRecords, vendors } from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';
import { SequenceService } from '../../core/sequence.service';
import { AllocationService, type AssetRow } from '../assets/allocation.service';

type Row = typeof maintenanceRecords.$inferSelect;

/** Maintenance: moves an asset into IN_MAINTENANCE and back to service when completed. */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly sequences: SequenceService,
    private readonly allocation: AllocationService,
  ) {}

  async list(actor: Actor, q: Record<string, string>) {
    if (!canAny(actor, 'maintenance:manage', 'asset:view')) return { items: [], total: 0, page: 1, pageSize: 25 };
    const p = listParams(q, { sort: 'createdAt', dir: 'desc' });
    const conds: SQL[] = [];
    const statuses = listFilter(q.status, MAINTENANCE_STATUSES);
    if (statuses.length) conds.push(inArray(maintenanceRecords.status, statuses));
    const types = listFilter(q.type, MAINTENANCE_TYPES);
    if (types.length) conds.push(inArray(maintenanceRecords.type, types));
    const assetId = uuidParam(q.assetId);
    if (assetId) conds.push(eq(maintenanceRecords.assetId, assetId));
    if (p.search) {
      const like = likePattern(p.search);
      conds.push(or(ilike(maintenanceRecords.number, like), ilike(maintenanceRecords.title, like), ilike(assets.assetTag, like), ilike(assets.name, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const db = this.dbs.db;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ record: maintenanceRecords, assetTag: assets.assetTag, assetName: assets.name, assetStatus: assets.status, vendorName: vendors.name })
        .from(maintenanceRecords)
        .innerJoin(assets, eq(assets.id, maintenanceRecords.assetId))
        .leftJoin(vendors, eq(vendors.id, maintenanceRecords.vendorId))
        .where(where)
        .orderBy(sql`case ${maintenanceRecords.status} when 'IN_PROGRESS' then 0 when 'SCHEDULED' then 1 else 2 end`, desc(maintenanceRecords.createdAt))
        .limit(p.pageSize)
        .offset(p.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(maintenanceRecords).innerJoin(assets, eq(assets.id, maintenanceRecords.assetId)).where(where),
    ]);
    return { items: rows.map(({ record, ...rest }) => ({ ...record, ...rest })), total, page: p.page, pageSize: p.pageSize };
  }

  /** Puts the asset into maintenance (keeps any holder so it goes back to them afterwards). */
  private async startOn(actor: Actor, asset: AssetRow, record: Row) {
    if (asset.trackingMode === 'QUANTITY') throw badRequest('Maintenance is tracked for individually tracked assets.');
    if (!LIFECYCLE.start_maintenance.from.includes(asset.status)) {
      throw conflict(`Cannot send an asset that is ${ASSET_STATUS_LABELS[asset.status].toLowerCase()} to maintenance.`);
    }
    await this.dbs.db
      .update(assets)
      .set({ status: 'IN_MAINTENANCE', version: sql`${assets.version} + 1`, updatedAt: new Date() })
      .where(eq(assets.id, asset.id));
    await this.dbs.db
      .update(maintenanceRecords)
      .set({ status: 'IN_PROGRESS', startedAt: new Date(), previousStatus: asset.status, updatedAt: new Date() })
      .where(eq(maintenanceRecords.id, record.id));
    await this.history.record(actor, {
      entityType: 'ASSET',
      entityId: asset.id,
      entityLabel: `${asset.assetTag} · ${asset.name}`,
      action: 'MAINTENANCE_STARTED',
      summary: `Sent to maintenance (${record.number}): ${record.title}`,
      changes: [{ field: 'status', label: 'Status', from: asset.status, to: 'IN_MAINTENANCE' }],
      metadata: { maintenanceId: record.id },
    });
  }

  /** Back to service: to the holder if it still has one, otherwise available. */
  private async finishOn(actor: Actor, asset: AssetRow, record: Row, outcome: 'COMPLETED' | 'CANCELLED') {
    if (asset.status !== 'IN_MAINTENANCE') return;
    const active = await this.allocation.active(asset.id);
    const next: AssetStatus = active.length ? (active[0].holderType === 'INVENTORY' ? 'IN_INVENTORY' : 'ASSIGNED') : 'AVAILABLE';
    await this.dbs.db
      .update(assets)
      .set({ status: next, version: sql`${assets.version} + 1`, updatedAt: new Date() })
      .where(eq(assets.id, asset.id));
    await this.history.record(actor, {
      entityType: 'ASSET',
      entityId: asset.id,
      entityLabel: `${asset.assetTag} · ${asset.name}`,
      action: outcome === 'COMPLETED' ? 'MAINTENANCE_COMPLETED' : 'MAINTENANCE_CANCELLED',
      summary: `Maintenance ${outcome.toLowerCase()} (${record.number})${active.length ? ` — back with ${active[0].holderName}` : ''}`,
      changes: [{ field: 'status', label: 'Status', from: 'IN_MAINTENANCE', to: next }],
      metadata: { maintenanceId: record.id },
    });
  }

  async create(actor: Actor, input: MaintenanceInput) {
    assertCan(actor, 'maintenance:manage');
    return this.dbs.tx(async (db) => {
      const asset = await this.allocation.lock(input.assetId);
      const number = await this.sequences.next('MNT', 5);
      const { startNow, ...fields } = input;
      const [record] = await db
        .insert(maintenanceRecords)
        .values({ ...fields, number, status: 'SCHEDULED', createdBy: actor.userId, createdByName: actor.name })
        .returning();
      await this.history.record(actor, {
        entityType: 'MAINTENANCE',
        entityId: record.id,
        entityLabel: number,
        action: 'CREATED',
        summary: `${number} for ${asset.assetTag}: ${record.title}`,
        assetId: asset.id,
      });
      if (startNow) {
        await this.startOn(actor, asset, record);
      } else {
        await this.history.record(actor, {
          entityType: 'ASSET',
          entityId: asset.id,
          action: 'MAINTENANCE_SCHEDULED',
          summary: `Maintenance scheduled (${number})${record.scheduledDate ? ` for ${record.scheduledDate}` : ''}: ${record.title}`,
          metadata: { maintenanceId: record.id },
        });
      }
      const [fresh] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, record.id));
      return fresh;
    });
  }

  async update(actor: Actor, id: string, input: MaintenanceUpdateInput) {
    assertCan(actor, 'maintenance:manage');
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).for('update');
      if (!before) throw notFound('Maintenance record');
      const asset = await this.allocation.lock(before.assetId);
      const { status, ...rest } = input;

      if (status && status !== before.status) {
        if (before.status === 'COMPLETED' || before.status === 'CANCELLED') throw conflict(`This record is already ${before.status.toLowerCase()}.`);
        if (status === 'SCHEDULED') throw badRequest('A started maintenance cannot go back to scheduled.');
        if (status === 'IN_PROGRESS') await this.startOn(actor, asset, before);
        if (status === 'COMPLETED' || status === 'CANCELLED') {
          if (before.status === 'IN_PROGRESS') await this.finishOn(actor, asset, before, status);
          await db
            .update(maintenanceRecords)
            .set({ status, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(maintenanceRecords.id, id));
        }
      }
      const changes = diffChanges(before, { ...rest, ...(status ? { status } : {}) }, { status: 'Status', resolution: 'Resolution', cost: 'Cost', vendorId: 'Vendor', scheduledDate: 'Scheduled date' });
      if (Object.values(rest).some((v) => v !== undefined)) {
        await db.update(maintenanceRecords).set({ ...rest, updatedAt: new Date() }).where(eq(maintenanceRecords.id, id));
      }
      if (changes.length) {
        await this.history.record(actor, {
          entityType: 'MAINTENANCE',
          entityId: id,
          entityLabel: before.number,
          action: status && status !== before.status ? `STATUS_${status}` : 'UPDATED',
          summary: status && status !== before.status ? `Maintenance ${status.replace('_', ' ').toLowerCase()}` : 'Maintenance updated',
          changes,
          assetId: before.assetId,
        });
      }
      const [fresh] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, id));
      return fresh;
    });
  }
}
