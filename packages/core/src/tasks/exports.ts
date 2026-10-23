/**
 * Downloads for the Tasks screens (PLAN.md §19.31). Each target is the list hook's own path and query (the same
 * builder functions below feed both), so the file has exactly the rows the screen's filters match — all of them,
 * not one page. The API answers `?export=xlsx|csv`.
 */
import type { ExportTarget } from '../export';
import type { Query } from '../http';
import type { ActivityFilters, WorkListParams } from './workspace';
import type { LeadFilters } from './extras-leads';
import type { IntakeChannel, IntakeStatus } from './extras-intake';
import type { MistakeFilters } from './extras-mistakes';
import type { LinkFilters } from './extras-links';

/** GET /tasks/ filters (My / All / Delegated / Subscribed / Deleted). */
export function workListQuery(params: WorkListParams): Query {
  return {
    scope: params.scope,
    status: params.status,
    overdue: params.overdue ? 'true' : undefined,
    done: params.done,
    recurring: params.recurring ? 'true' : undefined,
    range: params.range,
    start: params.start,
    end: params.end,
    assigned_to: params.assigned_to,
    department: params.department,
    search: params.search,
  };
}

export function leadsQuery(filters: LeadFilters = {}): Query {
  return {
    search: filters.search?.trim() || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    source: filters.source || undefined,
    assigned_to: filters.assigned_to || undefined,
    department: filters.department || undefined,
    overdue: filters.overdue ? 'true' : undefined,
  };
}

export function mistakesQuery(filters: MistakeFilters = {}): Query {
  return {
    status: filters.status || undefined,
    severity: filters.severity || undefined,
    important: filters.important ? 'true' : undefined,
    employee: filters.employee || undefined,
    category: filters.category || undefined,
  };
}

export function linksQuery(filters: LinkFilters = {}): Query {
  return {
    search: filters.search?.trim() || undefined,
    collection: filters.collection || undefined,
    favorites: filters.favorites ? 'true' : undefined,
  };
}

const t = (path: string, query?: Query): ExportTarget => ({ api: 'tasks', path, query });

export const tasksExports = {
  tasks: (params: WorkListParams) => t('/tasks/', workListQuery(params)),
  reviews: (scope: 'inbox' | 'mine' | 'all', submittedBy?: string | number) => t('/task-completions/', { scope, submitted_by: submittedBy || undefined }),
  requests: (scope: 'inbox' | 'mine' | 'all') => t('/task-change-requests/', { scope }),
  activities: (f: ActivityFilters) => t('/task-activities/', { days: f.days, assigned_to: f.assigned_to, search: f.search, actor: f.actor }),
  templates: () => t('/task-templates/'),
  groups: () => t('/groups/'),
  notices: (params: { read?: '' | 'true' | 'false'; search?: string } = {}) =>
    t('/notices/', { read: params.read || undefined, search: params.search?.trim() || undefined }),
  managedNotices: () => t('/notices/', { manage: 'true' }),
  notifications: () => t('/notifications/'),
  leads: (filters: LeadFilters = {}) => t('/leads/', leadsQuery(filters)),
  intake: (filters: { channel?: IntakeChannel | ''; status?: IntakeStatus | '' } = {}) =>
    t('/intake/', { channel: filters.channel || undefined, status: filters.status || undefined }),
  mistakes: (filters: MistakeFilters = {}) => t('/mistakes/', mistakesQuery(filters)),
  sops: (params: { search?: string; all?: boolean } = {}) => t('/sops/', { search: params.search?.trim() || undefined, all: params.all ? 'true' : undefined }),
  links: (filters: LinkFilters = {}) => t('/links/', linksQuery(filters)),
};
