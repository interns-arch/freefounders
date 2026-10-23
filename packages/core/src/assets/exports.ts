/**
 * Downloads (PLAN.md §19.31): what each Assets list screen downloads. Same path and the same query transform as the
 * list hook, so the file has every row the list would show page after page (filters, search, sort, tab).
 */
import type { Query } from '../http';
import type { ExportTarget } from '../export';
import type { OrgPath } from './org';

const t = (path: string, query: Query): ExportTarget => ({ api: 'assets', path, query });
const statusAll = (f: Query): Query => ({ ...f, status: f.status === 'ALL' ? '' : f.status });

export const assetsExports = {
  assets: (filters: Query) => t('/assets', filters),
  employees: (filters: Query) => t('/employees', filters),
  exits: (filters: Query) => t('/exit-cases', filters),
  onboarding: (filters: Query) => t('/onboarding', { ...filters, view: undefined }),
  requests: (filters: Query) => t('/requests', { ...statusAll(filters), open: undefined }),
  tickets: (filters: Query) => t('/tickets', { ...statusAll(filters), open: undefined }),
  maintenance: (filters: Query) => t('/maintenance', statusAll(filters)),
  activity: (filters: Query) => t('/history', filters),
  users: (filters: Query) => t('/users', filters),
  org: (path: OrgPath, filters: Query) => t(`/${path}`, filters),
};
