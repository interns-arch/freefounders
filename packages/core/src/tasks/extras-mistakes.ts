/**
 * Mistake register and SOPs (old pages/Mistakes.jsx): /mistakes/, /mistake-categories/, /sops/ in the Tasks API
 * (backend/mistakes). Catalogues (severities, root causes, classifications, level-3 actions) mirror mistakes/models.py.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import { mistakesQuery } from './exports';
import type { UserBrief } from './types';

export type MistakeSeverity = 'low' | 'medium' | 'high' | 'critical';
export type MistakeStatus = 'open' | 'explained' | 'resolved';
export type MistakeClassification = 'human' | 'process' | 'system' | 'management' | 'external';

/** [value, label, what it means]. */
export const MISTAKE_SEVERITIES: Array<[MistakeSeverity, string, string]> = [
  ['low', 'Low', 'Minor mistake, negligible impact'],
  ['medium', 'Medium', 'Rework / customer delay / internal impact'],
  ['high', 'High', 'Significant financial or customer impact'],
  ['critical', 'Critical', 'Major loss, compliance issue, fraud risk'],
];
export const MISTAKE_STATUS_LABELS: Record<MistakeStatus, string> = { open: 'Open', explained: 'Explained', resolved: 'Resolved' };
export const MISTAKE_ROOT_CAUSES: Array<[string, string]> = [
  ['lack_of_training', 'Lack of training'],
  ['lack_of_attention', 'Lack of attention'],
  ['sop_not_followed', 'SOP not followed'],
  ['sop_missing', 'SOP missing'],
  ['sop_unclear', 'SOP unclear'],
  ['wrong_information', 'Wrong information provided'],
  ['communication_failure', 'Communication failure'],
  ['system_issue', 'System issue'],
  ['data_issue', 'Data issue'],
  ['workload_issue', 'Workload issue'],
  ['time_pressure', 'Time pressure'],
  ['approval_failure', 'Approval failure'],
  ['human_error', 'Human error'],
  ['managerial_failure', 'Managerial failure'],
  ['vendor_issue', 'Vendor issue'],
  ['customer_issue', 'Customer issue'],
  ['other', 'Other'],
];
export const MISTAKE_CLASSIFICATIONS: Array<[MistakeClassification, string]> = [
  ['human', 'Human mistake'],
  ['process', 'Process / SOP failure'],
  ['system', 'Software / system failure'],
  ['management', 'Management / training failure'],
  ['external', 'External failure'],
];
export const MISTAKE_LEVEL3_ACTIONS: Array<[string, string]> = [
  ['coaching', 'Coaching'],
  ['retraining', 'Retraining'],
  ['written_warning', 'Written warning'],
  ['pip', 'Performance Improvement Plan'],
  ['role_reassignment', 'Role reassignment'],
  ['additional_approval', 'Additional approval requirement'],
  ['process_change', 'Process change'],
  ['permission_suspension', 'Suspension of certain permissions'],
  ['other', 'Other HR-approved action'],
];

