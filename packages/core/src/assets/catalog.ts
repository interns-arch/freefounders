/** The asset catalogue: categories, asset types and their custom fields. */
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { AssetType, Category, FieldDefinition } from './types';

/** GET /fields?categoryId= — a category's own fields. */
export function useCategoryFields(categoryId: string) {
  return useQuery({ queryKey: assetsKey('fields', { categoryId }), queryFn: () => assetsApi.get<FieldDefinition[]>('/fields', { categoryId }), placeholderData: undefined });
}
export const useReorderFields = mutationHook((ids: string[]) => assetsApi.post('/fields/reorder', { ids }));
/** DELETE /fields/:id — archived instead when assets already have values. */
export const useDeleteField = mutationHook((f: FieldDefinition) => assetsApi.del<{ archived: boolean }>(`/fields/${f.id}`));
/** POST /fields or PATCH /fields/:id. */
export function saveField(id: string | null | undefined, body: unknown) {
  return id ? assetsApi.patch(`/fields/${id}`, body) : assetsApi.post('/fields', body);
}
export const useSaveField = mutationHook(({ id, body }: { id?: string | null; body: unknown }) => saveField(id, body));
export const useDeleteAssetType = mutationHook((id: string) => assetsApi.del(`/asset-types/${id}`));
export const useDeleteCategory = mutationHook((id: string) => assetsApi.del(`/categories/${id}`));
export const useSaveAssetType = mutationHook(({ id, body }: { id?: string | null; body: unknown }) =>
  id ? assetsApi.patch<AssetType>(`/asset-types/${id}`, body) : assetsApi.post<AssetType>('/asset-types', body),
);
export const useSaveCategory = mutationHook(({ id, body }: { id?: string | null; body: unknown }) =>
  id ? assetsApi.patch<Category>(`/categories/${id}`, body) : assetsApi.post<Category>('/categories', body),
);
