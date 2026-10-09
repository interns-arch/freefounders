/** Idea board (old pages/Ideas.jsx): ideas, votes, comments and the review status. Module `ideas`. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { UserBrief } from './types';

export type IdeaStatus = 'new' | 'under_review' | 'approved' | 'rejected' | 'implemented';
export type IdeaPriority = 'low' | 'normal' | 'high';
export type IdeaScope = 'shared' | 'my' | 'group';

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  new: 'New',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  implemented: 'Implemented',
};
export const IDEA_PRIORITY_LABELS: Record<IdeaPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' };

export interface Idea {
  id: number;
  title: string;
  description: string;
  category: string;
  author_detail: UserBrief | null;
  /** null = the shared (company-wide) board. */
  group: number | null;
  group_name: string | null;
  status: IdeaStatus;
  status_display: string;
  priority: IdeaPriority;
  vote_count: number;
  comment_count: number;
  voted: boolean;
  created_at: string;
  updated_at: string;
}

export interface IdeaComment {
  id: number;
  author: UserBrief | null;
  body: string;
  created_at: string;
}

export interface IdeaInput {
  title: string;
  description: string;
  category: string;
  group: number | null;
  priority: IdeaPriority;
}

export interface IdeaFilters {
  scope: IdeaScope;
  status?: IdeaStatus | '';
  search?: string;
}

/** GET /ideas/?scope=&status=&search=&page_size=100 */
export function useIdeas(filters: IdeaFilters) {
  const q = { scope: filters.scope, status: filters.status || undefined, search: filters.search?.trim() || undefined, page_size: 100 };
  return useQuery({ queryKey: ['ideas', 'list', q], queryFn: () => tasksApi.get<DrfPage<Idea> | Idea[]>('/ideas/', q).then(resultsOf) });
}

/** GET /ideas/:id/comments/ */
export function useIdeaComments(id: number | null) {
  return useQuery({ queryKey: ['ideas', 'comments', id], queryFn: () => tasksApi.get<IdeaComment[]>(`/ideas/${id}/comments/`), enabled: id != null });
}

function useInvalidateIdeas() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ideas'] });
}

/** POST /ideas/ */
export function useAddIdea() {
  const done = useInvalidateIdeas();
  return useMutation({ mutationFn: (body: IdeaInput) => tasksApi.post<Idea>('/ideas/', body), onSuccess: done });
}

/** POST /ideas/:id/vote/ — toggles my vote. */
export function useVoteIdea() {
  const done = useInvalidateIdeas();
  return useMutation({ mutationFn: (id: number) => tasksApi.post<{ voted: boolean; vote_count: number }>(`/ideas/${id}/vote/`), onSuccess: done });
}

/** PATCH /ideas/:id/ { status } — tasks.assign only. */
export function useSetIdeaStatus() {
  const done = useInvalidateIdeas();
  return useMutation({ mutationFn: ({ id, status }: { id: number; status: IdeaStatus }) => tasksApi.patch<Idea>(`/ideas/${id}/`, { status }), onSuccess: done });
}

/** DELETE /ideas/:id/ — mine, or any with tasks.assign. */
export function useDeleteIdea() {
  const done = useInvalidateIdeas();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/ideas/${id}/`), onSuccess: done });
}

/** POST /ideas/:id/comments/ { body } */
export function useAddIdeaComment() {
  const done = useInvalidateIdeas();
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: string }) => tasksApi.post<IdeaComment>(`/ideas/${id}/comments/`, { body }), onSuccess: done });
}
