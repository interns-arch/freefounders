import { Camera, ChevronLeft, ChevronRight, Download, ImagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { api } from '@/lib/api';
import { withBase } from '@/lib/platform';
import type { AllocationPhoto } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';

const MAX_PHOTOS = 6;
const MAX_EDGE = 1600;

/** Phone photos are 3–10 MB; shrink to a 1600px JPEG (~300 KB) before upload. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadPhotos(assetId: string, allocationId: string | null, kind: AllocationPhoto['kind'], files: File[]) {
  const form = new FormData();
  if (allocationId) form.append('allocationId', allocationId);
  form.append('kind', kind);
  for (const f of files) form.append('photos', await compress(f), f.name.replace(/\.\w+$/, '') + '.jpg');
  return api.upload<AllocationPhoto[]>(`/assets/${assetId}/photos`, form);
}

const KIND_LABEL: Record<AllocationPhoto['kind'], string> = { ASSET: 'Asset', HANDOVER: 'Handover', RETURN: 'Return' };

export const photoUrl = (p: Pick<AllocationPhoto, 'assetId' | 'id'>) => withBase(`/api/assets/${p.assetId}/photos/${p.id}`);

/** Camera / gallery picker with previews. On phones the file input offers "Take photo". */
export function PhotoPicker({ files, onChange, hint }: { files: File[]; onChange: (files: File[]) => void; hint?: string }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {previews.map((src, i) => (
          <div key={src} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
            <img src={src} alt="" className="size-full object-cover" />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {files.length < MAX_PHOTOS && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary">
            {files.length ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
            <span className="text-[11px] font-medium">{files.length ? 'Add' : 'Photo'}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/') || !f.type);
                onChange([...files, ...picked].slice(0, MAX_PHOTOS));
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint ?? `Optional · up to ${MAX_PHOTOS} photos of the asset's condition`}</p>
    </div>
  );
}

/** Thumbnails of saved handover / return photos; tap to view full size. */
export function PhotoStrip({ photos, className, size = 'md' }: { photos: AllocationPhoto[] | undefined; className?: string; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos?.length) return null;
  const current = open === null ? null : photos[open];
  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            title={`${KIND_LABEL[p.kind]} photo`}
            className={cn('relative shrink-0 cursor-pointer overflow-hidden rounded-md border bg-muted transition hover:ring-2 hover:ring-primary/40', size === 'sm' ? 'size-9' : 'size-14')}
          >
            <img src={photoUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
            {p.kind !== 'ASSET' && (
              <span className={cn('absolute inset-x-0 bottom-0 text-center text-[9px] font-semibold leading-3 text-white', p.kind === 'HANDOVER' ? 'bg-blue-600/80' : 'bg-emerald-600/80')}>
                {size === 'md' ? (p.kind === 'HANDOVER' ? 'OUT' : 'IN') : ''}
              </span>
            )}
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>{KIND_LABEL[current.kind]} photo</DialogTitle>
                <DialogDescription>
                  {formatDateTime(current.createdAt)}
                  {current.uploadedByName ? ` · by ${current.uploadedByName}` : ''} · {open! + 1} of {photos.length}
                </DialogDescription>
              </DialogHeader>
              <div className="relative">
                <img src={photoUrl(current)} alt="" className="max-h-[70vh] w-full rounded-lg bg-muted object-contain" />
                <Button asChild size="sm" variant="secondary" className="absolute right-2 bottom-2 shadow">
                  <a href={photoUrl(current)} download={`${current.kind.toLowerCase()}-photo-${current.createdAt.slice(0, 10)}-${open! + 1}.jpg`}>
                    <Download /> Download
                  </a>
                </Button>
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
