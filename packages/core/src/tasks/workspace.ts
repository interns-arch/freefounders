// Task workspace hooks (task lists and tabs, task detail, reviews, change requests, templates, directory,
// activities, reports). Owned by the Task workspace screens; see PLAN.md §18.5.
// Every query key starts with 'tasks', 'task-completions' or 'task-change-requests' so useInvalidateTasks() reloads it.
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type DrfPage, type Query, resultsOf, tasksApi } from '../http';
import type { ChainNode, TaskChainInfo } from './chain';
import { workListQuery } from './exports';
import { type TaskCategory, useInvalidateTasks } from './tasks';
import type { Task, TaskFrequency, TaskPriority, TaskScope, UserBrief } from './types';

const NO_PLACEHOLDER = { placeholderData: undefined } as const;
const STATIC = { staleTime: 5 * 60_000 } as const;

// ─── types ─────────────────────────────────────────────────────────────────

/** A task row as the API sends it. `category` is the category NAME (a string), not an id. */
export type WorkTask = Omit<Task, 'category'> & { category: string };

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
  order: number;
  note: string;
  done_by_name: string | null;
  done_at: string | null;
  due_at: string | null;
}

export interface DayLogEntry {
  id: number;
  date: string;
  did: string;
  plan_tomorrow: string;
  percent_done: number | null;
  minutes_spent: number | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DayLogDay {
  date: string;
  label: string;
  is_today: boolean;
  is_future: boolean;
  is_weekend: boolean;
  entry: DayLogEntry | null;
}

export interface DayLog {
  start: string;
  end: string;
  today: string;
  can_write: boolean;
  backfill_days: number;
  days: DayLogDay[];
  logged_days: number;
  missed_days: number;
  logged_minutes: number;
}

/** GET /tasks/:id/ — the task with its steps, sub-tasks (parts given to others), its place in a chain and daily log. */
export interface TaskDetail extends WorkTask {
  checklist: ChecklistItem[];
  subtasks: ChainNode[];
  chain: TaskChainInfo;
  day_log: DayLog;
}

export interface TaskActivityItem {
  id: number;
  task: number | null;
  task_title: string | null;
  task_code: string | null;
  task_assignee: string | null;
  actor: UserBrief | null;
  text: string;
  kind: string;
  created_at: string;
}

export interface TaskFile {
  id: number;
  filename: string;
  url: string | null;
  uploaded_by: UserBrief | null;
  created_at: string;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface TaskCompletion {
  id: number;
  task: number;
  task_code: string;
  task_title: string;
  task_due_at: string | null;
  task_effort_minutes: number | null;
  task_actual_minutes: number | null;
  submitted_by: UserBrief | null;
  note: string;
  status: ReviewStatus;
  status_display: string;
  remarks: string;
  reviewed_by: UserBrief | null;
  reviewed_at: string | null;
  created_at: string;
  files: TaskFile[];
  /** Who it waits for (the person who gave the task). */
  approver_detail?: UserBrief | null;
}

export interface TaskChangeRequest {
  id: number;
  task: number;
  task_code: string;
  task_title: string;
  task_assignee: string;
  task_assignee_name: string | null;
  task_created_by_name: string | null;
  changes_display: string[];
  requested_by: UserBrief | null;
  changes: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'escalated' | string;
  status_display: string;
  escalated: boolean;
  reviewed_by: UserBrief | null;
  remarks: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface TaskTemplate {
  id: number;
  name: string;
  category: string;
  title: string;
  description: string;
  priority: TaskPriority;
  frequency: TaskFrequency;
  created_by: UserBrief | null;
  created_at: string;
}

export interface DirectoryIndustry {
  id: number;
  name: string;
  icon: string;
  description: string;
  template_count: number;
  categories: string[];
}

export interface DirectoryTemplate {
  id: number;
  name: string;
  category: string;
  description: string;
  industry_name: string;
  industry_icon: string;
  frequency: TaskFrequency;
  priority: TaskPriority;
  step_count: number;
  tags: string[];
  steps: Array<{ title: string; description?: string; offset_days?: number }>;
}

export interface TaskWorkSettings {
  require_completion_remarks: boolean;
  require_completion_attachment: boolean;
}

export interface Workload {
  user: number;
  name: string;
  open_tasks: number;
  overdue: number;
  priority_breakdown: Record<TaskPriority, number>;
  pending_effort_minutes: number;
  tasks_without_effort: number;
  overloaded: boolean;
}

export interface DashboardCounts {
  total: number;
  overdue: number;
  pending: number;
  in_progress: number;
  completed: number;
  in_time: number;
  delayed: number;
}

export interface TaskDashboard {
  tiles: DashboardCounts;
  categories: Array<DashboardCounts & { category: string; score?: number | null }>;
  range_from: string | null;
  range_to: string | null;
}

export interface DelegatedAgent {
  id: number;
  name: string;
  role: string;
  active: boolean;
  open: number;
  overdue: number;
  done_on_time: number;
  done_late: number;
  total: number;
}
export interface DelegatedSummary {
  agents: DelegatedAgent[];
  totals: { open: number; overdue: number; done_on_time: number; done_late: number; total: number };
}

/** One row of any report table (Employees, Monthly, Groups, OverDue, Daily…). Fields depend on the grain. */
export interface ReportRow extends Partial<DashboardCounts> {
  user?: number;
  name?: string;
  label?: string;
  month?: string;
  group?: string;
  category?: string;
  date?: string;
  score?: number | null;
  self_assigned?: number;
  scored_completed?: number;
  review?: string;
  days_overdue?: number;
  oldest_due_at?: string;
  time_earned_minutes?: number;
  time_spent_minutes?: number;
  [key: string]: unknown;
}
export interface EmployeesReport {
  rows: ReportRow[];
  formula?: string;
}

export interface TimeReport {
  range: string;
  rows: Array<{ user: number; name: string; done: number; time_earned_minutes: number; time_spent_minutes: number; no_effort_tasks: number }>;
}

export interface EffortDispute {
  id: number;
  code: string;
  title: string;
  assignee: string;
  assigner: string;
  effort_minutes: number;
  estimate_minutes: number;
  actual_minutes: number | null;
  status: string;
}

export interface ActivityCount {
  user: number;
  name: string;
  count: number;
}

export interface VoiceDraft {
  transcript: string;
  title?: string;
  description?: string;
  due_at?: string | null;
  effort_minutes?: number | null;
  checklist?: string[];
  assigned_to?: number | null;
  assignee_heard?: string | null;
  due_heard?: string | null;
}

/** A group as /groups/ sends it (for "Group" in the task form: picking one fills Assign to). */
export interface TaskGroupOption {
  id: number;
  name: string;
  member_count?: number;
  members_detail?: Array<{ id: number; name: string }>;
}

// ─── task lists ────────────────────────────────────────────────────────────

/** Filters of the task lists (the API's own names; flags are sent as "true"). */
export interface WorkListParams {
  scope?: TaskScope;
  status?: string;
  overdue?: boolean;
  done?: string;
  recurring?: boolean;
  range?: string;
  start?: string;
  end?: string;
  assigned_to?: string | number;
  department?: string;
  search?: string;
}

export interface WorkList {
  rows: WorkTask[];
  /** The dates the server counted (All Tasks with a range). */
  range_from: string | null;
  range_to: string | null;
}

/** GET /tasks/?scope=…&status=…&overdue=true… (up to 200). */
export function useWorkTaskList(params: WorkListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['tasks', 'work-list', params],
    enabled: options.enabled ?? true,
    queryFn: async (): Promise<WorkList> => {
      const q: Query = { page_size: 200, ...workListQuery(params) };
      const d = await tasksApi.get<(DrfPage<WorkTask> & { range_from?: string; range_to?: string }) | WorkTask[]>('/tasks/', q);
      const page = Array.isArray(d) ? null : d;
      return { rows: resultsOf(d), range_from: page?.range_from ?? null, range_to: page?.range_to ?? null };
    },
  });
}

/** GET /task-settings/ — whether completing needs remarks / a proof file. */
export function useTaskWorkSettings() {
  return useQuery({ queryKey: ['tasks', 'work-settings'], queryFn: () => tasksApi.get<TaskWorkSettings>('/task-settings/'), ...STATIC });
}

/** GET /tasks/categories/ — category names used on visible tasks (dashboard filter). */
export function useTaskCategoryNames() {
  return useQuery({ queryKey: ['tasks', 'category-names'], queryFn: () => tasksApi.get<string[]>('/tasks/categories/'), ...STATIC });
}

/** GET /tasks/delegated_summary/ — everyone I gave tasks to, with open / overdue / on time / late counts. */
export function useDelegatedSummary(enabled = true) {
  return useQuery({ queryKey: ['tasks', 'delegated-summary'], queryFn: () => tasksApi.get<DelegatedSummary>('/tasks/delegated_summary/'), enabled });
}

/** GET /tasks/workload/?user= for each picked person (informs, never blocks). */
export function useWorkloads(userIds: number[]) {
  return useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['tasks', 'workload', id],
      queryFn: () => tasksApi.get<Workload>('/tasks/workload/', { user: id }).catch(() => null),
      staleTime: 30_000,
    })),
    combine: (results) => results.map((r) => r.data).filter((w): w is Workload => !!w),
  });
}

