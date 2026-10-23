/**
 * Photos of an asset itself (PLAN.md §19.34): the gallery on the asset page, added right after "Add asset", from the
 * edit form or on the asset page. Up to MAX_ASSET_PHOTOS per asset; handover / return photos belong to the assignment
 * (assets.ts: uploadAssetPhotos) and are not changed here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '../http';
import { uploadAssetPhotos } from './assets';
import { assetsKey, invalidateAssetData, type MutationOptions } from './keys';
import type { AllocationPhoto } from './types';

/** The API keeps at most this many photos of one asset (services/assets photos.service MAX_ASSET_PHOTOS). */
export const MAX_ASSET_PHOTOS = 6;
/** A caption is one line of at most this many characters. */
export const MAX_PHOTO_CAPTION = 120;

/** GET /assets/:id/photos — the asset's own photos in display order. */
export function useAssetPhotos(assetId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: assetsKey('asset', assetId, 'photos'),
    queryFn: () => assetsApi.get<AllocationPhoto[]>(`/assets/${assetId}/photos`),
    enabled: !!assetId && enabled,
  });
}

export interface AddAssetPhotosVars {
  assetId: string;
  /** Already shrunk by the screen (compress-image.ts); the API shrinks again as a safety net. */
  files: File[];
  /** Optional caption for the first photo. */
  caption?: string;
}

/** POST /assets/:id/photos (kind ASSET). Refreshes the asset afterwards. */
export function useAddAssetPhoto(options?: MutationOptions<AllocationPhoto[], AddAssetPhotosVars>) {
  const qc = useQueryClient();
  return useMutation<AllocationPhoto[], Error, AddAssetPhotosVars>({
    ...options,
    mutationFn: ({ assetId, files, caption }) => {
      const form = new FormData();
      form.append('kind', 'ASSET');
      if (caption?.trim()) form.append('caption', caption.trim());
      for (const f of files) form.append('photos', f, f.name);
      return uploadAssetPhotos(assetId, form);
    },
    onSuccess: async (...args) => {
      await invalidateAssetData(qc);
      await options?.onSuccess?.(...args);
    },
  });
}

/** DELETE /assets/:id/photos/:photoId (asset photos only). */
export function useDeleteAssetPhoto(options?: MutationOptions<{ deleted: true }, { assetId: string; photoId: string }>) {
  const qc = useQueryClient();
  return useMutation<{ deleted: true }, Error, { assetId: string; photoId: string }>({
    ...options,
    mutationFn: ({ assetId, photoId }) => assetsApi.del<{ deleted: true }>(`/assets/${assetId}/photos/${photoId}`),
    onSuccess: async (...args) => {
      await invalidateAssetData(qc);
      await options?.onSuccess?.(...args);
    },
  });
}

/** PATCH /assets/:id/photos/:photoId — caption and/or position (0 = first, becomes the thumbnail). */
export function useUpdateAssetPhoto(options?: MutationOptions<AllocationPhoto, { assetId: string; photoId: string; caption?: string | null; sortOrder?: number }>) {
  const qc = useQueryClient();
  return useMutation<AllocationPhoto, Error, { assetId: string; photoId: string; caption?: string | null; sortOrder?: number }>({
    ...options,
    mutationFn: ({ assetId, photoId, ...body }) => assetsApi.patch<AllocationPhoto>(`/assets/${assetId}/photos/${photoId}`, body),
    onSuccess: async (...args) => {
      await invalidateAssetData(qc);
      await options?.onSuccess?.(...args);
    },
  });
}
