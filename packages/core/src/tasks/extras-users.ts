/** "My team" (old pages/Users.jsx): the directory everyone sees and the users.manage list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => ['tasks-users', 'tasks-lookup'].includes(String(q.queryKey[0])) });
}

/**
 * PATCH /users/:id/. In FreeFounders the department and "reports to" belong to the Platform's People directory
 * (PLAN.md §17.1), so they are not sent from here.
 */
export interface ManagedUserInput {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  whatsapp_phone: string;
  password?: string;
}
export function useUpdateManagedUser() {
  const done = useInvalidateUsers();
  return useMutation({ mutationFn: ({ id, ...body }: ManagedUserInput & { id: number }) => tasksApi.patch<ManagedUser>(`/users/${id}/`, body), onSuccess: done });
}

/** POST /users/:id/activate|deactivate/ */
export function useSetManagedUserActive() {
  const done = useInvalidateUsers();
  return useMutation({ mutationFn: ({ id, active }: { id: number; active: boolean }) => tasksApi.post(`/users/${id}/${active ? 'activate' : 'deactivate'}/`), onSuccess: done });
}

export interface PurgeInfo {
  id: number;
  name: string;
  username: string;
  is_active: boolean;
  tasks_total: number;
  tasks_open: number;
  tasks_overdue: number;
  tasks_done: number;
  tasks_given_to_others: number;
  mistakes: number;
  reports: number;
}

/** GET /users/:id/purge/ — what goes with a deactivated person. */
export function usePurgeInfo(userId: number | null) {
  return useQuery({ queryKey: ['tasks-users', 'purge', userId], queryFn: () => tasksApi.get<PurgeInfo>(`/users/${userId}/purge/`), enabled: userId != null });
}

/** POST /users/:id/purge/ {confirm: username} — deletes for good. */
export function usePurgeManagedUser() {
  const done = useInvalidateUsers();
  return useMutation({ mutationFn: ({ id, confirm }: { id: number; confirm: string }) => tasksApi.post(`/users/${id}/purge/`, { confirm }), onSuccess: done });
}
