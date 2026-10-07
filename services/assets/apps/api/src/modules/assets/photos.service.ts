import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type Actor, assertCan, canAny } from '../../common/actor';
import { badRequest, notFound } from '../../common/http';
import { DbService } from '../../db/db.service';
import { allocationPhotos, allocations, assets, PHOTO_KINDS } from '../../db/schema';
import { HistoryService } from '../../core/history.service';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 6;

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

type PhotoKind = (typeof PHOTO_KINDS)[number];

export const uploadDir = () => process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../../../../.data/uploads');

/** Identifies the image from its bytes; the browser-supplied MIME type is not trusted. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

@Injectable()
export class PhotosService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
  ) {}

  async upload(actor: Actor, assetId: string, allocationId: string | undefined, kind: string | undefined, files: UploadedPhoto[] | undefined) {
    if (!files?.length) throw badRequest('Choose at least one photo', { photos: 'Required' });
    if (!PHOTO_KINDS.includes(kind as PhotoKind)) throw badRequest('Photo kind must be ASSET, HANDOVER or RETURN', { kind: 'Invalid' });
    const assetPhoto = kind === 'ASSET';
    if (assetPhoto) {
      if (!canAny(actor, 'asset:create', 'asset:edit')) assertCan(actor, 'asset:edit');
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
    if (!assetPhoto) {
      [alloc] = await db
        .select()
        .from(allocations)
        .where(and(eq(allocations.id, allocationId!), eq(allocations.assetId, assetId)));
      if (!alloc) throw notFound('Assignment');
    }

    const saved: (typeof allocationPhotos.$inferInsert)[] = files.map((f, i) => {
      const type = detected[i]!;
      return {
        assetId,
        allocationId: alloc?.id ?? null,
        kind: kind as PhotoKind,
        data: f.buffer,
        fileName: `${randomUUID()}.${type.ext}`,
        mimeType: type.mime,
        sizeBytes: f.size,
        uploadedBy: actor.userId,
        uploadedByName: actor.name,
      };
    });
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

  async forAsset(assetId: string) {
    const rows = await this.dbs.db
      .select(PUBLIC_COLUMNS)
      .from(allocationPhotos)
      .where(and(eq(allocationPhotos.assetId, assetId), eq(allocationPhotos.kind, 'ASSET')))
      .orderBy(asc(allocationPhotos.createdAt));
    return rows;
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
    return { data: photo.data ?? (await readFile(path.join(uploadDir(), photo.fileName)).catch(() => null)), mimeType: photo.mimeType };
  }
}

const PUBLIC_COLUMNS = {
  id: allocationPhotos.id,
  assetId: allocationPhotos.assetId,
  allocationId: allocationPhotos.allocationId,
  kind: allocationPhotos.kind,
  uploadedByName: allocationPhotos.uploadedByName,
  createdAt: allocationPhotos.createdAt,
};

type PublicPhoto = { id: string; assetId: string; allocationId: string | null; kind: PhotoKind; uploadedByName: string | null; createdAt: Date };