// ─── changes from a list row ──────────────────────────────────────────────

function useTaskMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const invalidate = useInvalidateTasks();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}

/** POST /tasks/:id/subscribe/ or /unsubscribe/ */
export function useToggleTaskFollow() {
  return useTaskMutation(({ id, follow }: { id: number; follow: boolean }) => tasksApi.post(`/tasks/${id}/${follow ? 'subscribe' : 'unsubscribe'}/`));
}
/** POST /tasks/:id/estimate/ {minutes} — the assignee's own estimate. */
export function useTaskEstimate() {
  return useTaskMutation(({ id, minutes }: { id: number; minutes: number }) => tasksApi.post(`/tasks/${id}/estimate/`, { minutes }));
}
/** POST /tasks/:id/progress/ {percent?, spent_minutes?, comment?} — an In progress status update. */
export function useTaskProgress() {
  return useTaskMutation(({ id, ...body }: { id: number; percent?: number; spent_minutes?: number; comment?: string }) => tasksApi.post(`/tasks/${id}/progress/`, body));
}
/** POST /tasks/:id/complete/ (multipart: remarks, actual_minutes, file…) — complete with evidence. */
export function useCompleteTask() {
  return useTaskMutation(({ id, remarks, actualMinutes, files }: { id: number; remarks: string; actualMinutes: number; files: File[] }) => {
    const fd = new FormData();
    fd.append('remarks', remarks);
    fd.append('actual_minutes', String(actualMinutes));
    files.forEach((f) => fd.append('file', f));
    return tasksApi.upload(`/tasks/${id}/complete/`, fd);
  });
}
/** POST /tasks/:id/day_log/ — one day's entry in the daily log (posting again replaces it). */
export function useSaveDayLog() {
  return useTaskMutation(
    ({ id, ...body }: { id: number; date: string; did: string; plan_tomorrow?: string; percent_done?: number; minutes_spent?: number }) =>
      tasksApi.post(`/tasks/${id}/day_log/`, body),
  );
}
/** POST /tasks/:id/request_change/ {changes, reason} — ask the creator (or an admin) to change a task. */
export function useRequestTaskChange() {
  return useTaskMutation(({ id, changes, reason }: { id: number; changes: Record<string, unknown>; reason: string }) =>
    tasksApi.post(`/tasks/${id}/request_change/`, { changes, reason }),
  );
}
/** PATCH /tasks/:id/ — an admin edit (applies at once, logged). */
export function useEditTask() {
  return useTaskMutation(({ id, ...body }: { id: number } & Record<string, unknown>) => tasksApi.patch<WorkTask>(`/tasks/${id}/`, body));
}
/** DELETE /tasks/:id/ — moves it to the Deleted bin. */
export function useDeleteTask() {
  return useTaskMutation((id: number) => tasksApi.del(`/tasks/${id}/`));
}
/** POST /tasks/:id/restore/ — back from the Deleted bin (admin). */
export function useRestoreTask() {
  return useTaskMutation((id: number) => tasksApi.post(`/tasks/${id}/restore/`));
}

