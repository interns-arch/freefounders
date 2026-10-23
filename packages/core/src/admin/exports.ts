/** Downloads for the Admin screens (PLAN.md §19.31). */
import type { ExportTarget, SheetCell, SheetData } from '../export';
import { type AppCatalogue, GRANT_APP_NAMES, LEVEL_LABELS, type Role, SCOPE_LABELS, type Scope } from './types';

export const adminExports = {
  /** People & access: everyone matching the search (GET /people?export=xlsx|csv). */
  people: (search = ''): ExportTarget => ({ api: 'platform', path: '/people', query: { search: search || undefined } }),
};

/**
 * Roles × permissions (built from the roles and the catalogue the Roles screen already holds in full): first the
 * role facts (level, people, built in), then one row per permission with each role's scope ("Company", "Own"…) or
 * "Yes" for a permission without scopes; blank = not given.
 */
export function rolesMatrixSheet(roles: Role[], catalogue: AppCatalogue[]): SheetData {
  const header = ['App', 'Group', 'Permission', 'Key', ...roles.map((r) => r.name)];
  const facts: SheetCell[][] = [
    ['', '', 'Level', '', ...roles.map((r) => LEVEL_LABELS[r.level] ?? String(r.level))],
    ['', '', 'People', '', ...roles.map((r) => r.people)],
    ['', '', 'Built in', '', ...roles.map((r) => (r.system ? 'Yes' : 'No'))],
    ['', '', 'Description', '', ...roles.map((r) => r.description ?? '')],
  ];
  const rows: SheetCell[][] = [];
  for (const app of catalogue) {
    for (const p of app.permissions) {
      rows.push([
        GRANT_APP_NAMES[app.app] ?? app.app,
        p.group,
        p.label,
        p.key,
        ...roles.map((r) => {
          const g = r.grants.find((x) => x.app === app.app && x.permission === p.key);
          if (!g) return '';
          return p.scopes && p.scopes.length ? (SCOPE_LABELS[g.scope as Scope] ?? g.scope) : 'Yes';
        }),
      ]);
    }
  }
  return { title: 'Roles and permissions', header, rows: [...facts, ...rows] };
}
