/**
 * Sub-tasks and the Task chain (original app 1dabd35; PLAN.md §19.41). Whoever holds a task gives parts of it to
 * other people, who may pass parts of their part on (5 levels). A part's completion goes to whoever gave it; the
 * task above can't be completed until every part is done and accepted. Admins and the Owner see the whole tree
 * (GET /tasks/:id/chain/) and every chain (GET /tasks/chains/, Tasks → Chains).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, tasksApi } from '../http';
import { useInvalidateTasks } from './tasks';
import type { PersonOption, TaskStatus } from './types';

/** How a task (or part) went: the same words the Excel report uses. */
export type ChainResult = 'On time' | 'Delayed' | 'Overdue' | 'In progress' | 'Pending' | 'Done (no due date)';

/** One task in a chain (also each row of a task's Sub-tasks list). */
export interface ChainNode {
  id: number;
  code: string;
  title: string;
  assigned_to: number;
  assignee: string;
  given_by: string;
  status: TaskStatus;
  status_display: string;
  result: ChainResult;
  days_late: number | null;
  due_at: string | null;
  completed_at: string | null;
  effort_minutes: number | null;
  actual_minutes: number | null;
  /** Latest completion review: "Pending" (waiting for the giver), "Approved", "Rejected", or null. */
  approval: string | null;
  deleted: boolean;
  /** In a Sub-tasks list: how many parts this part was split into. */
  parts_below?: number;
}

/** A node of the full tree (GET /tasks/:id/chain/). */
export interface ChainTreeNode extends ChainNode {
  level: number;
  /** Effort the holder kept after giving parts away (= effort when nothing was given). */
  own_effort_minutes: number | null;
  parts: ChainTreeNode[];
}

/** Where a task sits in its chain (part of GET /tasks/:id/). */
export interface TaskChainInfo {
  parent: { id: number; code: string; title: string; assignee: string; given_by: string; due_at: string | null; status_display: string } | null;
  root: { id: number; code: string; title: string } | null;
  level: number;
  max_depth: number;
  can_give_part: boolean;
  effort_given: number;
  effort_left: number | null;
  parts_total: number;
  parts_done: number;
  parts_open: number;
  parts_waiting: number;
  /** Why the task can't be completed yet (open parts / parts waiting to be accepted), or null. */
  blocked: string | null;
  can_view_chain: boolean;
}

export interface ChainSummary {
  parts: number;
  done: number;
  overdue: number;
  on_time: number;
  delayed: number;
  people: number;
  levels: number;
}

export interface TaskChain {
  tree: ChainTreeNode;
  summary: ChainSummary;
  /** The task the chain was opened from (highlighted). */
  focus: number;
}

export interface ChainRow extends ChainSummary {
  id: number;
  code: string;
  title: string;
  assignee: string;
  given_by: string;
  status: TaskStatus;
  status_display: string;
  result: ChainResult;
  due_at: string | null;
  completed_at: string | null;
}

export type ChainStatusFilter = 'open' | 'done' | 'all';

/** GET /tasks/:id/chain/ — the whole chain the task belongs to (admins / Owner). */
export function useTaskChain(id: number | null) {
  return useQuery({ queryKey: ['tasks', 'chain', String(id)], queryFn: () => tasksApi.get<TaskChain>(`/tasks/${id}/chain/`), enabled: !!id });
}

/** GET /tasks/chains/?status=open|done|all — every main task split into parts, overdue first (admins / Owner). */
export function useTaskChains(status: ChainStatusFilter) {
  return useQuery({ queryKey: ['tasks', 'chains', status], queryFn: () => tasksApi.get<{ rows: ChainRow[]; total: number }>('/tasks/chains/', { status }) });
}

/** GET /tasks/assignees/?part_of=<task> — who may get a part of this task (never its holder). */
export function usePartAssignees(taskId: number | null) {
  return useQuery({
    queryKey: ['tasks', 'part-assignees', String(taskId)],
    queryFn: () => tasksApi.get<PersonOption[]>('/tasks/assignees/', { part_of: taskId ?? undefined }),
    enabled: !!taskId,
    staleTime: 60_000,
  });
}

/** One part to give: who, what, by when, how much effort (minutes). */
export interface NewPart {
  assigned_to: number;
  title: string;
  description: string;
  due_at: string | null;
  effort_minutes: number | null;
}

/** The parts that could not be given, by their position in the list, with the server's reason. */
export interface GivePartsResult {
  given: number;
  failed: Array<{ index: number; error: unknown }>;
}

/** The server's reason for one failed part, as one sentence. */
export function partError(err: unknown): string {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const d = err.data as Record<string, unknown>;
    const first = d.detail ?? d.due_at ?? d.effort_minutes ?? d.assigned_to ?? d.parent ?? d.title ?? Object.values(d)[0];
    const text = Array.isArray(first) ? first.join(' ') : first;
    if (text) return String(text);
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

/**
 * POST /tasks/ once per part with `parent` (each person gets their own task; the parent's department, category and
 * priority carry over). Every part is tried; the ones the server refused come back with their reason.
 */
export function useGiveParts() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async ({ parent, parts }: { parent: { id: number; department?: string; category?: string; priority?: string }; parts: NewPart[] }): Promise<GivePartsResult> => {
      const failed: GivePartsResult['failed'] = [];
      let given = 0;
      for (const [index, p] of parts.entries()) {
        try {
          await tasksApi.post('/tasks/', {
            ...p,
            parent: parent.id,
            department: parent.department || '',
            category: parent.category || '',
            priority: parent.priority || 'normal',
          });
          given += 1;
        } catch (error) {
          failed.push({ index, error });
        }
      }
      return { given, failed };
    },
    onSettled: () => invalidate(),
  });
}
