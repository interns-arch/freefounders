/** Task lists and the most common task changes, used by many Tasks screens (lists, home, groups, profiles). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { Task, TaskListParams, TaskStatus } from './types';

export const taskKeys = {
  all: ['tasks'] as const,
  list: (params: TaskListParams) => ['tasks', 'list', params] as const,
  detail: (id: number | string) => ['tasks', 'detail', String(id)] as const,
};

export function fetchTasks(params: TaskListParams = {}) {
  return tasksApi.get<DrfPage<Task> | Task[]>('/tasks/', { page_size: 200, ...params }).then(resultsOf);
}

/** GET /tasks/?scope=…&status=… (up to 200). */
export function useTaskList(params: TaskListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: taskKeys.list(params), queryFn: () => fetchTasks(params), enabled: options.enabled ?? true });
}

/** After any change to a task: every list, count and dashboard that shows tasks reloads. */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => ['tasks', 'task-completions', 'task-change-requests', 'groups', 'notifications'].includes(String(q.queryKey[0])) });
}

// ─── lookups every Tasks screen uses (cached) ────────────────────────────

const LOOKUP = { staleTime: 5 * 60_000 } as const;

export interface DepartmentOption {
  code: string;
  name: string;
  active: boolean;
}
export interface TaskCategory {
  id: number;
  name: string;
  department: string;
  active: boolean;
  pending?: boolean;
  task_count?: number;
}
export interface GroupBrief {
  id: number;
  name: string;
  description?: string;
  active?: boolean;
}

/** GET /departments/ — the department dropdown. */
export function useTaskDepartments() {
  return useQuery({ queryKey: ['tasks-lookup', 'departments'], queryFn: () => tasksApi.get<DepartmentOption[]>('/departments/'), ...LOOKUP });
}
/** GET /tasks/people/ — people this person can see work of (pickers and filters). */
export function useTaskPeople() {
  return useQuery({ queryKey: ['tasks-lookup', 'people'], queryFn: () => tasksApi.get<import('./types').PersonOption[]>('/tasks/people/'), ...LOOKUP });
}
/** GET /tasks/assignees/ — who this person may give a task to. */
export function useTaskAssignees() {
  return useQuery({ queryKey: ['tasks-lookup', 'assignees'], queryFn: () => tasksApi.get<import('./types').PersonOption[]>('/tasks/assignees/'), ...LOOKUP });
}
/** GET /leads/assignees/ — the whole team (used by groups, templates and settings; works with Leads switched off). */
export function useTeamPeople() {
  return useQuery({ queryKey: ['tasks-lookup', 'team-people'], queryFn: () => tasksApi.get<import('./types').PersonOption[]>('/leads/assignees/'), ...LOOKUP });
}
/** GET /task-categories/?department= */
export function useTaskCategories(department?: string) {
  return useQuery({
    queryKey: ['tasks-lookup', 'categories', department ?? ''],
    queryFn: () => tasksApi.get<DrfPage<TaskCategory> | TaskCategory[]>('/task-categories/', { department }).then(resultsOf),
    ...LOOKUP,
  });
}
/** GET /groups/?active=true */
export function useActiveGroups() {
  return useQuery({ queryKey: ['groups', 'active'], queryFn: () => tasksApi.get<DrfPage<GroupBrief> | GroupBrief[]>('/groups/', { active: 'true' }).then(resultsOf), ...LOOKUP });
}

/** PATCH /tasks/:id/ {status} — the status dropdown on a list row. */
export function useSetTaskStatus() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => tasksApi.patch<Task>(`/tasks/${id}/`, { status }),
    onSuccess: invalidate,
  });
}
