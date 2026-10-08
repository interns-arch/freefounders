// What every Assets company starts with: system roles, the company itself, a main store, departments and the
// starter asset catalog. Used by the seed script (standalone install) and, in multi-company mode, when the
// FreeFounders Platform sets up a new company (POST /api/internal/companies).
import { SYSTEM_ROLES } from '@eam/shared';
import type { Actor } from '../common/actor';
import type { Executor } from '../db/db.service';
import { roles } from '../db/schema';
import type { CatalogService } from '../modules/catalog/catalog.service';
import type { OrgService } from '../modules/org/org.service';
import { CATALOG } from './catalog';

/** The starter asset catalog (categories, types, custom fields) — the same for demo and live installs. */
export async function loadCatalog(catalog: CatalogService, admin: Actor) {
  const types: Record<string, { id: string; trackingMode: string }> = {};
  for (const c of CATALOG) {
    const cat = await catalog.createCategory(admin, { name: c.name, code: c.code, icon: c.icon, color: c.color, description: c.description });
    for (const f of c.fields ?? []) {
      await catalog.createField(admin, { ...f, categoryId: cat.id, required: f.required ?? false, isUnique: f.isUnique ?? false, showInTable: f.showInTable ?? false, filterable: true, options: f.options ?? null });
    }
    for (const t of c.types) {
      const type = await catalog.createType(admin, { categoryId: cat.id, name: t.name, code: t.code, icon: t.icon, description: t.description ?? null, trackingMode: t.trackingMode ?? 'INDIVIDUAL', consumable: t.consumable ?? false });
      types[t.code] = { id: type.id, trackingMode: type.trackingMode };
      for (const f of t.fields ?? []) {
        await catalog.createField(admin, { ...f, assetTypeId: type.id, required: f.required ?? false, isUnique: f.isUnique ?? false, showInTable: f.showInTable ?? false, filterable: true, options: f.options ?? null });
      }
    }
  }
  return types;
}

export const DEPARTMENTS: [string, string][] = [
  ['IT and Data', 'ITD'],
  ['Inside and Field Sales', 'SAL'],
  ['Human Resources', 'HR'],
  ['Accounts and Finance', 'FIN'],
  ['IT Support', 'ITS'],
  ['Operations', 'OPS'],
  ['Warehouse', 'WH'],
];

/** Creates the system roles; returns their ids by name. */
export async function createSystemRoles(db: Executor): Promise<Record<string, string>> {
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const [row] = await db.insert(roles).values({ name: r.name, description: r.description, permissions: r.permissions, isSystem: true }).returning();
    roleIds[r.name] = row.id;
  }
  return roleIds;
}

/** The company, its main store, departments and the starter catalog. */
export async function setUpCompany(services: { org: OrgService; catalog: CatalogService }, actor: Actor, company: { name: string; code: string }) {
  const created = (await services.org.create('companies', actor, { name: company.name, code: company.code })) as { id: string };
  await services.org.create('locations', actor, { name: 'Main store', code: 'STORE', type: 'WAREHOUSE', isStore: true, companyId: created.id });
  for (const [name, deptCode] of DEPARTMENTS) await services.org.create('departments', actor, { name, code: deptCode, companyId: created.id });
  await loadCatalog(services.catalog, actor);
  return created;
}
