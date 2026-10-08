/** Tasks API shapes shared by every Tasks screen (from crm/serializers.py TaskSerializer, accounts UserBriefSerializer). */

export type TaskStatus = 'open' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskFrequency = 'one_time' | 'daily' | 'weekly' | 'monthly';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: 'Open', in_progress: 'In progress', done: 'Done' };
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const TASK_FREQUENCY_LABELS: Record<TaskFrequency, string> = { one_time: 'One time', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export interface UserBrief {
  id: number;
  username: string;
  name: string;
  role: string;
}

/** A person in a picker (GET /tasks/people/, /tasks/assignees/, /leads/assignees/). */
export interface PersonOption extends UserBrief {
  department?: string;
  department_name?: string;
}

export interface Task {
  id: number;
  code: string;
  title: string;
  description: string;
  /** The category's NAME (the API sends a string). */
  category: string;
  department: string;
  frequency: TaskFrequency;
  frequency_display: string;
  parent: number | null;
  parent_code: string | null;
  repeat_until: string | null;
  lead: number | null;
  lead_name: string | null;
  group: number | null;
  group_name: string | null;
  assigned_to: number;
  assigned_to_detail: UserBrief;
  created_by_detail: UserBrief | null;
  status: TaskStatus;
  status_display: string;
  priority: TaskPriority;
  priority_display: string;
  due_at: string | null;
  is_overdue: boolean;
  effort_minutes: number | null;
  assignee_estimate_minutes: number | null;
  progress_percent: number;
  actual_minutes: number | null;
  completion_note: string;
  completed_at: string | null;
  deleted_at: string | null;
  subscribed: boolean;
  pending_change_requests: number;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
  /** FreeFounders: what this task works on in another app (e.g. an Assets ticket). */
  external_url: string;
}

export type TaskScope = 'my' | 'all' | 'delegated' | 'subscribed' | 'deleted';

export interface TaskListParams {
  scope?: TaskScope;
  status?: string;
  /** The API accepts 'true' (not '1'). */
  overdue?: 'true';
  done?: 'on_time' | 'late';
  recurring?: 'true';
  range?: string;
  start?: string;
  end?: string;
  assigned_to?: string | number;
  department?: string;
  search?: string;
  group?: number;
  page_size?: number;
}
