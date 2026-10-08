/** Assets users and roles (settings). */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { UserRow } from './types';

export function useAssetsUsers(filters: Query) {
  return useQuery({ queryKey: assetsKey('users', filters), queryFn: () => assetsApi.get<Page<UserRow>>('/users', filters) });
}
export const useSaveAssetsUser = mutationHook(({ id, body }: { id?: string | null; body: unknown }) => (id ? assetsApi.patch(`/users/${id}`, body) : assetsApi.post('/users', body)));
export const useDeleteRole = mutationHook((id: string) => assetsApi.del(`/roles/${id}`));
export const useSaveRole = mutationHook(({ id, body }: { id?: string | null; body: unknown }) => (id ? assetsApi.patch(`/roles/${id}`, body) : assetsApi.post('/roles', body)));
