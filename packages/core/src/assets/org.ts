/** Organisation settings: companies, departments, locations, vendors. */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { OrgEntity } from './types';

export type OrgPath = 'companies' | 'departments' | 'locations' | 'vendors';

export function useOrgList(path: OrgPath, filters: Query) {
  return useQuery({ queryKey: assetsKey('org', path, filters), queryFn: () => assetsApi.get<Page<OrgEntity>>(`/${path}`, filters) });
}
export const useSaveOrg = mutationHook(({ path, id, body }: { path: OrgPath; id?: string | null; body: unknown }) =>
  id ? assetsApi.patch(`/${path}/${id}`, body) : assetsApi.post(`/${path}`, body),
);
export const useDeleteOrg = mutationHook(({ path, id }: { path: OrgPath; id: string }) => assetsApi.del(`/${path}/${id}`));
