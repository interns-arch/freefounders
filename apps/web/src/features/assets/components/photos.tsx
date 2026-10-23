import { Camera, ChevronLeft, ChevronRight, Download, ImageIcon, ImagePlus, Trash2, X } from '@/components/icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useConfirm } from '@/components/common/confirm';
import { errorMessage } from '@freefounders/core';
import { MAX_ASSET_PHOTOS, MAX_PHOTO_CAPTION, photoUrl, uploadAssetPhotos, useAddAssetPhoto, useDeleteAssetPhoto } from '@freefounders/core/assets';
import type { AllocationPhoto } from '@freefounders/core/assets';
import { compressImage, compressImages, dataUrlToBlob, formatBytes, originalSize } from '@/lib/compress-image';
import { AppRequestError, appRequest, isInApp } from '@/lib/native-bridge';
import { cn, formatDateTime } from '@/lib/utils';

const MAX_PHOTOS = MAX_ASSET_PHOTOS;

/** Shrinks the photos (≤ 1600 px, PLAN.md §19.20) unless the picker already did, then uploads them. */
export async function uploadPhotos(assetId: string, allocationId: string | null, kind: AllocationPhoto['kind'], files: File[]) {
  const form = new FormData();
  if (allocationId) form.append('allocationId', allocationId);
  form.append('kind', kind);
  for (const f of await compressImages(files, 'photo')) form.append('photos', f, f.name);
  return uploadAssetPhotos(assetId, form);
}

/**
 * In the phone app: the phone's own camera (back camera, PLAN.md §19.34) through the bridge. The JPEG comes back as a
 * data URL and is shrunk like a picked file. Null when the person closed the camera.
 */
export async function takeAppPhoto(title = 'Asset photo'): Promise<File | null> {
  try {
    const dataUrl = await appRequest<string | null>('photo', { title, optional: false, facing: 'back' });
    if (!dataUrl) return null;
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
    return await compressImage(file, 'photo');
  } catch (e) {
    if (e instanceof AppRequestError && e.code === 'cancelled') return null;
    throw e;
  }
}

const KIND_LABEL: Record<AllocationPhoto['kind'], string> = { ASSET: 'Asset', HANDOVER: 'Handover', RETURN: 'Return' };
const PHOTO_EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

const onlyImages = (list: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || !f.type);

/** Previews of picked (not yet uploaded) photos, each with a remove button. */
function PickedGrid({ files, onRemove, children }: { files: File[]; onRemove: (index: number) => void; children?: ReactNode }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {previews.map((src, i) => (
        <div key={src} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
          <img src={src} alt="" className="size-full object-cover" />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onRemove(i)}
            className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {children}
    </div>
  );
}

/**
 * Picks photos and shrinks them as soon as they are picked, so the upload later is quick (PLAN.md §19.20). Each picked
 * photo shows at once and is swapped for its smaller copy when that is ready; a photo sent before that is shrunk by
 * uploadPhotos. In the phone app a "Take photo" tile opens the phone's camera through the bridge.
 */
export function usePickPhotos(files: File[], onChange: (files: File[]) => void, max = MAX_PHOTOS) {
  const latest = useRef(files);
  latest.current = files;
  const [opening, setOpening] = useState(false);
  const add = (picked: File[]) => {
    if (!picked.length) return;
    onChange([...latest.current, ...picked].slice(0, max));
    void compressImages(picked, 'photo').then((small) => {
      const swap = new Map(picked.map((f, i) => [f, small[i]]));
      if (latest.current.some((f) => swap.get(f) !== undefined && swap.get(f) !== f)) onChange(latest.current.map((f) => swap.get(f) ?? f));
    });
  };
  const takeInApp = async () => {
    setOpening(true);
    try {
      const file = await takeAppPhoto();
      if (file) onChange([...latest.current, file].slice(0, max));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOpening(false);
    }
  };
  return { add, takeInApp, opening, full: files.length >= max };
}

/** Camera / gallery picker with previews. On phones the file input offers "Take photo"; in the app a camera tile too. */
export function PhotoPicker({ files, onChange, hint, max = MAX_PHOTOS }: { files: File[]; onChange: (files: File[]) => void; hint?: string; max?: number }) {
  const pick = usePickPhotos(files, onChange, max);
  const inApp = isInApp();
  const before = files.reduce((n, f) => n + (originalSize(f) ?? f.size), 0);
  const after = files.reduce((n, f) => n + f.size, 0);
  const tile = 'flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary';

  return (
    <div>
      <PickedGrid files={files} onRemove={(i) => onChange(files.filter((_, j) => j !== i))}>
        {!pick.full && inApp && (
          <button type="button" className={tile} onClick={() => void pick.takeInApp()} disabled={pick.opening}>
            <Camera className="size-5" />
            <span className="text-xs font-medium">{pick.opening ? 'Opening…' : 'Take photo'}</span>
          </button>
        )}
        {!pick.full && (
          <label className={tile}>
            {files.length || inApp ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
            <span className="text-xs font-medium">{inApp ? 'Gallery' : files.length ? 'Add' : 'Photo'}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                pick.add(onlyImages(e.target.files));
                e.target.value = '';
              }}
            />
          </label>
        )}
      </PickedGrid>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {hint ?? `Optional · up to ${max} photos of the asset's condition`}
        {after < before && <span data-testid="photo-saving"> · {formatBytes(before)} → {formatBytes(after)}</span>}
      </p>
    </div>
  );
}