export interface Mistake {
  id: number;
  code: string;
  employee: number;
  employee_detail: UserBrief | null;
  department: string;
  manager: number | null;
  manager_detail: UserBrief | null;
  reported_by_detail: UserBrief | null;
  category: string;
  severity: MistakeSeverity;
  severity_display: string;
  classification: MistakeClassification | '';
  classification_display: string;
  description: string;
  impact: string;
  financial_loss: string | null;
  task: number | null;
  task_code: string | null;
  lead: number | null;
  occurrence_level: number;
  repeat_of: number | null;
  repeat_of_code: string | null;
  explanation: string;
  root_cause: string;
  root_cause_display: string;
  root_cause_note: string;
  corrective_action: string;
  preventive_action: string;
  sop_name: string;
  sop_version: string;
  sop_step: string;
  sop_followed: boolean | null;
  sop_adequate: boolean | null;
  status: MistakeStatus;
  status_display: string;
  manager_remarks: string;
  level3_action: string;
  level3_action_display: string;
  level3_action_note: string;
  sla_due_at: string | null;
  sla_overdue: boolean;
  escalation_level: number;
  corrective_task: number | null;
  corrective_task_code: string | null;
  corrective_task_status: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /mistakes/:id/ adds the unconfirmed repeat candidates for reviewers. */
export interface MistakeDetail extends Mistake {
  possible_repeats?: Array<{ id: number; code: string; description: string; occurrence_level: number; created_at: string }>;
}

export interface MistakeEvent {
  id: number;
  actor: UserBrief | null;
  text: string;
  created_at: string;
}

export interface MistakeCategory {
  id: number;
  name: string;
  active: boolean;
}

export interface MistakeFilters {
  status?: MistakeStatus | '';
  severity?: MistakeSeverity | '';
  /** 'true': critical / escalated / overdue / third occurrences only (the founder view). */
  important?: boolean;
  employee?: number | '';
  category?: string;
}

export interface MistakeInput {
  employee: number;
  category: string;
  severity: MistakeSeverity;
  description: string;
  impact: string;
  financial_loss: number | null;
  sop_name: string;
}

export interface MistakeExplainInput {
  explanation: string;
  root_cause: string;
  root_cause_note: string;
  corrective_action: string;
  preventive_action: string;
}

export interface MistakeReviewInput {
  classification?: MistakeClassification | '';
  severity?: MistakeSeverity;
  manager_remarks?: string;
  sop_name?: string;
  sop_version?: string;
  sop_step?: string;
  sop_followed?: boolean | null;
  sop_adequate?: boolean | null;
  level3_action?: string;
  level3_action_note?: string;
  resolve: boolean;
}

export interface MistakeFounderSummary {
  critical_open: number;
  sla_missed: number;
  escalated_to_founder: number;
  level3_open: number;
  loss_this_month: number | string;
  open_total: number;
}

export interface MistakePatterns {
  categories?: Array<{ category: string; process_suspect: boolean; message: string; financial_loss?: number | string }>;
  repeat_offenders?: Array<{ name: string; count: number; category: string }>;
}

export interface MistakeDepartmentScores {
  formula?: string;
  rows: Array<{
    department: string;
    label: string;
    score: number;
    mistakes: number;
    repeats: number;
    sla_compliance: number | null;
    financial_loss: number | string | null;
    improvement_pct: number | null;
    breakdown: { repeat_penalty: number; sla_penalty: number; loss_penalty: number; improvement_bonus: number };
  }>;
}

export interface MistakeSuggestion {
  classification?: MistakeClassification;
  reasoning?: string;
  corrective_action?: string;
  preventive_action?: string;
  provider?: string;
}

/** GET /mistakes/?status=&severity=&important= — what this person may see (own / department / all). */
export function useMistakes(filters: MistakeFilters = {}) {
  const q = { ...mistakesQuery(filters), page_size: 100 };
  return useQuery({ queryKey: ['mistakes', 'list', q], queryFn: async () => resultsOf(await tasksApi.get<DrfPage<Mistake> | Mistake[]>('/mistakes/', q)) });
}

export function useMistakeDetail(id: number | null) {
  return useQuery({ queryKey: ['mistakes', 'detail', id], queryFn: () => tasksApi.get<MistakeDetail>(`/mistakes/${id}/`), enabled: id != null });
}

export function useMistakeEvents(id: number | null) {
  return useQuery({ queryKey: ['mistakes', 'events', id], queryFn: () => tasksApi.get<MistakeEvent[]>(`/mistakes/${id}/events/`), enabled: id != null });
}

export function useMistakeCategories() {
  return useQuery({ queryKey: ['mistakes', 'categories'], queryFn: () => tasksApi.get<MistakeCategory[]>('/mistake-categories/'), staleTime: 60_000 });
}

/** The founder's "action required" card (tasks.view_all). */
export function useMistakeFounderSummary(enabled: boolean) {
  return useQuery({ queryKey: ['mistakes', 'founder-summary'], queryFn: () => tasksApi.get<MistakeFounderSummary>('/mistakes/founder_summary/'), enabled });
}

/** Process smells and repeat offenders over `days` (managers and admin). */
export function useMistakePatterns(enabled: boolean, days = 90) {
  return useQuery({ queryKey: ['mistakes', 'patterns', days], queryFn: () => tasksApi.get<MistakePatterns>('/mistakes/patterns/', { days }), enabled });
}

/** Department accountability scores for a range (managers and admin). */
export function useMistakeDepartmentScores(enabled: boolean, range = 'this_month') {
  return useQuery({ queryKey: ['mistakes', 'department-scores', range], queryFn: () => tasksApi.get<MistakeDepartmentScores>('/mistakes/department_scores/', { range }), enabled });
}

function useInvalidateMistakes() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['mistakes'] });
    void qc.invalidateQueries({ queryKey: ['tasks', 'home'] }); // the dashboard's "my open mistakes"
  };
}

