import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError, type Page } from './api';
import type { AssetType, AssetTypeDetail, Category, LocationOption, OrgEntity, Role } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 10 * 60_000,
      placeholderData: keepPreviousData,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const LOOKUP_STALE = 5 * 60_000;

/** Master data for dropdowns (cached; refreshed after edits via invalidation). */
export function useCompanies() {
  return useQuery({ queryKey: ['lookup', 'companies'], queryFn: () => api.get<Page<OrgEntity>>('/companies', { all: 1 }).then((p) => p.items), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useDepartments() {
  return useQuery({ queryKey: ['lookup', 'departments'], queryFn: () => api.get<Page<OrgEntity>>('/departments', { all: 1 }).then((p) => p.items), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useLocations() {
  return useQuery({ queryKey: ['lookup', 'locations'], queryFn: () => api.get<Page<LocationOption>>('/locations', { all: 1 }).then((p) => p.items), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useVendors() {
  return useQuery({ queryKey: ['lookup', 'vendors'], queryFn: () => api.get<Page<OrgEntity>>('/vendors', { all: 1 }).then((p) => p.items), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles'), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useAssetTypes() {
  return useQuery({ queryKey: ['asset-types'], queryFn: () => api.get<AssetType[]>('/asset-types'), staleTime: LOOKUP_STALE, placeholderData: undefined });
}
export function useAssetType(id: string | null | undefined) {
  return useQuery({
    queryKey: ['asset-type', id],
    queryFn: () => api.get<AssetTypeDetail>(`/asset-types/${id}`),
    enabled: !!id,
    staleTime: LOOKUP_STALE,
    placeholderData: undefined,
  });
}

/** Everything that depends on assets / custody changes; invalidated after any asset mutation. */
export function invalidateAssetData() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['assets'] }),
    queryClient.invalidateQueries({ queryKey: ['asset'] }),
    queryClient.invalidateQueries({ queryKey: ['employees'] }),
    queryClient.invalidateQueries({ queryKey: ['employee'] }),
    queryClient.invalidateQueries({ queryKey: ['exits'] }),
    queryClient.invalidateQueries({ queryKey: ['exit'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['requests'] }),
    queryClient.invalidateQueries({ queryKey: ['maintenance'] }),
    queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
    queryClient.invalidateQueries({ queryKey: ['history'] }),
  ]);
}