// ─── creating tasks ────────────────────────────────────────────────────────

export interface NewTaskInput {
  title: string;
  description: string;
  category: string;
  department: string;
  frequency: TaskFrequency;
  priority: TaskPriority;
  group: number | null;
  due_at: string | null;
  repeat_until: string | null;
  effort_minutes: number | null;
}

/** Thrown when some of the tasks were created before one failed. */
export class PartialCreateError extends Error {
  constructor(
    public created: number,
    public total: number,
    public reason: unknown,
  ) {
    super(`Created ${created}/${total}, then failed: ${reason instanceof Error ? reason.message : 'Something went wrong'}`);
  }
}

/**
 * POST /tasks/ once per assignee (each person gets their own task), with the steps and the people in the loop,
 * then uploads the reference files to each.
 */
export function useCreateTasks() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async ({ task, assignees, steps, inLoop, files }: { task: NewTaskInput; assignees: number[]; steps: Array<{ text: string; due_at: string }>; inLoop: number[]; files: File[] }) => {
      const made: WorkTask[] = [];
      try {
        for (const id of assignees) {
          const t = await tasksApi.post<WorkTask>('/tasks/', { ...task, assigned_to: id, checklist: steps, in_loop: inLoop.filter((x) => x !== id) });
          if (files.length) {
            const fd = new FormData();
            files.forEach((f) => fd.append('file', f));
            await tasksApi.upload(`/tasks/${t.id}/upload/`, fd);
          }
          made.push(t);
        }
      } catch (err) {
        if (made.length) throw new PartialCreateError(made.length, assignees.length, err);
        throw err;
      }
      return made;
    },
    onSettled: () => invalidate(),
  });
}

