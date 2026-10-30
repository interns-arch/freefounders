/** "My team" (old pages/Users.jsx): the directory everyone sees and the users.manage list. */
import { useQuery } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';

/** GET /team/ — the people I may see (my department, or who reports to me). */
export interface TeamMember {
  id: number;
  name: string;
  username: string;
  email: string;
  mobile: string;
  role: string;
  role_display: string;
  department_display: string;
  reports_to: string | null;
}

export function useTeamDirectory(enabled = true) {
  return useQuery({ queryKey: ['tasks-users', 'team'], queryFn: () => tasksApi.get<TeamMember[]>('/team/'), staleTime: 60_000, enabled });
}

/** A Tasks user as users.manage sees it (GET /users/). */
export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_display: string;
  department: string;
  department_display: string;
  whatsapp_phone: string;
  reporting_manager: number | null;
  reporting_manager_name: string | null;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  /** The People directory person (PLAN.md §26), when signed in through Kaampilot. */
  platform_person_id?: string | null;
}

export function useManagedUsers(enabled = true) {
  return useQuery({
    queryKey: ['tasks-users', 'manage'],
    queryFn: () => tasksApi.get<DrfPage<ManagedUser> | ManagedUser[]>('/users/', { page_size: 200 }).then(resultsOf),
    enabled,
  });
}

export interface TaskRoleOption {
  value: string;
  label: string;
  level: number;
  is_manager: boolean;
}

/** GET /roles/ — every Tasks role (value + label), and which ones are manager roles. */
export function useTaskRoleOptions() {
  return useQuery({ queryKey: ['tasks-lookup', 'roles'], queryFn: () => tasksApi.get<TaskRoleOption[]>('/roles/'), staleTime: 5 * 60_000 });
}

export interface MemberWorkload {
  user: number;
  name: string;
  open_tasks: number;
  overdue: number;
  priority_breakdown: Partial<Record<'urgent' | 'high' | 'normal' | 'low', number>>;
  pending_effort_minutes: number;
  tasks_without_effort: number;
  overloaded: boolean;
}

/** GET /tasks/workload/?user= — open tasks and pending effort of one person. */
export function useMemberWorkload(userId: number | null) {
  return useQuery({
    queryKey: ['tasks', 'workload', userId],
    queryFn: () => tasksApi.get<MemberWorkload>('/tasks/workload/', { user: userId! }),
    enabled: userId != null,
  });
}
