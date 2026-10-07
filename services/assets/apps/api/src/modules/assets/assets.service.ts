import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  ASSET_STATUSES,
  type AssetCreateInput,
  type AssetUpdateInput,
  type Attributes,
  type BulkAssetInput,
  CONDITIONS,
  HOLDER_TYPES,
  LIFECYCLE,
  OWNERSHIP_TYPES,
  validateAttributes,
} from '@eam/shared';
import { type Actor, assertCan, can } from '../../common/actor';
import { normaliseCode, qrToken } from '../../common/codes';
import { badRequest, conflict, likePattern, listFilter, listParams, notFound, today, uuidParam } from '../../common/http';
import { DbService } from '../../db/db.service';
import {
  assetCategories,
  assets,
  assetTypes,
  companies,
  employees,
  exitCases,
  fieldDefinitions,
  locations,
  maintenanceRecords,
  ownershipRecords,
  vendors,
} from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';
import { SequenceService } from '../../core/sequence.service';
import { CatalogService, type EffectiveField, toFieldDef } from '../catalog/catalog.service';
import { AllocationService, type AssetRow } from './allocation.service';
import { LifecycleService } from './lifecycle.service';
import { PhotosService } from './photos.service';

const CORE_LABELS: Record<string, string> = {
  name: 'Name',
  condition: 'Condition',
  serialNumber: 'Serial number',
  manufacturer: 'Manufacturer',
  model: 'Model',
  description: 'Description',
  ownership: 'Ownership',
  ownerCompanyId: 'Owner company',
  vendorId: 'Vendor',
  purchaseDate: 'Purchase date',
  purchaseCost: 'Purchase cost',
  currency: 'Currency',
  invoiceNumber: 'Invoice number',
  warrantyExpiry: 'Warranty expiry',
  locationId: 'Location',
  quantity: 'Quantity',
};