/**
 * GET /task-categories/?department=<code> for the task form: general categories plus that department's. The parameter is
 * always sent, even empty ("General" = general categories only).
 */
export function useTaskFormCategories(department: string) {
  return useQuery({
    queryKey: ['tasks-lookup', 'categories', 'form', department],
    queryFn: () => tasksApi.get<DrfPage<TaskCategory> | TaskCategory[]>(`/task-categories/?department=${encodeURIComponent(department)}`).then(resultsOf),
    staleTime: 60_000,
  });
}

/** POST /task-categories/ {name, department} — added at once for managers, or sent for approval (pending). */
export function useCreateTaskCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; department: string }) =>
      tasksApi.post<{ id: number; name: string; department: string; active: boolean; pending: boolean }>('/task-categories/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks-lookup', 'categories'] }),
  });
}

/**
 * POST /tasks/voice_draft/ — Voice draft (replaced the AI draft): the words the browser or the phone app heard
 * ({transcript}, no AI key needed) or a recorded clip (multipart audio, needs the server's Gemini key) turned into form
 * values (person, deadline, effort, title). Creates nothing.
 */
export function useVoiceTaskDraft() {
  return useMutation({
    mutationFn: (said: string | Blob) => {
      if (typeof said === 'string') return tasksApi.post<VoiceDraft>('/tasks/voice_draft/', { transcript: said });
      const ext = (said.type.includes('mp4') && 'm4a') || (said.type.includes('ogg') && 'ogg') || 'webm';
      const fd = new FormData();
      fd.append('audio', said, `note.${ext}`);
      return tasksApi.upload<VoiceDraft>('/tasks/voice_draft/', fd);
    },
  });
}

/** POST /tasks/proofread/ {text} — spelling and grammar fix. */
export function useProofread() {
  return useMutation({ mutationFn: (text: string) => tasksApi.post<{ changed: boolean; text: string; provider: string }>('/tasks/proofread/', { text }) });
}

// ─── task detail ───────────────────────────────────────────────────────────

/** GET /tasks/:id/ with steps, sub-tasks and the daily log. */
export function useTaskDetail(id: number | null) {
  return useQuery({ queryKey: ['tasks', 'detail', String(id)], queryFn: () => tasksApi.get<TaskDetail>(`/tasks/${id}/`), enabled: !!id, ...NO_PLACEHOLDER });
}
/** GET /tasks/:id/activity/ — comments and system updates for one task. */
export function useTaskFeed(id: number | null) {
  return useQuery({ queryKey: ['tasks', 'detail', String(id), 'activity'], queryFn: () => tasksApi.get<TaskActivityItem[]>(`/tasks/${id}/activity/`), enabled: !!id, ...NO_PLACEHOLDER });
}
/** GET /tasks/:id/files/ */
export function useTaskFiles(id: number | null) {
  return useQuery({ queryKey: ['tasks', 'detail', String(id), 'files'], queryFn: () => tasksApi.get<TaskFile[]>(`/tasks/${id}/files/`), enabled: !!id, ...NO_PLACEHOLDER });
}
/** The completion of this task waiting for ME to accept, if any. */
export function usePendingReviewOf(id: number | null) {
  return useQuery({
    queryKey: ['task-completions', 'of-task', String(id)],
    queryFn: () => tasksApi.get<DrfPage<TaskCompletion> | TaskCompletion[]>('/task-completions/', { scope: 'inbox', task: id }).then((d) => resultsOf(d)[0] ?? null),
    enabled: !!id,
    ...NO_PLACEHOLDER,
  });
}

