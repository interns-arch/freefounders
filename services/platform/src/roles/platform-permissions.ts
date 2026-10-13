import { and, eq, max } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { personRoles, type PlatformRole, roleGrants, roles } from '../db/schema';
import type { AppCatalogue } from '../provision/provision.client';

/**
 * The Admin workspace as permissions (PLAN.md §19.19): the role builder shows them as a third "app", Admin. An owner
 * always has every one (a company can never lock itself out); the `admin` access level keeps them all as before; a
 * member gets exactly the ones their roles grant.
 */
export const PLATFORM_APP = 'platform';

export const PLATFORM_PERMISSIONS = ['people.manage', 'people.passwords', 'people.exit', 'people.delete', 'roles.manage', 'company.settings'] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/** Who may open People & access: any people power, or giving roles to people. */
export const PEOPLE_SCREEN: PlatformPermission[] = ['people.manage', 'people.passwords', 'people.exit', 'people.delete', 'roles.manage'];

export const PLATFORM_CATALOGUE: AppCatalogue = {
  app: PLATFORM_APP,
  scopes: [],
  version: 1,
  permissions: [
    { key: 'people.manage', label: 'Manage people', group: 'People', scopes: null, description: 'Add people, edit their details, department and manager, switch them off or on.' },
    { key: 'people.passwords', label: 'Reset passwords', group: 'People', scopes: null, description: 'Set or generate a new password, create or remove a login.' },
    { key: 'people.exit', label: 'Start exits', group: 'People', scopes: null, description: "Start someone's exit: the Assets exit case and the Tasks checklist." },
    { key: 'people.delete', label: 'Delete people permanently', group: 'People', scopes: null, description: 'Erase a person and hand over or remove their work. Cannot be undone.' },
    { key: 'roles.manage', label: 'Manage roles', group: 'Roles & company', scopes: null, description: 'Create, edit and archive roles and give them to people, with only the permissions and level they have themselves (the Owner: everything).' },
    { key: 'company.settings', label: 'Company settings', group: 'Roles & company', scopes: null, description: 'Company name, colour, logo, departments and which modules are on.' },
  ],
};

/** The Admin permissions a person has right now (read from the database, so a change counts at once). */
export async function platformPermissionsOf(dbs: DbService, personId: string, role: PlatformRole | string): Promise<Set<PlatformPermission>> {
  if (role === 'owner' || role === 'admin') return new Set(PLATFORM_PERMISSIONS);
  const rows = await dbs.db
    .selectDistinct({ permission: roleGrants.permission })
    .from(personRoles)
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .innerJoin(roleGrants, eq(roleGrants.roleId, roles.id))
    .where(and(eq(personRoles.personId, personId), eq(roles.archived, false), eq(roleGrants.app, PLATFORM_APP)));
  return new Set(rows.map((r) => r.permission).filter((p): p is PlatformPermission => (PLATFORM_PERMISSIONS as readonly string[]).includes(p)));
}

/**
 * Everything a person holds through their roles (docs/security/platform.md R1): each app permission with every scope a
 * role gives it, the Admin permissions (all of them for owners and admins), and their highest role level (at least 1).
 * Someone with Manage roles may give only what is in here; the owner is never limited by it.
 */
export async function heldAccess(dbs: DbService, personId: string, role: PlatformRole | string): Promise<{ level: number; grants: Array<{ app: string; permission: string; scope: string }> }> {
  const where = and(eq(personRoles.personId, personId), eq(roles.archived, false));
  const rows = await dbs.db
    .selectDistinct({ app: roleGrants.app, permission: roleGrants.permission, scope: roleGrants.scope })
    .from(personRoles)
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .innerJoin(roleGrants, eq(roleGrants.roleId, roles.id))
    .where(where);
  const [top] = await dbs.db.select({ level: max(roles.level) }).from(personRoles).innerJoin(roles, eq(roles.id, personRoles.roleId)).where(where);
  const platform = [...(await platformPermissionsOf(dbs, personId, role))].map((permission) => ({ app: PLATFORM_APP, permission, scope: '' }));
  return { level: Math.max(1, top?.level ?? 1), grants: [...rows.filter((r) => r.app !== PLATFORM_APP), ...platform] };
}
