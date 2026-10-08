/** Master data for dropdowns (cached; refreshed after edits via invalidation). From the old lib/queries.ts. */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page } from '../http';
import { assetsKey, LOOKUP_OPTS } from './keys';
import type { AssetType, AssetTypeDetail, Category, LocationOption, OrgEntity, Role } from './types';

export function useCompanies() {
  return useQuery({ queryKey: assetsKey('lookup', 'companies'), queryFn: () => assetsApi.get<Page<OrgEntity>>('/companies', { all: 1 }).then((p) => p.items), ...LOOKUP_OPTS });
}
export function useDepartments() {
  return useQuery({ queryKey: assetsKey('lookup', 'departments'), queryFn: () => assetsApi.get<Page<OrgEntity>>('/departments', { all: 1 }).then((p) => p.items), ...LOOKUP_OPTS });
}
export function useLocations() {
  return useQuery({ queryKey: assetsKey('lookup', 'locations'), queryFn: () => assetsApi.get<Page<LocationOption>>('/locations', { all: 1 }).then((p) => p.items), ...LOOKUP_OPTS });
}
export function useVendors() {
  return useQuery({ queryKey: assetsKey('lookup', 'vendors'), queryFn: () => assetsApi.get<Page<OrgEntity>>('/vendors', { all: 1 }).then((p) => p.items), ...LOOKUP_OPTS });
}
/** GET /roles — the Assets roles (also the roles settings page). */
export function useRoles(options: { fresh?: boolean } = {}) {
  return useQuery({ queryKey: assetsKey('roles'), queryFn: () => assetsApi.get<Role[]>('/roles'), ...(options.fresh ? {} : LOOKUP_OPTS) });
}
export function useCategories() {
  return useQuery({ queryKey: assetsKey('categories'), queryFn: () => assetsApi.get<Category[]>('/categories'), ...LOOKUP_OPTS });
}
export function useAssetTypes() {
  return useQuery({ queryKey: assetsKey('asset-types'), queryFn: () => assetsApi.get<AssetType[]>('/asset-types'), ...LOOKUP_OPTS });
}
export function useAssetType(id: string | null | undefined) {
  return useQuery({ queryKey: assetsKey('asset-type', id), queryFn: () => assetsApi.get<AssetTypeDetail>(`/asset-types/${id}`), enabled: !!id, ...LOOKUP_OPTS });
}

export type QuickOrgPath = 'companies' | 'departments' | 'locations' | 'vendors';
/** POST /companies|departments|locations|vendors {name, …}: add one on the spot from a picker. */
export function quickCreateOrg(path: QuickOrgPath, body: Record<string, unknown>) {
  return assetsApi.post<{ id: string; name: string }>(`/${path}`, body);
}

export interface StaffMember {
  id: string;
  name: string;
  roleName: string;
}
/** GET /directory/staff — who a ticket can be assigned to. */
export function useStaffDirectory(enabled = true) {
  return useQuery({ queryKey: assetsKey('staff'), queryFn: () => assetsApi.get<StaffMember[]>('/directory/staff'), enabled, staleTime: 5 * 60_000 });
}