/** POST /tasks/:id/comment/ {text} */
export function useTaskComment() {
  return useTaskMutation(({ id, text }: { id: number; text: string }) => tasksApi.post(`/tasks/${id}/comment/`, { text }));
}
/** POST /tasks/:id/add_check/ {text, due_at?} — add a step. */
export function useAddTaskStep() {
  return useTaskMutation(({ id, text, due_at }: { id: number; text: string; due_at?: string }) => tasksApi.post(`/tasks/${id}/add_check/`, { text, due_at: due_at || undefined }));
}
/** POST /tasks/:id/check/:item/ — tick a step with a note, re-open it (no note), or remove it. */
export function useTaskStep() {
  return useTaskMutation(({ id, item, note, remove }: { id: number; item: number; note?: string; remove?: boolean }) =>
    tasksApi.post(`/tasks/${id}/check/${item}/${remove ? '?delete=true' : ''}`, note ? { note } : {}),
  );
}
/** POST /tasks/:id/summarize/ — a short summary (AI when available). */
export function useSummarizeTask() {
  return useMutation({ mutationFn: (id: number) => tasksApi.post<{ summary: string; provider: string }>(`/tasks/${id}/summarize/`, {}) });
}
/** POST /tasks/:id/remove_file/ {id} — takes a wrong or outdated file off a task (uploader while open, the giver, an admin). */
export function useRemoveTaskFile() {
  return useTaskMutation(({ task, file }: { task: number; file: number }) => tasksApi.post<TaskFile[]>(`/tasks/${task}/remove_file/`, { id: file }));
}
/** POST /tasks/:id/upload/ (multipart file…) — reference files, addable any time. */
export function useUploadTaskFiles() {
  return useTaskMutation(({ id, files }: { id: number; files: File[] }) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('file', f));
    return tasksApi.upload(`/tasks/${id}/upload/`, fd);
  });
}

// ─── completion reviews ("To accept") ─────────────────────────────────────

/** GET /task-completions/?scope=inbox|mine|all (up to 300) with the server's total. */
export function useCompletionReviews(scope: 'inbox' | 'mine' | 'all') {
  return useQuery({
    queryKey: ['task-completions', 'list', scope],
    queryFn: async () => {
      const d = await tasksApi.get<DrfPage<TaskCompletion> | TaskCompletion[]>('/task-completions/', { scope, page_size: 300 });
      const rows = resultsOf(d);
      return { rows, total: Array.isArray(d) ? rows.length : (d.count ?? rows.length) };
    },
    ...NO_PLACEHOLDER,
  });
}
/** POST /task-completions/:id/review/ {decision: approved|rejected, remarks} — rejecting reopens the task. */
export function useReviewCompletion() {
  return useTaskMutation(({ id, decision, remarks = '' }: { id: number; decision: 'approved' | 'rejected'; remarks?: string }) =>
    tasksApi.post(`/task-completions/${id}/review/`, { decision, remarks }),
  );
}
/** POST /task-completions/bulk_accept/ {ids} — only the rows on screen are sent. */
export function useBulkAcceptCompletions() {
  return useTaskMutation((ids: number[]) => tasksApi.post<{ accepted: number; skipped: number }>('/task-completions/bulk_accept/', { ids }));
}

// ─── change requests ───────────────────────────────────────────────────────

/** GET /task-change-requests/?scope=inbox|mine|all */
export function useChangeRequests(scope: 'inbox' | 'mine' | 'all') {
  return useQuery({
    queryKey: ['task-change-requests', 'list', scope],
    queryFn: () => tasksApi.get<DrfPage<TaskChangeRequest> | TaskChangeRequest[]>('/task-change-requests/', { scope, page_size: 100 }).then(resultsOf),
    ...NO_PLACEHOLDER,
  });
}
/** POST /task-change-requests/:id/review/ {decision: approved|rejected|escalated, remarks} */
export function useReviewChangeRequest() {
  return useTaskMutation(({ id, decision, remarks = '' }: { id: number; decision: 'approved' | 'rejected' | 'escalated'; remarks?: string }) =>
    tasksApi.post(`/task-change-requests/${id}/review/`, { decision, remarks }),
  );
}

// ─── templates and the template directory ─────────────────────────────────

