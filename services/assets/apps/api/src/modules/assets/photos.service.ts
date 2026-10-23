import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { type Actor, assertCan, canAny } from '../../common/actor';
import { badRequest, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { allocationPhotos, allocations, assets, PHOTO_KINDS } from '../../db/schema';
import { HistoryService } from '../../core/history.service';
import { shrinkPhoto, sniff } from './photo-shrink';

/** Raw size accepted per photo. Generous because every photo is shrunk before it is stored (PLAN.md §19.20). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 6;
/** Photos of the asset itself (kind ASSET, PLAN.md §19.34): at most this many per asset in total. */
export const MAX_ASSET_PHOTOS = 6;
export const MAX_CAPTION_LENGTH = 120;

/**
 * A caption as stored: one line of plain text, control characters dropped, at most MAX_CAPTION_LENGTH characters.
 * Screens render it as text (never HTML) and the sheet export neutralises a leading = + - @ (common/sheet.ts).
 */
export function cleanCaption(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw badRequest('Caption must be text', { caption: 'Invalid' });
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_CAPTION_LENGTH) throw badRequest(`Caption can be at most ${MAX_CAPTION_LENGTH} characters`, { caption: 'Too long' });
  return text || null;
}

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

type PhotoKind = (typeof PHOTO_KINDS)[number];

/**
 * At most this many photos are decoded at once on this server (each can take a few hundred MB while it is decoded),
 * so many uploads at the same moment wait their turn instead of running the server out of memory.
 */
const SHRINK_SLOTS = Math.max(1, Number(process.env.PHOTO_CONCURRENCY ?? 2));
let shrinking = 0;
const shrinkQueue: Array<() => void> = [];
async function inShrinkSlot<T>(fn: () => Promise<T>): Promise<T> {
  // A finished photo hands its slot straight to the next one waiting, so the limit holds exactly.
  if (shrinking >= SHRINK_SLOTS) await new Promise<void>((resolve) => shrinkQueue.push(resolve));
  else shrinking++;
  try {
    return await fn();
  } finally {
    const next = shrinkQueue.shift();
    if (next) next();
    else shrinking--;
  }
}

export const uploadDir = () => process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../../../../.data/uploads');

