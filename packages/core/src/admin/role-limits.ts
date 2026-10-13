/**
 * What the signed-in person may give when building or giving roles (docs/security/platform.md R1), for the role editor
 * and the roles dialog. The Platform checks the same rules (403 otherwise): the owner may give everything; anyone else
 * only permissions they hold (at no wider scope), never an Owner-only one, never an Admin-level role, and no role above
 * their own level.
 */
import type { PlatformMe } from '../access';
import { type AppCatalogue, type CataloguePermission, type GrantApp, LEVEL_LABELS, type Role } from './types';

/** When the catalogue is not loaded: the usual order of scopes, narrowest first. */
const SCOPE_ORDER = ['own', 'team', 'department', 'company'];

export interface RoleLimits {
  /** The owner: no limits. */
  unlimited: boolean;
  /** Highest level of the person's roles (at least 1). */
  level: number;
  /** Why this permission cannot be ticked, or null. */
  permissionProblem(app: GrantApp, p: CataloguePermission): string | null;
  /** Whether this scope is within what the person holds for the permission. */
  scopeAllowed(app: GrantApp, p: CataloguePermission, scope: string): boolean;
  /** Whether a role at this level may be built (edit) or given. */
  levelAllowed(level: number, purpose: 'edit' | 'give'): boolean;
  /** Why this role cannot be edited/archived/duplicated (edit) or given to someone (give), or null. */
  roleProblem(role: Role, purpose: 'edit' | 'give'): string | null;
}

export const NOT_HELD_HINT = "You don't have this yourself";

export function roleLimits(me: PlatformMe | undefined, catalogue: AppCatalogue[] = []): RoleLimits {
  const unlimited = me?.person.role === 'owner';
  const level = me?.held?.level ?? 1;
  const held = new Map<string, string[]>();
  for (const g of me?.held?.grants ?? []) held.set(`${g.app}:${g.permission}`, [...(held.get(`${g.app}:${g.permission}`) ?? []), g.scope]);
  const order = (app: string, key: string) => catalogue.find((c) => c.app === app)?.permissions.find((p) => p.key === key)?.scopes ?? SCOPE_ORDER;
  const widest = (app: string, key: string) => Math.max(-1, ...(held.get(`${app}:${key}`) ?? []).map((s) => (order(app, key) as string[]).indexOf(s)));

  const scopeAllowed = (app: string, key: string, scope: string) => {
    if (unlimited || !scope) return true;
    return (order(app, key) as string[]).indexOf(scope) <= widest(app, key);
  };
  const permissionProblem = (app: string, key: string, superAdminOnly?: boolean) => {
    if (unlimited) return null;
    if (superAdminOnly) return 'Only the owner can give this';
    return held.has(`${app}:${key}`) ? null : NOT_HELD_HINT;
  };
  const levelAllowed = (l: number, purpose: 'edit' | 'give') => unlimited || ((purpose === 'give' || l < 3) && l <= level);

  return {
    unlimited,
    level,
    permissionProblem: (app, p) => permissionProblem(app, p.key, p.superAdminOnly),
    scopeAllowed: (app, p, scope) => scopeAllowed(app, p.key, scope),
    levelAllowed,
    roleProblem(role, purpose) {
      if (unlimited) return null;
      if (role.system) return 'Only the owner can give or copy Super Admin';
      if (purpose === 'edit' && role.level >= 3) return 'Admin-level: only the owner can change it';
      if (role.level > level) return `${LEVEL_LABELS[role.level] ?? role.level} level, above your own (${LEVEL_LABELS[level] ?? level})`;
      const superOnly = (g: Role['grants'][number]) => !!catalogue.find((c) => c.app === g.app)?.permissions.find((p) => p.key === g.permission)?.superAdminOnly;
      const beyond = role.grants.some((g) => permissionProblem(g.app, g.permission, superOnly(g)) || !scopeAllowed(g.app, g.permission, g.scope));
      return beyond ? 'Has permissions you don’t have yourself' : null;
    },
  };
}