/** GET /task-templates/ */
export function useTaskTemplates() {
  return useQuery({ queryKey: ['tasks', 'templates'], queryFn: () => tasksApi.get<DrfPage<TaskTemplate> | TaskTemplate[]>('/task-templates/').then(resultsOf) });
}
/** POST /task-templates/ */
export function useCreateTaskTemplate() {
  return useTaskMutation((body: { name: string; category: string; title: string; description: string; priority: TaskPriority; frequency: TaskFrequency }) =>
    tasksApi.post<TaskTemplate>('/task-templates/', body),
  );
}
/** DELETE /task-templates/:id/ */
export function useDeleteTaskTemplate() {
  return useTaskMutation((id: number) => tasksApi.del(`/task-templates/${id}/`));
}
/** GET /directory/industries/ */
export function useDirectoryIndustries() {
  return useQuery({ queryKey: ['tasks', 'directory', 'industries'], queryFn: () => tasksApi.get<DrfPage<DirectoryIndustry> | DirectoryIndustry[]>('/directory/industries/').then(resultsOf), ...STATIC });
}
/** GET /directory/templates/?industry=&category=&search= (only when an industry or a search is given). */
export function useDirectoryTemplates(params: { industry?: number; category?: string; search?: string }) {
  const enabled = !!params.industry || !!params.search?.trim();
  return useQuery({
    queryKey: ['tasks', 'directory', 'templates', params],
    queryFn: () => tasksApi.get<DrfPage<DirectoryTemplate> | DirectoryTemplate[]>('/directory/templates/', { ...params, search: params.search?.trim() }).then(resultsOf),
    enabled,
  });
}
/** POST /directory/templates/:id/create_tasks/ {assigned_to?, group?} → the tasks made. */
export function useDirectoryCreateTasks() {
  return useTaskMutation(({ id, ...body }: { id: number; assigned_to?: number; group?: number }) => tasksApi.post<WorkTask[]>(`/directory/templates/${id}/create_tasks/`, body));
}
/** POST /directory/templates/:id/add_to_my_templates/ → the templates added. */
export function useDirectoryAddToTemplates() {
  return useTaskMutation((id: number) => tasksApi.post<TaskTemplate[]>(`/directory/templates/${id}/add_to_my_templates/`, {}));
}

// ─── activities ────────────────────────────────────────────────────────────

export interface ActivityFilters {
  days?: string;
  assigned_to?: string;
  actor?: string;
  search?: string;
}
/** GET /task-activities/ (100 latest) and /task-activities/counts/ (the "who did it" chips; ignore the actor filter). */
export function useTaskActivities(f: ActivityFilters) {
  const base = { days: f.days, assigned_to: f.assigned_to, search: f.search };
  const list = useQuery({
    queryKey: ['tasks', 'activities', f],
    queryFn: () => tasksApi.get<DrfPage<TaskActivityItem> | TaskActivityItem[]>('/task-activities/', { page_size: 100, ...base, actor: f.actor }).then(resultsOf),
  });
  const counts = useQuery({ queryKey: ['tasks', 'activities', 'counts', base], queryFn: () => tasksApi.get<ActivityCount[]>('/task-activities/counts/', base) });
  return { list, counts };
}

// ─── dashboard and reports ────────────────────────────────────────────────

/** GET /tasks/dashboard/ — tiles + per-category table. scope: my | delegated | group. */
export function useTaskDashboard(params: { range: string; start?: string; end?: string; scope?: string; category?: string; search?: string }, enabled = true) {
  return useQuery({ queryKey: ['tasks', 'dashboard', params], queryFn: () => tasksApi.get<TaskDashboard>('/tasks/dashboard/', params), enabled });
}
/** GET /tasks/employees_report/ — per person (or ?grain=daily|monthly|group|overdue, ?user=). */
export function useEmployeesReport(params: { range: string; start?: string; end?: string; grain?: string; user?: number }, enabled = true) {
  return useQuery({ queryKey: ['tasks', 'employees-report', params], queryFn: () => tasksApi.get<EmployeesReport>('/tasks/employees_report/', params), enabled, ...NO_PLACEHOLDER });
}
/** GET /tasks/time_report/?range= — time earned vs time spent per person. */
export function useTimeReport(range: string) {
  return useQuery({ queryKey: ['tasks', 'time-report', range], queryFn: () => tasksApi.get<TimeReport>('/tasks/time_report/', { range }) });
}
/** GET /tasks/effort_disputes/ — where the assigner and the assignee disagreed on the effort. */
export function useEffortDisputes(params: { range: string; start?: string; end?: string }, enabled = true) {
  return useQuery({ queryKey: ['tasks', 'effort-disputes', params], queryFn: () => tasksApi.get<{ rows: EffortDispute[] }>('/tasks/effort_disputes/', params), enabled });
}

/** The server's extra error data, e.g. {needs: "remarks"} when completing needs evidence. */
export function errorData(err: unknown): Record<string, unknown> {
  return err instanceof ApiError && err.data && typeof err.data === 'object' ? (err.data as Record<string, unknown>) : {};
}