/**
 * "Add photos of this asset" (PLAN.md §19.34): shown right after an asset is added, and from "Add photo" on the asset
 * page or edit form. Take photo (the phone's camera: the bridge in the app, the file input's camera in a browser) ·
 * Choose from gallery · Skip. The photos are uploaded together when "Save" is pressed.
 */
export function AssetPhotosDialog({
  assetId,
  assetLabel,
  existing = 0,
  open,
  onOpenChange,
  onDone,
  skipLabel = 'Skip',
}: {
  assetId: string;
  assetLabel?: string;
  /** Photos the asset already has: the dialog takes at most MAX_ASSET_PHOTOS - existing more. */
  existing?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the photos are saved, or when the person skips (saved = how many were added). */
  onDone?: (saved: number) => void;
  skipLabel?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const room = Math.max(0, MAX_PHOTOS - existing);
  const pick = usePickPhotos(files, setFiles, room);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const inApp = isInApp();
  const add = useAddAssetPhoto();
  const close = (saved: number) => {
    setFiles([]);
    setCaption('');
    onOpenChange(false);
    onDone?.(saved);
  };
  const save = async () => {
    try {
      const saved = await add.mutateAsync({ assetId, files, caption: caption || undefined });
      toast.success(`${saved.length} photo${saved.length > 1 ? 's' : ''} saved`);
      close(saved.length);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !add.isPending && close(0)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add photos of this asset</DialogTitle>
          <DialogDescription>
            {assetLabel ? `${assetLabel} · ` : ''}
            {room ? `Up to ${room} more photo${room > 1 ? 's' : ''} (${MAX_PHOTOS} per asset).` : `This asset already has ${MAX_PHOTOS} photos. Remove one to add another.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {files.length > 0 && <PickedGrid files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pick.full || pick.opening}
              onClick={() => (inApp ? void pick.takeInApp() : cameraInput.current?.click())}
            >
              <Camera /> {pick.opening ? 'Opening…' : 'Take photo'}
            </Button>
            <Button type="button" variant="outline" disabled={pick.full} onClick={() => galleryInput.current?.click()}>
              <ImageIcon /> Choose from gallery
            </Button>
            {/* capture = the camera straight away on a phone; a computer shows its usual file picker. */}
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Photo from the camera"
              tabIndex={-1}
              onChange={(e) => {
                pick.add(onlyImages(e.target.files));
                e.target.value = '';
              }}
            />
            <input
              ref={galleryInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Photos from the gallery"
              tabIndex={-1}
              onChange={(e) => {
                pick.add(onlyImages(e.target.files));
                e.target.value = '';
              }}
            />
          </div>
          {files.length > 0 && (
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_PHOTO_CAPTION))}
              placeholder="Caption for the first photo (optional)"
              aria-label="Caption"
              maxLength={MAX_PHOTO_CAPTION}
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(0)} disabled={add.isPending}>
            {skipLabel}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!files.length} loading={add.isPending}>
            {files.length > 1 ? `Save ${files.length} photos` : 'Save photo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Thumbnails of saved photos; tap to view full size. With `onDelete`, asset photos can be removed from the viewer. */
export function PhotoStrip({
  photos,
  className,
  size = 'md',
  onDelete,
}: {
  photos: AllocationPhoto[] | undefined;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Removes an asset photo (kind ASSET); shown only to those who may edit the asset. */
  onDelete?: (photo: AllocationPhoto) => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  if (!photos?.length) return null;
  const current = open === null ? null : (photos[open] ?? null);
  const remove = async (p: AllocationPhoto) => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(p);
      setOpen(null);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            title={p.caption ? `${KIND_LABEL[p.kind]} photo · ${p.caption}` : `${KIND_LABEL[p.kind]} photo`}
            className={cn(
              'relative shrink-0 cursor-pointer overflow-hidden rounded-md border bg-muted transition hover:ring-2 hover:ring-primary/40',
              size === 'sm' ? 'size-9' : size === 'lg' ? 'size-20 sm:size-24' : 'size-14',
            )}
          >
            <img src={photoUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
            {p.kind !== 'ASSET' && (
              <span className={cn('absolute inset-x-0 bottom-0 text-center text-[9px] font-semibold leading-3 text-white', p.kind === 'HANDOVER' ? 'bg-info/80' : 'bg-success/80')}>
                {size === 'md' ? (p.kind === 'HANDOVER' ? 'OUT' : 'IN') : ''}
              </span>
            )}
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && !deleting && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>{current.caption || `${KIND_LABEL[current.kind]} photo`}</DialogTitle>
                <DialogDescription>
                  {formatDateTime(current.createdAt)}
                  {current.uploadedByName ? ` · by ${current.uploadedByName}` : ''} · {open! + 1} of {photos.length}
                </DialogDescription>
              </DialogHeader>
              <div className="relative">
                <img src={photoUrl(current)} alt={current.caption ?? ''} className="max-h-[70vh] w-full rounded-lg bg-muted object-contain" />
                <div className="absolute right-2 bottom-2 flex gap-2">
                  {onDelete && current.kind === 'ASSET' && (
                    <Button size="sm" variant="destructive" className="shadow" onClick={() => void remove(current)} loading={deleting}>
                      <Trash2 /> Delete
                    </Button>
                  )}
                  <Button asChild size="sm" variant="secondary" className="shadow">
                    <a href={photoUrl(current)} download={`${current.kind.toLowerCase()}-photo-${current.createdAt.slice(0, 10)}-${open! + 1}.${PHOTO_EXT[current.mimeType ?? ''] ?? 'jpg'}`}>
                      <Download /> Download
                    </a>
                  </Button>
                </div>
                {photos.length > 1 && (
                  <>
                    <Button size="icon-sm" variant="outline" className="absolute top-1/2 left-2 -translate-y-1/2" aria-label="Previous" onClick={() => setOpen((open! - 1 + photos.length) % photos.length)}>
                      <ChevronLeft />
                    </Button>
                    <Button size="icon-sm" variant="outline" className="absolute top-1/2 right-2 -translate-y-1/2" aria-label="Next" onClick={() => setOpen((open! + 1) % photos.length)}>
                      <ChevronRight />
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Deletes an asset photo after a confirmation; shared by the asset page and the edit form. */
export function useRemoveAssetPhoto(assetId: string) {
  const confirm = useConfirm();
  const del = useDeleteAssetPhoto();
  return async (p: AllocationPhoto) => {
    const r = await confirm({ title: 'Delete this photo?', description: 'It is removed from the asset for everyone. This cannot be undone.', destructive: true, confirmText: 'Delete photo' });
    if (!r) return;
    try {
      await del.mutateAsync({ assetId, photoId: p.id });
      toast.success('Photo deleted');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

/**
 * The asset's photo gallery (asset page and edit form): thumbnails with the viewer, "Add photo" and delete for those
 * who may edit the asset.
 */
export function AssetPhotos({
  assetId,
  assetLabel,
  photos,
  canEdit,
  allowAdd = true,
  size = 'lg',
  className,
}: {
  assetId: string;
  assetLabel?: string;
  photos: AllocationPhoto[];
  canEdit: boolean;
  /** false = no "Add photo" button here (the edit form has its own picker). */
  allowAdd?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const remove = useRemoveAssetPhoto(assetId);
  const full = photos.length >= MAX_PHOTOS;
  return (
    <div className={cn('space-y-3', className)}>
      {photos.length ? (
        <PhotoStrip photos={photos} size={size} onDelete={canEdit ? remove : undefined} />
      ) : (
        <p className="text-sm text-muted-foreground">{canEdit ? 'No photos yet. Add a few so everyone can see what it looks like.' : 'No photos yet.'}</p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {allowAdd && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} disabled={full}>
              <Camera /> Add photo
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {photos.length} of {MAX_PHOTOS}
            {full ? ' · remove one to add another' : ''}
          </span>
        </div>
      )}
      {canEdit && allowAdd && <AssetPhotosDialog assetId={assetId} assetLabel={assetLabel} existing={photos.length} open={adding} onOpenChange={setAdding} skipLabel="Cancel" />}
    </div>
  );
}

/** The "Photos" card on the asset page. */
export function AssetPhotosCard({ assetId, assetLabel, photos, canEdit }: { assetId: string; assetLabel?: string; photos: AllocationPhoto[]; canEdit: boolean }) {
  if (!photos.length && !canEdit) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos{photos.length ? ` (${photos.length})` : ''}</CardTitle>
      </CardHeader>
      <CardContent>
        <AssetPhotos assetId={assetId} assetLabel={assetLabel} photos={photos} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