const SORTS: Record<string, PgColumn> = {
  assetTag: assets.assetTag,
  name: assets.name,
  status: assets.status,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
  purchaseDate: assets.purchaseDate,
  purchaseCost: assets.purchaseCost,
  warrantyExpiry: assets.warrantyExpiry,
  holderName: assets.holderName,
  type: assetTypes.name,
  category: assetCategories.name,
  location: locations.name,
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly sequences: SequenceService,
    private readonly catalog: CatalogService,
    private readonly allocation: AllocationService,
    private readonly lifecycle: LifecycleService,
    private readonly photos: PhotosService,
  ) {}

  // ─── Access ───────────────────────────────────────────────────────────────

  /** Users without `asset:view` only see assets they currently hold. */
  private scope(actor: Actor): SQL | undefined | false {
    if (can(actor, 'asset:view')) return undefined;
    if (!actor.employeeId) return false;
    return sql`exists (select 1 from allocations al where al.asset_id = assets.id and al.status = 'ACTIVE' and al.employee_id = ${actor.employeeId})`;
  }

  async assertCanView(actor: Actor, assetId: string) {
    const scope = this.scope(actor);
    if (scope === undefined) return;
    if (scope === false) throw notFound('Asset');
    const [row] = await this.dbs.db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, assetId), scope));
    if (!row) throw notFound('Asset');
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  private searchCondition(search: string): SQL {
    const like = likePattern(search);
    const parts: SQL[] = [
      ilike(assets.assetTag, like),
      ilike(assets.name, like),
      ilike(assets.serialNumber, like),
      eq(assets.qrCode, normaliseCode(search)),
    ];
    const tokens = search.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (tokens.length) {
      const query = tokens
        .slice(0, 8)
        .map((t) => `${t}:*`)
        .join(' & ');
      parts.push(sql`${assets.searchVector} @@ to_tsquery('simple', ${query})`);
    }
    return or(...parts)!;
  }

  /** `f.<key>=value`, `f.<key>.min=…`, `f.<key>.max=…` filters on custom fields. */
  private async attributeConditions(q: Record<string, string>): Promise<SQL[]> {
    const wanted = new Map<string, { eq?: string; min?: string; max?: string }>();
    for (const [param, value] of Object.entries(q)) {
      const m = /^f\.([a-z][a-z0-9_]{0,49})(?:\.(min|max))?$/.exec(param);
      if (!m || value === '' || value == null) continue;
      const entry = wanted.get(m[1]) ?? {};
      entry[(m[2] as 'min' | 'max') ?? 'eq'] = String(value);
      wanted.set(m[1], entry);
    }
    if (!wanted.size) return [];
    const defs = await this.dbs.db
      .select({ key: fieldDefinitions.key, type: fieldDefinitions.type })
      .from(fieldDefinitions)
      .where(inArray(fieldDefinitions.key, [...wanted.keys()]));
    const types = new Map(defs.map((d) => [d.key, d.type]));
    const conds: SQL[] = [];
    for (const [key, f] of wanted) {
      const type = types.get(key) ?? 'text';
      const numeric = type === 'number' || type === 'currency';
      if (f.eq !== undefined) {
        if (numeric && Number.isFinite(Number(f.eq))) {
          conds.push(sql`${assets.attributes} @> ${JSON.stringify({ [key]: Number(f.eq) })}::jsonb`);
        } else if (type === 'boolean') {
          conds.push(sql`${assets.attributes} @> ${JSON.stringify({ [key]: f.eq === 'true' })}::jsonb`);
        } else if (type === 'select') {
          conds.push(sql`${assets.attributes} @> ${JSON.stringify({ [key]: f.eq })}::jsonb`);
        } else if (type === 'multiselect') {
          conds.push(sql`${assets.attributes} @> ${JSON.stringify({ [key]: [f.eq] })}::jsonb`);
        } else if (type === 'date') {
          conds.push(sql`${assets.attributes} ->> ${key} = ${f.eq}`);
        } else {
          conds.push(sql`${assets.attributes} ->> ${key} ilike ${likePattern(f.eq)}`);
        }
      }
      for (const [bound, op] of [
        ['min', sql`>=`],
        ['max', sql`<=`],
      ] as const) {
        const v = f[bound];
        if (v === undefined) continue;
        if (numeric) {
          if (!Number.isFinite(Number(v))) continue;
          conds.push(sql`(jsonb_typeof(${assets.attributes} -> ${key}) = 'number' and (${assets.attributes} ->> ${key})::numeric ${op} ${Number(v)})`);
        } else {
          conds.push(sql`${assets.attributes} ->> ${key} ${op} ${v}`);
        }
      }
    }
    return conds;
  }

  private async listConditions(actor: Actor, q: Record<string, string>, opts: { skipStatus?: boolean } = {}) {
    const conds: SQL[] = [];
    const scope = this.scope(actor);
    if (scope === false) return null;
    if (scope) conds.push(scope);

    const statuses = listFilter(q.status, ASSET_STATUSES);
    if (statuses.length && !opts.skipStatus) conds.push(inArray(assets.status, statuses));
    const conditions = listFilter(q.condition, CONDITIONS);
    if (conditions.length) conds.push(inArray(assets.condition, conditions));
    const ownership = listFilter(q.ownership, OWNERSHIP_TYPES);
    if (ownership.length) conds.push(inArray(assets.ownership, ownership));

    const ids = listFilter(q.ids).filter((id) => uuidParam(id)).slice(0, 500);
    if (ids.length) conds.push(inArray(assets.id, ids));
    const categoryId = uuidParam(q.categoryId);
    if (categoryId) conds.push(eq(assets.categoryId, categoryId));
    const typeIds = listFilter(q.assetTypeId).filter((id) => uuidParam(id));
    if (typeIds.length) conds.push(inArray(assets.assetTypeId, typeIds));
    const companyId = uuidParam(q.companyId);
    if (companyId) conds.push(eq(assets.ownerCompanyId, companyId));
    const vendorId = uuidParam(q.vendorId);
    if (vendorId) conds.push(eq(assets.vendorId, vendorId));

    const locationId = uuidParam(q.locationId);
    if (locationId) {
      // Includes sub-locations (building → floor → room).
      conds.push(sql`${assets.locationId} in (
        with recursive tree as (
          select id from locations where id = ${locationId}
          union all select l.id from locations l join tree on l.parent_id = tree.id
        ) select id from tree)`);
    }

    const holderType = listFilter(q.holderType, HOLDER_TYPES)[0];
    const holderId = uuidParam(q.holderId);
    if (holderType && holderId) {
      conds.push(sql`exists (select 1 from allocations al where al.asset_id = assets.id and al.status = 'ACTIVE'
        and al.holder_type = ${holderType}
        and coalesce(al.employee_id, al.department_id, al.location_id, al.company_id, al.vendor_id) = ${holderId})`);
    } else if (holderType) {
      conds.push(sql`exists (select 1 from allocations al where al.asset_id = assets.id and al.status = 'ACTIVE' and al.holder_type = ${holderType})`);
    }
    const employeeId = uuidParam(q.employeeId);
    if (employeeId) {
      conds.push(sql`exists (select 1 from allocations al where al.asset_id = assets.id and al.status = 'ACTIVE' and al.employee_id = ${employeeId})`);
    }
    if (q.unassigned === '1') conds.push(sql`${assets.holderType} is null`);

    if (q.warranty === 'expiring') {
      conds.push(sql`${assets.warrantyExpiry} between ${today()}::date and ${today()}::date + 30`);
    } else if (q.warranty === 'expired') {
      conds.push(sql`${assets.warrantyExpiry} < ${today()}::date`);
    }
    if (q.search) conds.push(this.searchCondition(String(q.search).trim().slice(0, 200)));
    conds.push(...(await this.attributeConditions(q)));
    return conds;
  }

  async list(actor: Actor, q: Record<string, string>) {
    const p = listParams(q, { sort: 'createdAt', dir: 'desc' });
    const conds = await this.listConditions(actor, q);
    if (conds === null) return { items: [], total: 0, page: p.page, pageSize: p.pageSize, statusCounts: {} };
    const where = conds.length ? and(...conds) : undefined;
    const sortCol = SORTS[p.sort] ?? assets.createdAt;
    const db = this.dbs.db;

    const statusConds = (await this.listConditions(actor, q, { skipStatus: true })) ?? [];
    const [items, [{ total }], counts] = await Promise.all([
      db
        .select({
          id: assets.id,
          assetTag: assets.assetTag,
          qrCode: assets.qrCode,
          name: assets.name,
          status: assets.status,
          condition: assets.condition,
          trackingMode: assets.trackingMode,
          quantity: assets.quantity,
          availableQuantity: assets.availableQuantity,
          serialNumber: assets.serialNumber,
          manufacturer: assets.manufacturer,
          model: assets.model,
          ownership: assets.ownership,
          purchaseDate: assets.purchaseDate,
          purchaseCost: assets.purchaseCost,
          currency: assets.currency,
          warrantyExpiry: assets.warrantyExpiry,
          holderType: assets.holderType,
          holderId: assets.holderId,
          holderName: assets.holderName,
          assignedAt: assets.assignedAt,
          attributes: assets.attributes,
          version: assets.version,
          createdAt: assets.createdAt,
          updatedAt: assets.updatedAt,
          categoryId: assets.categoryId,
          categoryName: assetCategories.name,
          categoryIcon: assetCategories.icon,
          categoryColor: assetCategories.color,
          assetTypeId: assets.assetTypeId,
          typeName: assetTypes.name,
          typeIcon: assetTypes.icon,
          consumable: assetTypes.consumable,
          locationId: assets.locationId,
          locationName: locations.name,
        })
        .from(assets)
        .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
        .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(where)
        .orderBy(p.dir === 'asc' ? asc(sortCol) : desc(sortCol), desc(assets.id))
        .limit(p.pageSize)
        .offset(p.offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(assets)
        .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
        .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(where),
      db
        .select({ status: assets.status, n: sql<number>`count(*)::int` })
        .from(assets)
        .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
        .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(statusConds.length ? and(...statusConds) : undefined)
        .groupBy(assets.status),
    ]);
    const statusCounts = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    return { items, total, page: p.page, pageSize: p.pageSize, statusCounts };
  }

  async get(actor: Actor, id: string) {
    await this.assertCanView(actor, id);
    const db = this.dbs.db;
    const [row] = await db
      .select({
        asset: assets,
        category: assetCategories,
        type: assetTypes,
        locationName: locations.name,
        ownerCompanyName: companies.name,
        vendorName: vendors.name,
      })
      .from(assets)
      .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .leftJoin(companies, eq(companies.id, assets.ownerCompanyId))
      .leftJoin(vendors, eq(vendors.id, assets.vendorId))
      .where(eq(assets.id, id));
    if (!row) throw notFound('Asset');

    const [fields, archived, active, maintenance] = await Promise.all([
      this.catalog.effectiveFields(row.asset.assetTypeId),
      db
        .select()
        .from(fieldDefinitions)
        .where(
          and(
            isNotNull(fieldDefinitions.archivedAt),
            or(eq(fieldDefinitions.categoryId, row.asset.categoryId), eq(fieldDefinitions.assetTypeId, row.asset.assetTypeId)),
          ),
        ),
      this.allocation.active(id),
      db
        .select()
        .from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.assetId, id), inArray(maintenanceRecords.status, ['SCHEDULED', 'IN_PROGRESS'])))
        .orderBy(desc(maintenanceRecords.createdAt)),
    ]);

    const employeeIds = active.map((a) => a.employeeId).filter((v): v is string => !!v);
    const openExits = employeeIds.length
      ? await db
          .select({ id: exitCases.id, caseNumber: exitCases.caseNumber, employeeId: exitCases.employeeId, lastWorkingDate: exitCases.lastWorkingDate, employeeName: employees.fullName })
          .from(exitCases)
          .innerJoin(employees, eq(employees.id, exitCases.employeeId))
          .where(and(inArray(exitCases.employeeId, employeeIds), eq(exitCases.status, 'OPEN')))
      : [];

    return {
      ...row.asset,
      searchVector: undefined,
      category: row.category,
      type: row.type,
      locationName: row.locationName,
      ownerCompanyName: row.ownerCompanyName,
      vendorName: row.vendorName,
      fields,
      archivedFields: archived.filter((f) => row.asset.attributes[f.key] !== undefined),
      activeAllocations: await this.photos.withPhotos(active),
      photos: await this.photos.forAsset(id),
      openMaintenance: maintenance,
      openExits,
    };
  }

  async lookup(actor: Actor, raw: string) {
    const code = normaliseCode(raw);
    if (!code) throw notFound('Asset');
    const [row] = await this.dbs.db
      .select({ id: assets.id, assetTag: assets.assetTag, name: assets.name, status: assets.status })
      .from(assets)
      .where(or(eq(assets.qrCode, code), sql`upper(${assets.assetTag}) = upper(${code})`, sql`lower(${assets.serialNumber}) = lower(${code})`))
      .limit(1);
    if (!row) throw new NotFoundException(`No asset matches "${code}"`);
    await this.assertCanView(actor, row.id);
    return row;
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  private async validate(fields: EffectiveField[], input: unknown) {
    const result = validateAttributes(fields.map(toFieldDef), input);
    if (!result.ok) {
      const errors = Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [`attributes.${k}`, v]));
      throw badRequest(Object.values(result.errors)[0] ?? 'Please fix the highlighted fields', errors);
    }
    return result.value;
  }

  /** Unique custom fields (e.g. IMEI, registration no.) — serialised with an advisory lock. */
  private async assertUnique(fields: EffectiveField[], attrs: Attributes, asset: { assetTypeId: string; categoryId: string }, excludeId?: string) {
    const db = this.dbs.db;
    for (const f of fields.filter((x) => x.isUnique)) {
      const value = attrs[f.key];
      if (value === undefined || value === null || value === '') continue;
      const json = JSON.stringify(value);
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${f.id}:${json}`}))`);
      const scope = f.inherited ? sql`category_id = ${asset.categoryId}` : sql`asset_type_id = ${asset.assetTypeId}`;
      const clash = await db.execute<{ asset_tag: string }>(sql`
        select asset_tag from assets
        where ${scope} and attributes -> ${f.key} = ${json}::jsonb ${excludeId ? sql`and id <> ${excludeId}` : sql``}
        limit 1`);
      if (clash.rows.length) {
        const msg = `${f.label} "${value}" is already used by ${clash.rows[0].asset_tag}`;
        throw badRequest(msg, { [`attributes.${f.key}`]: msg });
      }
    }
  }

  private async ownerNames(ownerCompanyId?: string | null, vendorId?: string | null) {
    const db = this.dbs.db;
    const [c] = ownerCompanyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, ownerCompanyId)) : [];
    const [v] = vendorId ? await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, vendorId)) : [];
    return { ownerCompanyName: c?.name ?? null, vendorName: v?.name ?? null };
  }

  async create(actor: Actor, input: AssetCreateInput) {
    return this.dbs.tx(async (db) => {
      const [type] = await db.select().from(assetTypes).where(eq(assetTypes.id, input.assetTypeId));
      if (!type) throw badRequest('Choose an asset type', { assetTypeId: 'Asset type not found' });
      const fields = await this.catalog.effectiveFields(type.id);
      const attributes = await this.validate(fields, input.attributes);
      await this.assertUnique(fields, attributes, { assetTypeId: type.id, categoryId: type.categoryId });

      const pooled = type.trackingMode === 'QUANTITY';
      const wantsInventory = input.status === 'IN_INVENTORY';
      const startStatus = wantsInventory ? (pooled ? 'AVAILABLE' : 'RECEIVED') : input.status;
      if (input.assignTo && startStatus !== 'AVAILABLE' && !wantsInventory) {
        throw badRequest('Only available assets can be assigned. Set the status to Available.', { status: 'Must be Available to assign' });
      }
      const quantity = pooled ? input.quantity : 1;
      const assetTag = await this.sequences.next(type.code, 6);

      const { assignTo, status: _s, quantity: _q, attributes: _a, assetTypeId: _t, ...core } = input;
      const [asset] = await db
        .insert(assets)
        .values({
          ...core,
          ownerCompanyId: core.ownerCompanyId ?? (await this.dbs.defaultCompanyId()),
          currency: core.currency ?? 'INR',
          assetTag,
          qrCode: qrToken(),
          categoryId: type.categoryId,
          assetTypeId: type.id,
          trackingMode: type.trackingMode,
          status: startStatus,
          quantity,
          availableQuantity: quantity,
          attributes,
          createdBy: actor.userId,
        })
        .returning();

      await db.insert(ownershipRecords).values({
        assetId: asset.id,
        ownership: asset.ownership,
        ownerCompanyId: asset.ownerCompanyId,
        vendorId: asset.vendorId,
        ...(await this.ownerNames(asset.ownerCompanyId, asset.vendorId)),
        recordedBy: actor.userId,
      });
      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: asset.id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: 'CREATED',
        summary: `${type.name} added${pooled ? ` (quantity ${quantity})` : ''} as ${startStatus.toLowerCase().replace('_', ' ')}`,
        metadata: { assetTypeId: type.id, status: startStatus },
      });

      if (wantsInventory && !pooled) {
        await this.allocation.assign(actor, asset.id, { holderType: 'INVENTORY', holderId: input.locationId ?? null, quantity: 1 });
      }
      if (assignTo) {
        await this.allocation.assign(actor, asset.id, { holderType: assignTo.holderType, holderId: assignTo.holderId, quantity: 1 });
      }
      const [fresh] = await db.select().from(assets).where(eq(assets.id, asset.id));
      return { ...fresh, searchVector: undefined };
    });
  }

  async update(actor: Actor, id: string, input: AssetUpdateInput) {
    return this.dbs.tx(async (db) => {
      const asset = await this.allocation.lock(id);
      if (asset.version !== input.version) {
        throw conflict('This asset was changed by someone else. Refresh to see the latest version.');
      }
      const { version: _v, attributes: attrInput, quantity, ...core } = input;
      const { currency, ...rest } = core;
      const patch: Partial<AssetRow> = { ...rest, ...(currency !== undefined ? { currency: currency ?? 'INR' } : {}) };
      const labels: Record<string, string> = { ...CORE_LABELS };
      let changes = diffChanges(asset, core, labels);

      if (attrInput !== undefined) {
        const fields = await this.catalog.effectiveFields(asset.assetTypeId);
        const clean = await this.validate(fields, attrInput);
        await this.assertUnique(fields, clean, asset, id);
        // Keep values of archived fields so no data is ever lost.
        const activeKeys = new Set(fields.map((f) => f.key));
        const preserved = Object.fromEntries(Object.entries(asset.attributes).filter(([k]) => !activeKeys.has(k)));
        patch.attributes = { ...preserved, ...clean };
        for (const f of fields) {
          const from = asset.attributes[f.key] ?? null;
          const to = clean[f.key] ?? null;
          if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field: `attributes.${f.key}`, label: f.label, from, to });
        }
      }

      if (quantity !== undefined && asset.trackingMode === 'QUANTITY' && quantity !== asset.quantity) {
        const allocated = asset.quantity - asset.availableQuantity;
        if (quantity < allocated) throw badRequest(`${allocated} unit(s) are assigned; quantity cannot be lower.`, { quantity: `At least ${allocated}` });
        patch.quantity = quantity;
        patch.availableQuantity = quantity - allocated;
        if (asset.status === 'ASSIGNED' && patch.availableQuantity > 0) patch.status = 'AVAILABLE';
        if (asset.status === 'AVAILABLE' && patch.availableQuantity === 0) patch.status = 'ASSIGNED';
        changes.push({ field: 'quantity', label: 'Quantity', from: asset.quantity, to: quantity });
      }

      changes = changes.filter((c, i, arr) => arr.findIndex((x) => x.field === c.field) === i);
      if (!changes.length) return { ...asset, searchVector: undefined };

      const [updated] = await db
        .update(assets)
        .set({ ...patch, version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(eq(assets.id, id))
        .returning();

      if (changes.some((c) => ['ownership', 'ownerCompanyId', 'vendorId'].includes(c.field))) {
        await db.update(ownershipRecords).set({ endedAt: new Date() }).where(and(eq(ownershipRecords.assetId, id), sql`${ownershipRecords.endedAt} is null`));
        await db.insert(ownershipRecords).values({
          assetId: id,
          ownership: updated.ownership,
          ownerCompanyId: updated.ownerCompanyId,
          vendorId: updated.vendorId,
          ...(await this.ownerNames(updated.ownerCompanyId, updated.vendorId)),
          recordedBy: actor.userId,
        });
      }

      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: id,
        entityLabel: `${updated.assetTag} · ${updated.name}`,
        action: 'UPDATED',
        summary: `Updated ${changes
          .slice(0, 3)
          .map((c) => c.label ?? c.field)
          .join(', ')}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}`,
        changes,
      });
      return { ...updated, searchVector: undefined };
    });
  }

  async moveLocation(actor: Actor, id: string, locationId: string, notes?: string | null) {
    return this.dbs.tx(async (db) => {
      const asset = await this.allocation.lock(id);
      if (asset.locationId === locationId) return { ok: true };
      const [loc] = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, locationId));
      if (!loc) throw badRequest('Location not found');
      const [from] = asset.locationId ? await db.select({ name: locations.name }).from(locations).where(eq(locations.id, asset.locationId)) : [];
      await db.update(assets).set({ locationId, version: sql`${assets.version} + 1`, updatedAt: new Date() }).where(eq(assets.id, id));
      await this.history.record(actor, {
        entityType: 'ASSET',
        entityId: id,
        entityLabel: `${asset.assetTag} · ${asset.name}`,
        action: 'LOCATION_CHANGED',
        summary: `Moved ${from ? `from ${from.name} ` : ''}to ${loc.name}${notes ? ` — ${notes}` : ''}`,
        changes: [{ field: 'locationId', label: 'Location', from: from?.name ?? null, to: loc.name }],
      });
      return { ok: true };
    });
  }

  async bulk(actor: Actor, input: BulkAssetInput) {
    let run: (id: string) => Promise<unknown>;
    switch (input.action) {
      case 'assign':
        assertCan(actor, 'asset:assign');
        if (!input.holderType || !input.holderId) throw badRequest('Choose who to assign to', { holderId: 'Required' });
        run = (id) => this.allocation.assign(actor, id, { holderType: input.holderType!, holderId: input.holderId!, quantity: 1, notes: input.notes ?? null });
        break;
      case 'lifecycle': {
        if (!input.lifecycleAction) throw badRequest('Choose an action', { lifecycleAction: 'Required' });
        assertCan(actor, LIFECYCLE[input.lifecycleAction].permission);
        const action = input.lifecycleAction;
        run = (id) => this.lifecycle.perform(actor, id, { action, notes: input.notes ?? null, locationId: input.locationId ?? null });
        break;
      }
      case 'move_location':
        assertCan(actor, 'asset:edit');
        if (!input.locationId) throw badRequest('Choose a location', { locationId: 'Required' });
        run = (id) => this.moveLocation(actor, id, input.locationId!, input.notes);
        break;
    }
    const results: { id: string; ok: boolean; error?: string }[] = [];
    // Each asset runs in its own transaction so one failure does not block the rest.
    for (const id of input.ids) {
      try {
        await run(id);
        results.push({ id, ok: true });
      } catch (err) {
        const res = (err as { getResponse?: () => unknown }).getResponse?.();
        const message = typeof res === 'object' && res && 'message' in res ? String((res as { message: unknown }).message) : (err as Error).message;
        results.push({ id, ok: false, error: message });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  async ownershipHistory(actor: Actor, id: string) {
    await this.assertCanView(actor, id);
    return this.dbs.db.select().from(ownershipRecords).where(eq(ownershipRecords.assetId, id)).orderBy(desc(ownershipRecords.startedAt));
  }

  async allocationHistory(actor: Actor, id: string) {
    await this.assertCanView(actor, id);
    return this.photos.withPhotos(await this.allocation.listForAsset(id));
  }

  async timeline(actor: Actor, id: string, q: Record<string, string>) {
    await this.assertCanView(actor, id);
    const p = listParams(q, { sort: 'occurredAt', pageSize: 100 });
    return this.history.list({ assetId: id }, p);
  }
}
