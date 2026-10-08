/** The asset register: lists, one asset, its history, actions (assign / return / lifecycle), photos, bulk changes. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '../config';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { Allocation, AllocationPhoto, AssetDetail, AssetListItem, AssetListResponse, FieldDefinition, HistoryEvent, MaintenanceRecord, SearchResults } from './types';

export const fetchAsset = (id: string) => assetsApi.get<AssetDetail>(`/assets/${id}`);

/** GET /assets?… — the register (filters straight from the URL). */
export function useAssetList(filters: Query) {
  return useQuery({ queryKey: assetsKey('assets', filters), queryFn: () => assetsApi.get<AssetListResponse>('/assets', filters) });
}

/** GET /assets?ids=… — the labels page. */
export function useAssetsByIds(ids: string[]) {
  return useQuery({
    queryKey: assetsKey('assets', 'labels', ids),
    queryFn: () => assetsApi.get<AssetListResponse>('/assets', { ids: ids.join(','), pageSize: 200, sort: 'assetTag', dir: 'asc' }),
    enabled: ids.length > 0,
  });
}

/** Warm the cache when the pointer rests on a row. */
export function usePrefetchAsset() {
  const qc = useQueryClient();
  return (id: string) => void qc.prefetchQuery({ queryKey: assetsKey('asset', id), queryFn: () => fetchAsset(id), staleTime: 15_000 });
}

export function useAsset(id: string | undefined) {
  return useQuery({ queryKey: assetsKey('asset', id), queryFn: () => fetchAsset(id!), enabled: !!id, placeholderData: undefined });
}

export function useAssetHistory(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: assetsKey('history', 'asset', id), queryFn: () => assetsApi.get<Page<HistoryEvent>>(`/assets/${id}/history`), enabled: !!id && enabled });
}

export function useAssetAllocations(id: string) {
  return useQuery({ queryKey: assetsKey('asset', id, 'allocations'), queryFn: () => assetsApi.get<Allocation[]>(`/assets/${id}/allocations`) });
}

export interface OwnershipPeriod {
  id: string;
  ownership: string;
  ownerCompanyName: string | null;
  vendorName: string | null;
  startedAt: string;
  endedAt: string | null;
}
export function useAssetOwnership(id: string) {
  return useQuery({ queryKey: assetsKey('asset', id, 'ownership'), queryFn: () => assetsApi.get<OwnershipPeriod[]>(`/assets/${id}/ownership`) });
}

export function useAssetMaintenance(assetId: string) {
  return useQuery({ queryKey: assetsKey('maintenance', { assetId }), queryFn: () => assetsApi.get<Page<MaintenanceRecord>>('/maintenance', { assetId, pageSize: 50 }) });
}

/** POST /assets or PATCH /assets/:id. */
export const useSaveAsset = mutationHook(({ id, body }: { id?: string | null; body: unknown }) =>
  id ? assetsApi.patch<AssetDetail>(`/assets/${id}`, body) : assetsApi.post<AssetDetail>('/assets', body),
);

/**
 * POST /assets/:id/<action> (assign, transfer, return, lifecycle…) or /allocations/:id/… — the asset action dialogs.
 * `path` is the API path the dialog chose, e.g. `/assets/123/assign`.
 */
export function postAssetAction(path: string, body: unknown) {
  return assetsApi.post<{ id?: string; allocationId?: string }>(path, body);
}

/** POST /assets/:id/photos (multipart: allocationId?, kind, photos[]). The screen shrinks the photos first. */
export function uploadAssetPhotos(assetId: string, form: FormData) {
  return assetsApi.upload<AllocationPhoto[]>(`/assets/${assetId}/photos`, form);
}

/** Address of a saved photo for <img>/<a> (the web app holds the Assets session cookie). */
export const photoUrl = (p: Pick<AllocationPhoto, 'assetId' | 'id'>) => `${config.origin}/assets/api/assets/${p.assetId}/photos/${p.id}`;

export interface BulkResult {
  results: { id: string; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}
/** POST /assets/bulk — one action on many assets. */
export const useBulkAssets = mutationHook((body: { ids: string[]; action: string; holderType?: string; holderId?: string | null; lifecycleAction?: string; notes?: string }) =>
  assetsApi.post<BulkResult>('/assets/bulk', body),
);

/** GET /fields/filterable — custom fields usable as list filters. */
export function useFilterableFields(categoryId: string | undefined, assetTypeId: string | undefined) {
  return useQuery({
    queryKey: assetsKey('filterable-fields', categoryId, assetTypeId),
    queryFn: () => assetsApi.get<FieldDefinition[]>('/fields/filterable', { categoryId, assetTypeId }),
    enabled: !!(categoryId || assetTypeId),
    staleTime: 5 * 60_000,
    placeholderData: undefined,
  });
}

/** Pickers: assets by name / tag / serial. */
export function usePickerAssets(search: string, filter: Record<string, string | undefined> | undefined, enabled: boolean) {
  return useQuery({
    queryKey: assetsKey('picker', 'assets', search, filter),
    queryFn: () => assetsApi.get<Page<AssetListItem>>('/assets', { search, pageSize: 20, sort: 'assetTag', dir: 'asc', ...filter }),
    enabled,
  });
}

/** GET /search?q= — the search palette. */
export function useAssetsSearch(q: string, enabled: boolean) {
  return useQuery({ queryKey: assetsKey('search', q), queryFn: () => assetsApi.get<SearchResults>('/search', { q }), enabled, staleTime: 10_000 });
}
