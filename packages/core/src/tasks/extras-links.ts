/** Links (old pages/Links.jsx): shared bookmark collections, favourites and group-scoped links. Module `links`. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import { linksQuery } from './exports';
import type { UserBrief } from './types';

export interface LinkCollection {
  id: number;
  name: string;
  link_count: number;
  created_at: string;
}

export interface Link {
  id: number;
  collection: number;
  collection_name: string;
  title: string;
  url: string;
  description: string;
  /** null = visible to everyone; else only that group's members (and admins). */
  group: number | null;
  group_name: string | null;
  added_by_detail: UserBrief | null;
  favorited: boolean;
  created_at: string;
}

export interface LinkInput {
  collection: number;
  title: string;
  url: string;
  description: string;
  group: number | null;
}

export interface LinkFilters {
  search?: string;
  collection?: number | '';
  favorites?: boolean;
}

/** GET /link-collections/ — every collection (not paginated). */
export function useLinkCollections() {
  return useQuery({ queryKey: ['links', 'collections'], queryFn: () => tasksApi.get<LinkCollection[]>('/link-collections/') });
}

/** GET /links/?search=&collection=&favorites=true — the links I can see (not paginated). */
export function useLinks(filters: LinkFilters = {}) {
  const q = linksQuery(filters);
  return useQuery({ queryKey: ['links', 'list', q], queryFn: () => tasksApi.get<Link[]>('/links/', q) });
}

function useInvalidateLinks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['links'] });
}

/** POST /link-collections/ (tasks.assign). */
export function useAddLinkCollection() {
  const done = useInvalidateLinks();
  return useMutation({ mutationFn: (name: string) => tasksApi.post<LinkCollection>('/link-collections/', { name }), onSuccess: done });
}

/** POST /links/ */
export function useAddLink() {
  const done = useInvalidateLinks();
  return useMutation({ mutationFn: (body: LinkInput) => tasksApi.post<Link>('/links/', body), onSuccess: done });
}

/** POST /links/:id/favorite/ — toggles my star. */
export function useToggleLinkFavorite() {
  const done = useInvalidateLinks();
  return useMutation({ mutationFn: (id: number) => tasksApi.post<{ favorited: boolean }>(`/links/${id}/favorite/`), onSuccess: done });
}

/** DELETE /links/:id/ — mine, or any with tasks.assign. */
export function useDeleteLink() {
  const done = useInvalidateLinks();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/links/${id}/`), onSuccess: done });
}
