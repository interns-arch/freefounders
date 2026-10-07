import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  type AssetTypeInput,
  type CategoryInput,
  type FieldDef,
  type FieldDefinitionInput,
  type FieldUpdateInput,
  slugifyKey,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { badRequest, conflict, likePattern, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { assetCategories, assetTypes, fieldDefinitions } from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';

export type FieldRow = typeof fieldDefinitions.$inferSelect;
export interface EffectiveField extends FieldRow {
  inherited: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  label: 'Label',
  required: 'Required',
  isUnique: 'Unique',
  options: 'Options',
  min: 'Min',
  max: 'Max',
  placeholder: 'Placeholder',
  helpText: 'Help text',
  showInTable: 'Show in table',
  filterable: 'Filterable',
};

export function toFieldDef(f: FieldRow): FieldDef {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    isUnique: f.isUnique,
    options: f.options,
    min: f.min,
    max: f.max,
    placeholder: f.placeholder,
    helpText: f.helpText,
  };
}

/**
 * Categories → asset types → custom fields. This is the "no hard-coded structure" engine:
 * everything an asset looks like is data that admins manage from the UI.
 */
@Injectable()
export class CatalogService {
  private readonly fieldCache = new Map<string, EffectiveField[]>();

  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
  ) {}

  private invalidate() {
    this.fieldCache.clear();
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  async listCategories() {
    const db = this.dbs.db;
    const [cats, fields] = await Promise.all([
      db
        .select({
          category: assetCategories,
          typeCount: sql<number>`(select count(*)::int from asset_types t where t.category_id = asset_categories.id)`,
          assetCount: sql<number>`(select count(*)::int from assets a where a.category_id = asset_categories.id)`,
        })
        .from(assetCategories)
        .orderBy(asc(assetCategories.sortOrder), asc(assetCategories.name)),
      db
        .select()
        .from(fieldDefinitions)
        .where(and(sql`${fieldDefinitions.categoryId} is not null`, isNull(fieldDefinitions.archivedAt)))
        .orderBy(asc(fieldDefinitions.sortOrder)),
    ]);
    return cats.map((c) => ({
      ...c.category,
      typeCount: c.typeCount,
      assetCount: c.assetCount,
      fields: fields.filter((f) => f.categoryId === c.category.id),
    }));
  }

  async getCategory(id: string) {
    const [cat] = await this.dbs.db.select().from(assetCategories).where(eq(assetCategories.id, id));
    if (!cat) throw notFound('Category');
    return cat;
  }

  async createCategory(actor: Actor, input: CategoryInput) {
    return this.dbs.tx(async (db) => {
      const [{ next }] = await db
        .select({ next: sql<number>`coalesce(max(${assetCategories.sortOrder}), 0) + 1` })
        .from(assetCategories);
      const [row] = await db.insert(assetCategories).values({ ...input, sortOrder: next }).returning();
      await this.history.record(actor, {
        entityType: 'CATEGORY',
        entityId: row.id,
        entityLabel: row.name,
        action: 'CREATED',
        summary: `Category "${row.name}" created`,
      });
      return row;
    });
  }

  async updateCategory(actor: Actor, id: string, input: CategoryInput) {
    return this.dbs.tx(async (db) => {
      const before = await this.getCategory(id);
      const changes = diffChanges(before, input, { name: 'Name', code: 'Code', icon: 'Icon', color: 'Colour', description: 'Description' });
      if (!changes.length) return before;
      const [row] = await db
        .update(assetCategories)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(assetCategories.id, id))
        .returning();
      await this.history.record(actor, {
        entityType: 'CATEGORY',
        entityId: id,
        entityLabel: row.name,
        action: 'UPDATED',
        summary: `Category "${row.name}" updated`,
        changes,
      });
      return row;
    });
  }

  async deleteCategory(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const cat = await this.getCategory(id);
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assetTypes).where(eq(assetTypes.categoryId, id));
      if (n > 0) throw conflict(`Remove the ${n} asset type(s) in "${cat.name}" first.`);
      await db.delete(assetCategories).where(eq(assetCategories.id, id));
      await this.history.record(actor, {
        entityType: 'CATEGORY',
        entityId: id,
        entityLabel: cat.name,
        action: 'DELETED',
        summary: `Category "${cat.name}" deleted`,
      });
      this.invalidate();
      return { ok: true };
    });
  }

  // ─── Asset types ──────────────────────────────────────────────────────────

  async listTypes(query: { categoryId?: string; search?: string }) {
    const conds: SQL[] = [];
    if (query.categoryId) conds.push(eq(assetTypes.categoryId, query.categoryId));
    if (query.search) {
      const p = likePattern(query.search);
      conds.push(or(ilike(assetTypes.name, p), ilike(assetTypes.code, p), ilike(assetCategories.name, p))!);
    }
    const rows = await this.dbs.db
      .select({
        type: assetTypes,
        categoryName: assetCategories.name,
        categoryIcon: assetCategories.icon,
        categoryColor: assetCategories.color,
        assetCount: sql<number>`(select count(*)::int from assets a where a.asset_type_id = asset_types.id)`,
        availableCount: sql<number>`(select coalesce(sum(case when a.tracking_mode = 'QUANTITY' then a.available_quantity else 1 end), 0)::int from assets a where a.asset_type_id = asset_types.id and a.status = 'AVAILABLE')`,
        fieldCount: sql<number>`(select count(*)::int from field_definitions f where f.asset_type_id = asset_types.id and f.archived_at is null)`,
      })
      .from(assetTypes)
      .innerJoin(assetCategories, eq(assetCategories.id, assetTypes.categoryId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(assetCategories.sortOrder), asc(assetTypes.name));
    return rows.map(({ type, ...rest }) => ({ ...type, ...rest }));
  }

  async getType(id: string) {
    const [row] = await this.dbs.db
      .select({ type: assetTypes, category: assetCategories })
      .from(assetTypes)
      .innerJoin(assetCategories, eq(assetCategories.id, assetTypes.categoryId))
      .where(eq(assetTypes.id, id));
    if (!row) throw notFound('Asset type');
    const fields = await this.effectiveFields(id);
    const [{ assetCount }] = await this.dbs.db
      .select({ assetCount: sql<number>`count(*)::int` })
      .from(sql`assets`)
      .where(sql`asset_type_id = ${id}`);
    return { ...row.type, category: row.category, fields, assetCount };
  }

  async createType(actor: Actor, input: AssetTypeInput) {
    await this.getCategory(input.categoryId);
    if (input.consumable && input.trackingMode !== 'QUANTITY') throw badRequest('One-time items are tracked by quantity', { consumable: 'Needs quantity tracking' });
    return this.dbs.tx(async (db) => {
      const [row] = await db.insert(assetTypes).values(input).returning();
      await this.history.record(actor, {
        entityType: 'ASSET_TYPE',
        entityId: row.id,
        entityLabel: row.name,
        action: 'CREATED',
        summary: `Asset type "${row.name}" created`,
      });
      return row;
    });
  }

  async updateType(actor: Actor, id: string, input: AssetTypeInput) {
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(assetTypes).where(eq(assetTypes.id, id)).for('update');
      if (!before) throw notFound('Asset type');
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sql`assets`).where(sql`asset_type_id = ${id}`);
      if (n > 0 && input.trackingMode !== before.trackingMode) {
        throw conflict('Tracking mode cannot change once assets of this type exist.');
      }
      if (n > 0 && input.categoryId !== before.categoryId) {
        throw conflict('Category cannot change once assets of this type exist.');
      }
      if (input.consumable && input.trackingMode !== 'QUANTITY') throw badRequest('One-time items are tracked by quantity', { consumable: 'Needs quantity tracking' });
      const changes = diffChanges(before, input, {
        name: 'Name',
        code: 'Tag prefix',
        icon: 'Icon',
        description: 'Description',
        trackingMode: 'Tracking',
        consumable: 'One-time (no return)',
        categoryId: 'Category',
      });
      if (!changes.length) return before;
      const [row] = await db.update(assetTypes).set({ ...input, updatedAt: new Date() }).where(eq(assetTypes.id, id)).returning();
      await this.history.record(actor, {
        entityType: 'ASSET_TYPE',
        entityId: id,
        entityLabel: row.name,
        action: 'UPDATED',
        summary: `Asset type "${row.name}" updated`,
        changes,
      });
      this.invalidate();
      return row;
    });
  }

  async deleteType(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const [type] = await db.select().from(assetTypes).where(eq(assetTypes.id, id));
      if (!type) throw notFound('Asset type');
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sql`assets`).where(sql`asset_type_id = ${id}`);
      if (n > 0) throw conflict(`${n} asset(s) use this type. Dispose or delete them first.`);
      await db.delete(assetTypes).where(eq(assetTypes.id, id));
      await this.history.record(actor, {
        entityType: 'ASSET_TYPE',
        entityId: id,
        entityLabel: type.name,
        action: 'DELETED',
        summary: `Asset type "${type.name}" deleted`,
      });
      this.invalidate();
      return { ok: true };
    });
  }

  // ─── Fields ───────────────────────────────────────────────────────────────

  /** Category fields followed by type fields — what an asset of this type must look like. */
  async effectiveFields(assetTypeId: string): Promise<EffectiveField[]> {
    const cached = this.fieldCache.get(assetTypeId);
    if (cached && !this.dbs.inTransaction) return cached;
    const [type] = await this.dbs.db
      .select({ categoryId: assetTypes.categoryId })
      .from(assetTypes)
      .where(eq(assetTypes.id, assetTypeId));
    if (!type) throw notFound('Asset type');
    const rows = await this.dbs.db
      .select()
      .from(fieldDefinitions)
      .where(
        and(
          isNull(fieldDefinitions.archivedAt),
          or(eq(fieldDefinitions.categoryId, type.categoryId), eq(fieldDefinitions.assetTypeId, assetTypeId)),
        ),
      )
      .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.createdAt));
    const fields: EffectiveField[] = [
      ...rows.filter((f) => f.categoryId).map((f) => ({ ...f, inherited: true })),
      ...rows.filter((f) => f.assetTypeId).map((f) => ({ ...f, inherited: false })),
    ];
    if (!this.dbs.inTransaction) this.fieldCache.set(assetTypeId, fields);
    return fields;
  }

  async listFields(query: { categoryId?: string; assetTypeId?: string; includeArchived?: boolean }) {
    const conds: SQL[] = [];
    if (query.categoryId) conds.push(eq(fieldDefinitions.categoryId, query.categoryId));
    if (query.assetTypeId) conds.push(eq(fieldDefinitions.assetTypeId, query.assetTypeId));
    if (!query.includeArchived) conds.push(isNull(fieldDefinitions.archivedAt));
    return this.dbs.db
      .select()
      .from(fieldDefinitions)
      .where(and(...conds))
      .orderBy(asc(fieldDefinitions.sortOrder), asc(fieldDefinitions.createdAt));
  }

  /** All filterable fields, optionally narrowed to one category / type (for the asset filter bar). */
  async filterableFields(query: { categoryId?: string; assetTypeId?: string }) {
    if (query.assetTypeId) return (await this.effectiveFields(query.assetTypeId)).filter((f) => f.filterable);
    const conds: SQL[] = [isNull(fieldDefinitions.archivedAt), eq(fieldDefinitions.filterable, true)];
    if (query.categoryId) {
      conds.push(
        or(
          eq(fieldDefinitions.categoryId, query.categoryId),
          inArray(
            fieldDefinitions.assetTypeId,
            this.dbs.db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.categoryId, query.categoryId)),
          ),
        )!,
      );
    }
    return this.dbs.db
      .select()
      .from(fieldDefinitions)
      .where(and(...conds))
      .orderBy(asc(fieldDefinitions.sortOrder));
  }

  private async ownerLabel(f: { categoryId: string | null; assetTypeId: string | null }) {
    if (f.categoryId) return (await this.getCategory(f.categoryId)).name;
    const [t] = await this.dbs.db.select({ name: assetTypes.name }).from(assetTypes).where(eq(assetTypes.id, f.assetTypeId!));
    if (!t) throw notFound('Asset type');
    return t.name;
  }

  /**
   * Category fields and type fields merge into one form, so a key may not appear in both a
   * category and one of its types. Sibling types may reuse a key (Laptop and Desktop both have "processor").
   */
  private async assertKeyFree(key: string, categoryId: string | null, assetTypeId: string | null) {
    let scope: SQL;
    if (assetTypeId) {
      const [t] = await this.dbs.db.select({ categoryId: assetTypes.categoryId }).from(assetTypes).where(eq(assetTypes.id, assetTypeId));
      if (!t) throw notFound('Asset type');
      scope = or(eq(fieldDefinitions.categoryId, t.categoryId), eq(fieldDefinitions.assetTypeId, assetTypeId))!;
    } else {
      scope = or(
        eq(fieldDefinitions.categoryId, categoryId!),
        inArray(fieldDefinitions.assetTypeId, this.dbs.db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.categoryId, categoryId!))),
      )!;
    }
    const clash = await this.dbs.db
      .select({ id: fieldDefinitions.id })
      .from(fieldDefinitions)
      .where(and(eq(fieldDefinitions.key, key), scope))
      .limit(1);
    if (clash.length) {
      throw conflict(
        assetTypeId
          ? `A field with key "${key}" already exists on this type or its category.`
          : `A field with key "${key}" already exists on this category or one of its types.`,
      );
    }
  }

  async createField(actor: Actor, input: FieldDefinitionInput) {
    const key = input.key ?? slugifyKey(input.label);
    const categoryId = input.categoryId ?? null;
    const assetTypeId = input.assetTypeId ?? null;
    if (input.min != null && input.max != null && input.min > input.max) throw badRequest('Min cannot be greater than max', { min: 'Greater than max' });
    return this.dbs.tx(async (db) => {
      await this.assertKeyFree(key, categoryId, assetTypeId);
      const owner = await this.ownerLabel({ categoryId, assetTypeId });
      const [{ next }] = await db
        .select({ next: sql<number>`coalesce(max(${fieldDefinitions.sortOrder}), 0) + 1` })
        .from(fieldDefinitions)
        .where(categoryId ? eq(fieldDefinitions.categoryId, categoryId) : eq(fieldDefinitions.assetTypeId, assetTypeId!));
      const [row] = await db
        .insert(fieldDefinitions)
        .values({
          ...input,
          key,
          categoryId,
          assetTypeId,
          options: ['select', 'multiselect'].includes(input.type) ? input.options ?? [] : null,
          sortOrder: next,
        })
        .returning();
      await this.history.record(actor, {
        entityType: 'FIELD',
        entityId: row.id,
        entityLabel: `${owner} → ${row.label}`,
        action: 'CREATED',
        summary: `Field "${row.label}" (${row.type}) added to ${owner}`,
      });
      this.invalidate();
      return row;
    });
  }

  async updateField(actor: Actor, id: string, input: FieldUpdateInput) {
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id)).for('update');
      if (!before) throw notFound('Field');
      const min = input.min !== undefined ? input.min : before.min;
      const max = input.max !== undefined ? input.max : before.max;
      if (min != null && max != null && min > max) throw badRequest('Min cannot be greater than max', { min: 'Greater than max' });
      if (input.isUnique && !before.isUnique) await this.assertNoDuplicates(before);
      const patch: Record<string, unknown> = { ...input };
      if (!['select', 'multiselect'].includes(before.type)) delete patch.options;
      const changes = diffChanges(before, patch, FIELD_LABELS);
      if (!changes.length) return before;
      const [row] = await db
        .update(fieldDefinitions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(fieldDefinitions.id, id))
        .returning();
      const owner = await this.ownerLabel(before);
      await this.history.record(actor, {
        entityType: 'FIELD',
        entityId: id,
        entityLabel: `${owner} → ${row.label}`,
        action: 'UPDATED',
        summary: `Field "${row.label}" updated on ${owner}`,
        changes,
      });
      this.invalidate();
      return row;
    });
  }

  private async assertNoDuplicates(f: FieldRow) {
    const scope = f.assetTypeId ? sql`asset_type_id = ${f.assetTypeId}` : sql`category_id = ${f.categoryId}`;
    const result = await this.dbs.db.execute<{ value: string }>(sql`
      select attributes->>${f.key} as value from assets
      where ${scope} and attributes ? ${f.key}
      group by 1 having count(*) > 1 limit 1`);
    if (result.rows.length) {
      throw conflict(`Existing assets share the value "${result.rows[0].value}" for "${f.label}". Fix duplicates before making it unique.`);
    }
  }

  /** Removes a field. If assets already hold values for it, it is archived so no data is lost. */
  async deleteField(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const [f] = await db.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id)).for('update');
      if (!f) throw notFound('Field');
      const owner = await this.ownerLabel(f);
      const scope = f.assetTypeId ? sql`asset_type_id = ${f.assetTypeId}` : sql`category_id = ${f.categoryId}`;
      const used = await db.execute<{ used: boolean }>(sql`select exists(select 1 from assets where ${scope} and attributes ? ${f.key}) as used`);
      const archived = used.rows[0]?.used === true;
      if (archived) {
        await db.update(fieldDefinitions).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(fieldDefinitions.id, id));
      } else {
        await db.delete(fieldDefinitions).where(eq(fieldDefinitions.id, id));
      }
      await this.history.record(actor, {
        entityType: 'FIELD',
        entityId: id,
        entityLabel: `${owner} → ${f.label}`,
        action: archived ? 'ARCHIVED' : 'DELETED',
        summary: archived
          ? `Field "${f.label}" archived on ${owner} (existing values kept)`
          : `Field "${f.label}" removed from ${owner}`,
      });
      this.invalidate();
      return { ok: true, archived };
    });
  }

  async restoreField(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const [f] = await db
        .update(fieldDefinitions)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(fieldDefinitions.id, id))
        .returning();
      if (!f) throw notFound('Field');
      const owner = await this.ownerLabel(f);
      await this.history.record(actor, {
        entityType: 'FIELD',
        entityId: id,
        entityLabel: `${owner} → ${f.label}`,
        action: 'RESTORED',
        summary: `Field "${f.label}" restored on ${owner}`,
      });
      this.invalidate();
      return f;
    });
  }

  async reorderFields(ids: string[]) {
    await this.dbs.tx(async (db) => {
      for (let i = 0; i < ids.length; i++) {
        await db.update(fieldDefinitions).set({ sortOrder: i + 1 }).where(eq(fieldDefinitions.id, ids[i]));
      }
    });
    this.invalidate();
    return { ok: true };
  }
}
