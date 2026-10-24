/** Team Performance (old pages/TeamReport.jsx): /tasks/team_report/, /tasks/send_overdue_email/. */
import { useMutation, useQuery } from '@tanstack/react-query';
import { tasksApi } from '../http';

export interface TeamReportRow {
  user: number;
  name: string;
  role: string;
  department: string;
  score: number | null;
  score_prev: number | null;
  score_delta: number | null;
  on_time_rate: number | null;
  attendance_rate: number | null;
  leave_days: number | null;
  working_days: number | null;
  total: number;
  completed: number;
  in_time: number;
  delayed: number;
  pending: number;
  in_progress: number;
  overdue: number;
  self_assigned: number;
  time_assigned_minutes: number;
  time_earned_minutes: number;
  time_spent_minutes: number;
  effort_ratio: number | null;
  rework_rejected: number;
  rework_rate: number | null;
  mistakes: number;
  repeat_mistakes: number;
  mistake_penalty: number;
  extension_requests: number;
  cancel_requests: number;
  open_tasks: number;
  open_overdue: number;
  pending_effort_minutes: number;
  review: string | null;
  flags: string[];
}

export interface TeamReport {
  range: { start: string | null; end: string | null };
  previous: { start: string | null; end: string | null } | null;
  team: {
    people: number;
    scored_people: number;
    team_score: number | null;
    team_score_delta: number | null;
    completed: number;
    in_time: number;
    delayed: number;
    pending: number;
    in_progress: number;
    overdue: number;
    total: number;
    on_time_rate: number | null;
    time_assigned_minutes: number;
    time_earned_minutes: number;
    time_spent_minutes: number;
    open_tasks: number;
    open_overdue: number;
    at_risk: number;
  };
  rows: TeamReportRow[];
  formula?: string;
}

/** GET /tasks/team_report/?range=…(&start&end for custom). */
export function useTeamReport(range: string, custom: { start: string; end: string }) {
  const ready = range !== 'custom' || (!!custom.start && !!custom.end);
  const q = { range, start: range === 'custom' ? custom.start : undefined, end: range === 'custom' ? custom.end : undefined };
  return useQuery({ queryKey: ['tasks', 'team-report', q], queryFn: () => tasksApi.get<TeamReport>('/tasks/team_report/', q), enabled: ready });
}

/** One person on the "who asks most to change a due date" board. */
export interface ChangeRequestLeader {
  user: number;
  name: string;
  role: string;
  department: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  closed: number;
  /** Tasks they asked about. */
  tasks: number;
  /** Approved out of decided, or null when nothing was decided yet. */
  approval_rate: number | null;
  last_at: string;
  requests: Array<{
    id: number;
    task: number;
    task_code: string;
    task_title: string;
    changes: string[];
    reason: string;
    status: string;
    status_display?: string;
    created_at: string;
    /** The due date before and the one asked for (old kept on the request since PLAN.md §19.41; null for older decided ones). */
    old_due_at?: string | null;
    new_due_at?: string | null;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
    remarks?: string;
  }>;
}

export interface ChangeRequestLeaders {
  range: { start: string | null; end: string | null };
  total: number;
  people: number;
  pending: number;
  rows: ChangeRequestLeader[];
}

/** GET /tasks/change_request_leaders/?range=… — who asks most often to move a due date/time (Team performance). */
export function useChangeRequestLeaders(range: string, custom: { start: string; end: string }) {
  const ready = range !== 'custom' || (!!custom.start && !!custom.end);
  const q = { range, start: range === 'custom' ? custom.start : undefined, end: range === 'custom' ? custom.end : undefined };
  return useQuery({
    queryKey: ['tasks', 'change-request-leaders', q],
    queryFn: () => tasksApi.get<ChangeRequestLeaders>('/tasks/change_request_leaders/', q),
    enabled: ready,
  });
}

/** POST /tasks/send_overdue_email/ — everyone gets their overdue list + performance now. */
export function useSendOverdueEmail() {
  return useMutation({ mutationFn: () => tasksApi.post<{ sent: number }>('/tasks/send_overdue_email/') });
}