@Injectable()
export class PhotosService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
  ) {}

  /** Adding or removing photos of the asset itself takes the asset's own permissions (add or edit). */
  private assertCanEditAssetPhotos(actor: Actor) {
    if (!canAny(actor, 'asset:create', 'asset:edit')) assertCan(actor, 'asset:edit');
  }

  async upload(actor: Actor, assetId: string, allocationId: string | undefined, kind: string | undefined, files: UploadedPhoto[] | undefined, rawCaption?: unknown) {
    if (!files?.length) throw badRequest('Choose at least one photo', { photos: 'Required' });
    if (!PHOTO_KINDS.includes(kind as PhotoKind)) throw badRequest('Photo kind must be ASSET, HANDOVER or RETURN', { kind: 'Invalid' });
    const assetPhoto = kind === 'ASSET';
    const caption = assetPhoto ? cleanCaption(rawCaption) : null;
    if (assetPhoto) {
      this.assertCanEditAssetPhotos(actor);
    } else {
      assertCan(actor, 'asset:assign');
      if (!allocationId) throw badRequest('allocationId is required', { allocationId: 'Required' });
    }
    const detected = files.map((f) => sniff(f.buffer));
    if (detected.some((d) => !d)) throw badRequest('Only JPEG, PNG or WebP photos can be uploaded', { photos: 'Not an image' });

    const db = this.dbs.db;
    const [asset] = await db.select({ assetTag: assets.assetTag, name: assets.name }).from(assets).where(eq(assets.id, assetId));
    if (!asset) throw notFound('Asset');
    let alloc: typeof allocations.$inferSelect | null = null;
    let nextOrder = 0;
    if (assetPhoto) {
      const [{ n, top }] = await db
        .select({ n: sql<number>`count(*)::int`, top: sql<number>`coalesce(max(${allocationPhotos.sortOrder}), -1)::int` })
        .from(allocationPhotos)
        .where(and(eq(allocationPhotos.assetId, assetId), eq(allocationPhotos.kind, 'ASSET')));
      if (n + files.length > MAX_ASSET_PHOTOS) {
        const left = Math.max(0, MAX_ASSET_PHOTOS - n);
        throw badRequest(
          left ? `An asset can have at most ${MAX_ASSET_PHOTOS} photos: ${left} more can be added` : `An asset can have at most ${MAX_ASSET_PHOTOS} photos: remove one first`,
          { photos: 'Too many' },
        );
      }
      nextOrder = top + 1;
    } else {
      [alloc] = await db
        .select()
        .from(allocations)
        .where(and(eq(allocations.id, allocationId!), eq(allocations.assetId, assetId)));
      if (!alloc) throw notFound('Assignment');
    }

    const saved: (typeof allocationPhotos.$inferInsert)[] = [];
    // One at a time: a big phone photo needs a lot of memory while it is decoded.
    for (const [i, f] of files.entries()) {
      const photo = (await inShrinkSlot(() => shrinkPhoto(f.buffer, detected[i])))!;
      saved.push({
        assetId,
        allocationId: alloc?.id ?? null,
        kind: kind as PhotoKind,
        data: photo.buffer,
        fileName: `${randomUUID()}.${photo.ext}`,
        mimeType: photo.mime,
        sizeBytes: photo.buffer.length,
        uploadedBy: actor.userId,
        uploadedByName: actor.name,
        caption: i === 0 ? caption : null,
        sortOrder: assetPhoto ? nextOrder + i : 0,
      });
    }
    const inserted = await db.insert(allocationPhotos).values(saved).returning(PUBLIC_COLUMNS);
    const n = inserted.length;
    const label = assetPhoto ? 'asset' : kind === 'HANDOVER' ? 'handover' : 'return';
    await this.history.record(actor, {
      entityType: 'ASSET',
      entityId: assetId,
      entityLabel: `${asset.assetTag} · ${asset.name}`,
      action: assetPhoto ? 'ASSET_PHOTOS' : kind === 'HANDOVER' ? 'HANDOVER_PHOTOS' : 'RETURN_PHOTOS',
      summary: `${n} ${label} photo${n > 1 ? 's' : ''} saved${alloc ? ` (${alloc.holderName})` : ''}`,
      employeeId: alloc?.employeeId ?? null,
      metadata: { allocationId: alloc?.id ?? null, photoIds: inserted.map((p) => p.id) },
    });
    return inserted;
  }

  /** The asset's own photos (kind ASSET), in display order. */
  async forAsset(assetId: string) {
    const rows = await this.dbs.db
      .select(PUBLIC_COLUMNS)
      .from(allocationPhotos)
      .where(and(eq(allocationPhotos.assetId, assetId), eq(allocationPhotos.kind, 'ASSET')))
      .orderBy(asc(allocationPhotos.sortOrder), asc(allocationPhotos.createdAt));
    return rows;
  }

  /** GET /assets/:id/photos: the same list, 404 when there is no such asset here. */
  async listForAsset(assetId: string) {
    const [asset] = await this.dbs.db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId));
    if (!asset) throw notFound('Asset');
    return this.forAsset(assetId);
  }

  /** SQL for the id of an asset's first photo (its thumbnail in lists); null when it has none. */
  static firstPhotoId() {
    return sql<string | null>`(select p.id from allocation_photos p where p.asset_id = assets.id and p.kind = 'ASSET' order by p.sort_order asc, p.created_at asc limit 1)`;
  }

  private async assetPhoto(assetId: string, photoId: string) {
    const [photo] = await this.dbs.db
      .select(PUBLIC_COLUMNS)
      .from(allocationPhotos)
      .where(and(eq(allocationPhotos.id, photoId), eq(allocationPhotos.assetId, assetId)));
    if (!photo) throw notFound('Photo');
    if (photo.kind !== 'ASSET') throw new ForbiddenException('Handover and return photos are part of the assignment record and cannot be changed');
    return photo;
  }

  /** PATCH caption / order of one asset photo. Order: the photo moves to that position; the others shift. */
  async update(actor: Actor, assetId: string, photoId: string, body: { caption?: unknown; sortOrder?: unknown }) {
    this.assertCanEditAssetPhotos(actor);
    const photo = await this.assetPhoto(assetId, photoId);
    const patch: Partial<typeof allocationPhotos.$inferInsert> = {};
    if (body.caption !== undefined) patch.caption = cleanCaption(body.caption);
    const db = this.dbs.db;
    if (body.sortOrder !== undefined) {
      const pos = Number(body.sortOrder);
      if (!Number.isInteger(pos) || pos < 0 || pos >= MAX_ASSET_PHOTOS) throw badRequest('Order must be a position from 0', { sortOrder: 'Invalid' });
      const all = await this.forAsset(assetId);
      const order = all.filter((p) => p.id !== photoId);
      order.splice(Math.min(pos, order.length), 0, photo);
      for (const [i, p] of order.entries()) {
        if (p.sortOrder !== i) await db.update(allocationPhotos).set({ sortOrder: i }).where(eq(allocationPhotos.id, p.id));
      }
    }
    if (Object.keys(patch).length) await db.update(allocationPhotos).set(patch).where(eq(allocationPhotos.id, photoId));
    const [updated] = await db.select(PUBLIC_COLUMNS).from(allocationPhotos).where(eq(allocationPhotos.id, photoId));
    return updated;
  }

  /** DELETE one asset photo (kind ASSET only). An older on-disk file is removed after the row is gone. */
  async remove(actor: Actor, assetId: string, photoId: string) {
    this.assertCanEditAssetPhotos(actor);
    await this.assetPhoto(assetId, photoId);
    const db = this.dbs.db;
    const [asset] = await db.select({ assetTag: assets.assetTag, name: assets.name }).from(assets).where(eq(assets.id, assetId));
    if (!asset) throw notFound('Asset');
    const [gone] = await db
      .delete(allocationPhotos)
      .where(and(eq(allocationPhotos.id, photoId), eq(allocationPhotos.assetId, assetId), eq(allocationPhotos.kind, 'ASSET')))
      .returning({ id: allocationPhotos.id, fileName: allocationPhotos.fileName, hasData: sql<boolean>`${allocationPhotos.data} is not null` });
    if (!gone) throw notFound('Photo');
    if (!gone.hasData && /^[\w.-]+$/.test(gone.fileName) && !gone.fileName.startsWith('.')) await unlink(path.join(uploadDir(), gone.fileName)).catch(() => undefined);
    await this.history.record(actor, {
      entityType: 'ASSET',
      entityId: assetId,
      entityLabel: `${asset.assetTag} · ${asset.name}`,
      action: 'ASSET_PHOTO_REMOVED',
      summary: '1 asset photo removed',
      metadata: { photoId },
    });
    return { deleted: true };
  }

  async forAllocations(ids: string[]) {
    if (!ids.length) return new Map<string, PublicPhoto[]>();
    const rows = await this.dbs.db.select(PUBLIC_COLUMNS).from(allocationPhotos).where(inArray(allocationPhotos.allocationId, ids)).orderBy(asc(allocationPhotos.createdAt));
    const map = new Map<string, PublicPhoto[]>();
    for (const r of rows) if (r.allocationId) map.set(r.allocationId, [...(map.get(r.allocationId) ?? []), r]);
    return map;
  }

  async withPhotos<T extends { id: string }>(allocs: T[]) {
    const map = await this.forAllocations(allocs.map((a) => a.id));
    return allocs.map((a) => ({ ...a, photos: map.get(a.id) ?? [] }));
  }

  async file(assetId: string, photoId: string) {
    const [photo] = await this.dbs.db
      .select()
      .from(allocationPhotos)
      .where(and(eq(allocationPhotos.id, photoId), eq(allocationPhotos.assetId, assetId)));
    if (!photo) throw notFound('Photo');
    // Older rows keep the file on disk: only a plain file name inside UPLOAD_DIR is ever read (never a path).
    const onDisk = () => (/^[\w.-]+$/.test(photo.fileName) && !photo.fileName.startsWith('.') ? readFile(path.join(uploadDir(), photo.fileName)).catch(() => null) : null);
    return { data: photo.data ?? (await onDisk()), mimeType: photo.mimeType };
  }
}

const PUBLIC_COLUMNS = {
  id: allocationPhotos.id,
  assetId: allocationPhotos.assetId,
  allocationId: allocationPhotos.allocationId,
  kind: allocationPhotos.kind,
  mimeType: allocationPhotos.mimeType,
  uploadedByName: allocationPhotos.uploadedByName,
  caption: allocationPhotos.caption,
  sortOrder: allocationPhotos.sortOrder,
  createdAt: allocationPhotos.createdAt,
};

type PublicPhoto = {
  id: string;
  assetId: string;
  allocationId: string | null;
  kind: PhotoKind;
  mimeType: string;
  uploadedByName: string | null;
  caption: string | null;
  sortOrder: number;
  createdAt: Date;
};
