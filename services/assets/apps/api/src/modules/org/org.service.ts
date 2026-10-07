import { Injectable } from '@nestjs/common';
import { asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import {
  companySchema,
  departmentSchema,
  type HistoryEntityType,
  locationSchema,
  vendorSchema,
} from '@eam/shared';
import type { ZodType } from 'zod';
import type { Actor } from '../../common/actor';
import { badRequest, likePattern, listParams, notFound, type Page } from '../../common/http';
import { DbService } from '../../db/db.service';
import { companies, departments, locations, vendors } from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';

export type OrgKind = 'companies' | 'departments' | 'locations' | 'vendors';

interface OrgConfig {
  table: PgTable & { id: PgColumn; name: PgColumn; code: PgColumn; createdAt: PgColumn };
  entityType: HistoryEntityType;
  label: string;
  schema: ZodType<Record<string, unknown>>;
  labels: Record<string, string>;
  search: PgColumn[];
  /** Extra computed columns for list / detail views. */
  extras: () => Record<string, SQL | PgColumn>;
  joins?: (q: any) => any;
  hasParent?: boolean;
}

const parentDept = alias(departments, 'parent_dept');
const parentLoc = alias(locations, 'parent_loc');
const deptCompany = alias(companies, 'dept_company');
const locCompany = alias(companies, 'loc_company');

const CONFIG: Record<OrgKind, OrgConfig> = {
  companies: {
    table: companies,
    entityType: 'COMPANY',
    label: 'Company',
    schema: companySchema as ZodType<Record<string, unknown>>,
    labels: { name: 'Name', code: 'Code', legalName: 'Legal name', address: 'Address' },
    search: [companies.name, companies.code, companies.legalName],
    extras: () => ({
      employeeCount: sql<number>`(select count(*)::int from employees e where e.company_id = companies.id and e.status <> 'EXITED')`,
      assetCount: sql<number>`(select count(*)::int from assets a where a.owner_company_id = companies.id)`,
    }),
  },
  departments: {
    table: departments,
    entityType: 'DEPARTMENT',
    label: 'Department',
    schema: departmentSchema as ZodType<Record<string, unknown>>,
    labels: { name: 'Name', code: 'Code', companyId: 'Company', parentId: 'Parent department' },
    search: [departments.name, departments.code],
    hasParent: true,
    extras: () => ({
      companyName: deptCompany.name,
      parentName: parentDept.name,
      employeeCount: sql<number>`(select count(*)::int from employees e where e.department_id = departments.id and e.status <> 'EXITED')`,
      assetCount: sql<number>`(select count(*)::int from assets a where a.holder_type = 'DEPARTMENT' and a.holder_id = departments.id)`,
    }),
    joins: (q) => q.leftJoin(deptCompany, eq(deptCompany.id, departments.companyId)).leftJoin(parentDept, eq(parentDept.id, departments.parentId)),
  },
  locations: {
    table: locations,
    entityType: 'LOCATION',
    label: 'Location',
    schema: locationSchema as ZodType<Record<string, unknown>>,
    labels: { name: 'Name', code: 'Code', type: 'Type', parentId: 'Parent location', companyId: 'Company', address: 'Address', isStore: 'Store / warehouse' },
    search: [locations.name, locations.code, locations.address],
    hasParent: true,
    extras: () => ({
      companyName: locCompany.name,
      parentName: parentLoc.name,
      assetCount: sql<number>`(select count(*)::int from assets a where a.location_id = locations.id)`,
      employeeCount: sql<number>`(select count(*)::int from employees e where e.location_id = locations.id and e.status <> 'EXITED')`,
    }),
    joins: (q) => q.leftJoin(locCompany, eq(locCompany.id, locations.companyId)).leftJoin(parentLoc, eq(parentLoc.id, locations.parentId)),
  },
  vendors: {
    table: vendors,
    entityType: 'VENDOR',
    label: 'Vendor',
    schema: vendorSchema as ZodType<Record<string, unknown>>,
    labels: { name: 'Name', code: 'Code', contactName: 'Contact', email: 'Email', phone: 'Phone', website: 'Website', address: 'Address', notes: 'Notes' },
    search: [vendors.name, vendors.code, vendors.contactName, vendors.email],
    extras: () => ({
      assetCount: sql<number>`(select count(*)::int from assets a where a.vendor_id = vendors.id)`,
      heldCount: sql<number>`(select count(*)::int from assets a where a.holder_type = 'VENDOR' and a.holder_id = vendors.id)`,
    }),
  },
};

/** Companies, departments, locations and vendors: simple master data with history. */
@Injectable()
export class OrgService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
  ) {}

  schema(kind: OrgKind) {
    return CONFIG[kind].schema;
  }

  private baseQuery(kind: OrgKind) {
    const c = CONFIG[kind];
    const q = this.dbs.db.select({ row: c.table, ...c.extras() } as any).from(c.table as any);
    return c.joins ? c.joins(q) : q;
  }

  private flatten(r: any) {
    const { row, ...rest } = r;
    return { ...row, ...rest };
  }

  async list(kind: OrgKind, query: Record<string, string>): Promise<Page<Record<string, unknown>>> {
    const c = CONFIG[kind];
    const t = c.table as any;
    const db = this.dbs.db;

    // Light mode for dropdowns: everything, sorted by name.
    if (query.all === '1') {
      const cols: Record<string, PgColumn> = { id: t.id, name: t.name, code: t.code };
      if (kind === 'locations') Object.assign(cols, { isStore: locations.isStore, type: locations.type, parentId: locations.parentId });
      if (kind === 'departments') Object.assign(cols, { companyId: departments.companyId });
      const items = await db.select(cols).from(t).orderBy(asc(t.name)).limit(5000);
      return { items, total: items.length, page: 1, pageSize: items.length };
    }

    const p = listParams(query, { sort: 'name', dir: 'asc' });
    const where = p.search ? or(...c.search.map((col) => ilike(col, likePattern(p.search)))) : undefined;
    const sortCol = { name: t.name, code: t.code, createdAt: t.createdAt }[p.sort] ?? t.name;
    const [rows, [{ total }]] = await Promise.all([
      this.baseQuery(kind)
        .where(where)
        .orderBy(p.dir === 'asc' ? asc(sortCol) : desc(sortCol))
        .limit(p.pageSize)
        .offset(p.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(t).where(where),
    ]);
    return { items: rows.map((r: any) => this.flatten(r)), total, page: p.page, pageSize: p.pageSize };
  }

  async get(kind: OrgKind, id: string) {
    const c = CONFIG[kind];
    const [row] = await this.baseQuery(kind).where(eq((c.table as any).id, id)).limit(1);
    if (!row) throw notFound(c.label);
    return this.flatten(row);
  }

  private async checkParent(kind: OrgKind, id: string | null, parentId: unknown) {
    if (!CONFIG[kind].hasParent || !parentId) return;
    if (parentId === id) throw badRequest('An item cannot be its own parent', { parentId: 'Cannot be its own parent' });
    if (!id) return;
    const table = kind === 'departments' ? 'departments' : 'locations';
    // Prevent cycles: the new parent must not be a descendant of this item.
    const result = await this.dbs.db.execute<{ found: boolean }>(sql`
      with recursive tree as (
        select id from ${sql.identifier(table)} where parent_id = ${id}
        union all
        select c.id from ${sql.identifier(table)} c join tree on c.parent_id = tree.id
      ) select exists(select 1 from tree where id = ${parentId}) as found`);
    if (result.rows[0]?.found) throw badRequest('That would create a loop', { parentId: 'Cannot move under its own child' });
  }

  async create(kind: OrgKind, actor: Actor, input: Record<string, unknown>) {
    const c = CONFIG[kind];
    await this.checkParent(kind, null, input.parentId);
    return this.dbs.tx(async (db) => {
      const [row] = (await db.insert(c.table as any).values(input).returning()) as Record<string, unknown>[];
      const r = row as { id: string; name: string };
      await this.history.record(actor, {
        entityType: c.entityType,
        entityId: r.id,
        entityLabel: r.name,
        action: 'CREATED',
        summary: `${c.label} "${r.name}" created`,
      });
      return row;
    });
  }

  async update(kind: OrgKind, actor: Actor, id: string, input: Record<string, unknown>) {
    const c = CONFIG[kind];
    const t = c.table as any;
    await this.checkParent(kind, id, input.parentId);
    return this.dbs.tx(async (db) => {
      const [before] = (await db.select().from(t).where(eq(t.id, id)).for('update')) as Record<string, unknown>[];
      if (!before) throw notFound(c.label);
      const changes = diffChanges(before as Record<string, unknown>, input, c.labels);
      if (!changes.length) return before;
      const [row] = await db.update(t).set({ ...input, updatedAt: new Date() }).where(eq(t.id, id)).returning();
      const r = row as { id: string; name: string };
      await this.history.record(actor, {
        entityType: c.entityType,
        entityId: id,
        entityLabel: r.name,
        action: 'UPDATED',
        summary: `${c.label} "${r.name}" updated`,
        changes,
      });
      if (kind !== 'companies' && changes.some((ch) => ch.field === 'name')) {
        await this.refreshHolderNames(kind, id, r.name);
      }
      return row;
    });
  }

  /** Keeps the denormalised holder name on assets in sync after a rename. */
  private async refreshHolderNames(kind: OrgKind, id: string, name: string) {
    const holderType = { departments: 'DEPARTMENT', locations: 'LOCATION', vendors: 'VENDOR' }[kind as 'departments'];
    if (!holderType) return;
    await this.dbs.db.execute(sql`
      update assets set holder_name = ${name}
      where holder_id = ${id} and holder_type in (${holderType}, ${kind === 'locations' ? 'INVENTORY' : holderType})`);
  }

  async remove(kind: OrgKind, actor: Actor, id: string) {
    const c = CONFIG[kind];
    const t = c.table as any;
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(t).where(eq(t.id, id));
      if (!before) throw notFound(c.label);
      const b = before as { name: string };
      await db.delete(t).where(eq(t.id, id));
      await this.history.record(actor, {
        entityType: c.entityType,
        entityId: id,
        entityLabel: b.name,
        action: 'DELETED',
        summary: `${c.label} "${b.name}" deleted`,
      });
      return { ok: true };
    });
  }
}