/** POST /mistakes/ — log one (for yourself, or for someone else with tasks.assign). */
export function useLogMistake() {
  const done = useInvalidateMistakes();
  return useMutation({ mutationFn: (body: MistakeInput) => tasksApi.post<Mistake>('/mistakes/', body), onSuccess: done });
}

/** POST /mistakes/:id/explain/ — the employee's response. */
export function useExplainMistake() {
  const done = useInvalidateMistakes();
  return useMutation({ mutationFn: ({ id, ...body }: MistakeExplainInput & { id: number }) => tasksApi.post<Mistake>(`/mistakes/${id}/explain/`, body), onSuccess: done });
}

/** POST /mistakes/:id/confirm_repeat/ — "same error" (with the earlier one) or "different error". */
export function useConfirmRepeat() {
  const done = useInvalidateMistakes();
  return useMutation({
    mutationFn: ({ id, repeat_of }: { id: number; repeat_of: number | null }) =>
      tasksApi.post<Mistake>(`/mistakes/${id}/confirm_repeat/`, repeat_of ? { same: true, repeat_of } : { same: false }),
    onSuccess: done,
  });
}

/** POST /mistakes/:id/review/ — the manager's decision; `resolve: true` closes it. */
export function useReviewMistake() {
  const done = useInvalidateMistakes();
  return useMutation({ mutationFn: ({ id, ...body }: MistakeReviewInput & { id: number }) => tasksApi.post<Mistake>(`/mistakes/${id}/review/`, body), onSuccess: done });
}

/** POST /mistakes/:id/create_task/ — the corrective task (replaces an untouched auto-created one). */
export function useCreateCorrectiveTask() {
  const done = useInvalidateMistakes();
  return useMutation({
    mutationFn: ({ id, title, due_days = 1, assigned_to }: { id: number; title: string; due_days?: number; assigned_to?: number }) =>
      tasksApi.post<Mistake>(`/mistakes/${id}/create_task/`, { title, due_days, assigned_to }),
    onSuccess: done,
  });
}

/** POST /mistakes/:id/ai_suggest/ — a classification + CAPA the reviewer may use (never applied by itself). */
export function useMistakeSuggestion() {
  return useMutation({ mutationFn: (id: number) => tasksApi.post<MistakeSuggestion>(`/mistakes/${id}/ai_suggest/`) });
}

/** POST /mistake-categories/ — settings.manage. */
export function useAddMistakeCategory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => tasksApi.post<MistakeCategory>('/mistake-categories/', { name }), onSuccess: () => qc.invalidateQueries({ queryKey: ['mistakes', 'categories'] }) });
}

// ─── SOPs (the written processes) ─────────────────────────────────────────

export interface Sop {
  id: number;
  title: string;
  department: string;
  department_display: string;
  category: string;
  version: string;
  /** One step per line. */
  steps: string;
  checks: string;
  common_errors: string;
  active: boolean;
  owner: number | null;
  owner_name: string | null;
  step_count: number;
  mistake_count: number;
  created_at: string;
  updated_at: string;
}

export interface SopInput {
  title: string;
  department: string;
  category: string;
  version: string;
  steps: string;
  checks: string;
  common_errors: string;
}

/** GET /sops/ — current versions; `all` includes retired ones. Everyone may read. */
export function useSops(params: { search?: string; all?: boolean } = {}) {
  const q = { search: params.search?.trim() || undefined, all: params.all ? 'true' : undefined };
  return useQuery({ queryKey: ['sops', q], queryFn: () => tasksApi.get<Sop[]>('/sops/', q) });
}

function useInvalidateSops() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['sops'] });
    void qc.invalidateQueries({ queryKey: ['mistakes'] });
  };
}

/** POST /sops/, PATCH /sops/:id/, or POST /sops/:id/new_version/ (keeps the old version, retired). tasks.assign. */
export function useSaveSop() {
  const done = useInvalidateSops();
  return useMutation({
    mutationFn: ({ id, asNewVersion, ...body }: SopInput & { id?: number; asNewVersion?: boolean }) =>
      id && asNewVersion ? tasksApi.post<Sop>(`/sops/${id}/new_version/`, body) : id ? tasksApi.patch<Sop>(`/sops/${id}/`, body) : tasksApi.post<Sop>('/sops/', body),
    onSuccess: done,
  });
}

/** DELETE /sops/:id/ — retires it (old mistakes still cite it). */
export function useRetireSop() {
  const done = useInvalidateSops();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/sops/${id}/`), onSuccess: done });
}
