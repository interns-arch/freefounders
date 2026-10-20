/** Task settings (old pages/Settings.jsx): completion evidence, categories, lead assignment rules, notification rules. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { UserBrief } from './types';

export interface TaskSettings {
  require_completion_remarks: boolean;
  require_completion_attachment: boolean;
  updated_at: string;
}

export function useTaskSettings() {
  return useQuery({ queryKey: ['tasks-settings', 'task'], queryFn: () => tasksApi.get<TaskSettings>('/task-settings/') });
}

/** POST /task-settings/ {key: value} */
export function useSetTaskSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<TaskSettings, 'require_completion_attachment' | 'require_completion_remarks'>>) => tasksApi.post<TaskSettings>('/task-settings/', body),
    onSuccess: (data) => qc.setQueryData(['tasks-settings', 'task'], data),
  });
}

// ─── categories ──────────────────────────────────────────────────────────

export interface ManagedCategory {
  id: number;
  name: string;
  department: string;
  department_display: string;
  active: boolean;
  pending: boolean;
  requested_by_name: string | null;
  task_count?: number;
}

/** GET /task-categories/?counts=true and ?pending=true */
export function useCategoryAdmin() {
  const list = useQuery({
    queryKey: ['tasks-lookup', 'categories-admin', 'counts'],
    queryFn: () => tasksApi.get<DrfPage<ManagedCategory> | ManagedCategory[]>('/task-categories/', { counts: 'true' }).then(resultsOf),
  });
  const pending = useQuery({
    queryKey: ['tasks-lookup', 'categories-admin', 'pending'],
    queryFn: () => tasksApi.get<DrfPage<ManagedCategory> | ManagedCategory[]>('/task-categories/', { pending: 'true' }).then(resultsOf),
  });
  return { list, pending };
}

function useInvalidateCategories() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['tasks-lookup'] });
}

export function useAddTaskCategory() {
  const done = useInvalidateCategories();
  return useMutation({ mutationFn: (body: { name: string; department: string }) => tasksApi.post('/task-categories/', body), onSuccess: done });
}
export function useRemoveTaskCategory() {
  const done = useInvalidateCategories();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/task-categories/${id}/`), onSuccess: done });
}
/** POST /task-categories/:id/approve|reject/ {remarks} */
export function useDecideTaskCategory() {
  const done = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, verdict, remarks }: { id: number; verdict: 'approve' | 'reject'; remarks: string }) => tasksApi.post(`/task-categories/${id}/${verdict}/`, { remarks }),
    onSuccess: done,
  });
}

// ─── lead assignment rules (module leads) ───────────────────────────────

export interface AssignmentRule {
  id: number;
  department: string;
  department_display: string;
  strategy: 'round_robin' | 'fixed';
  member_ids: number[];
  members_detail: UserBrief[];
  rr_index: number;
  active: boolean;
  updated_at: string;
}

export function useAssignmentRules(enabled: boolean) {
  return useQuery({
    queryKey: ['tasks-settings', 'assignment-rules'],
    queryFn: () => tasksApi.get<DrfPage<AssignmentRule> | AssignmentRule[]>('/assignment-rules/').then(resultsOf),
    enabled,
  });
}

/** PATCH the department's rule, or create it (round robin, active) when there is none yet. */
export function useSaveAssignmentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rule, department, body }: { rule?: AssignmentRule; department: string; body: Partial<Pick<AssignmentRule, 'strategy' | 'member_ids' | 'active'>> }) =>
      rule
        ? tasksApi.patch(`/assignment-rules/${rule.id}/`, body)
        : tasksApi.post('/assignment-rules/', { department, strategy: 'round_robin', member_ids: [], active: true, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks-settings', 'assignment-rules'] }),
  });
}

// ─── notification rules (PLAN.md §16.5) ─────────────────────────────────

export interface NotificationRule {
  key: string;
  label: string;
  email: boolean;
  whatsapp: boolean;
}

export function useNotificationRules() {
  return useQuery({ queryKey: ['tasks-settings', 'notification-rules'], queryFn: () => tasksApi.get<NotificationRule[]>('/notification-rules/') });
}

/** The company's WhatsApp sending hours (local, whole hours; default 10–19). Outside them a WhatsApp waits for the opening. */
export interface WhatsappHours {
  start: number;
  end: number;
}

export function useWhatsappHours() {
  return useQuery({ queryKey: ['tasks-settings', 'whatsapp-hours'], queryFn: () => tasksApi.get<WhatsappHours>('/whatsapp-hours/') });
}

/** PUT /whatsapp-hours/ {start, end} */
export function useSetWhatsappHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (h: WhatsappHours) => tasksApi.put<WhatsappHours>('/whatsapp-hours/', h),
    onSuccess: (h) => qc.setQueryData(['tasks-settings', 'whatsapp-hours'], h),
  });
}

/** PUT /notification-rules/ {key: {email|whatsapp: on}} — answers with the whole list. */
export function useSetNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, channel, on }: { key: string; channel: 'email' | 'whatsapp'; on: boolean }) =>
      tasksApi.put<NotificationRule[]>('/notification-rules/', { [key]: { [channel]: on } }),
    onSuccess: (rows) => qc.setQueryData(['tasks-settings', 'notification-rules'], rows),
  });
}
