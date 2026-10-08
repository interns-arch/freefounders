/** Groups (old pages/Groups.jsx): /groups/ and its dashboard / member actions. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import type { UserBrief } from './types';

export interface Group {
  id: number;
  name: string;
  description: string;
  category: string;
  owner: number | null;
  owner_detail: UserBrief | null;
  members: number[];
  members_detail: UserBrief[];
  member_count: number;
  active: boolean;
  can_manage: boolean;
  created_at: string;
}

export interface GroupInput {
  name: string;
  description: string;
  category: string;
  members: number[];
}

export interface GroupDashboard {
  tiles: { total: number; pending: number; in_progress: number; completed: number; overdue: number; members: number };
  members: UserBrief[];
  recent_activity: Array<{ text: string; task_title: string; actor: string; created_at: string }>;
}

/** GET /groups/ — every group I can see (archived included). */
export function useGroups() {
  return useQuery({ queryKey: ['groups', 'all'], queryFn: () => tasksApi.get<Group[]>('/groups/') });
}

export function useGroupDashboard(id: number | null) {
  return useQuery({ queryKey: ['groups', 'dashboard', id], queryFn: () => tasksApi.get<GroupDashboard>(`/groups/${id}/dashboard/`), enabled: id != null });
}

function useInvalidateGroups() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['groups'] });
}

/** POST /groups/ or PATCH /groups/:id/ */
export function useSaveGroup() {
  const done = useInvalidateGroups();
  return useMutation({
    mutationFn: ({ id, ...body }: GroupInput & { id?: number }) => (id ? tasksApi.patch<Group>(`/groups/${id}/`, body) : tasksApi.post<Group>('/groups/', body)),
    onSuccess: done,
  });
}

/** DELETE /groups/:id/ — archives the group. */
export function useArchiveGroup() {
  const done = useInvalidateGroups();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/groups/${id}/`), onSuccess: done });
}

/** POST /groups/:id/add_member/ {users} */
export function useAddGroupMembers() {
  const done = useInvalidateGroups();
  return useMutation({ mutationFn: ({ id, users }: { id: number; users: number[] }) => tasksApi.post(`/groups/${id}/add_member/`, { users }), onSuccess: done });
}

/** POST /groups/:id/remove_member/ {user} */
export function useRemoveGroupMember() {
  const done = useInvalidateGroups();
  return useMutation({ mutationFn: ({ id, user }: { id: number; user: number }) => tasksApi.post(`/groups/${id}/remove_member/`, { user }), onSuccess: done });
}
