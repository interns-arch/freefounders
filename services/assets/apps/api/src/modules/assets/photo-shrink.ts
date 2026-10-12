// How a photo is stored (PLAN.md §19.20). No Nest or database here, so scripts/compress-uploads.mjs can use it too.
import sharp from 'sharp';

/** Stored photos: longest side at most 1600 px, quality 72 (PLAN.md §19.20). */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 72;

/** A photo that already fits is only re-encoded when that saves at least 10%: re-encoding a small JPEG costs quality. */
const MIN_SAVING = 0.1;

sharp.cache(false); // photos are one-off: keep the server's memory for requests

/** Identifies the image from its bytes; the browser-supplied MIME type is not trusted. */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/**
 * A photo as it is stored (PLAN.md §19.20): turned upright from its EXIF orientation, at most 1600 px on its longest side,
 * re-encoded (WebP stays WebP, everything else becomes a mozjpeg JPEG on white), with all metadata (GPS included) dropped.
 * The upload is kept as sent when that is not smaller (at least 10% for a photo that already fits), or when it cannot be
 * decoded.
 */
export async function shrinkPhoto(buf: Buffer, type: { mime: string; ext: string } | null = sniff(buf)): Promise<{ buffer: Buffer; mime: string; ext: string } | null> {
  if (!type) return null;
  try {
    const meta = await sharp(buf, { limitInputPixels: 120_000_000 }).metadata();
    const tooBig = Math.max(meta.width ?? 0, meta.height ?? 0) > PHOTO_MAX_SIDE;
    const img = sharp(buf, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    const webp = type.ext === 'webp';
    const out = webp
      ? await img.webp({ quality: PHOTO_QUALITY }).toBuffer()
      : await img.flatten({ background: '#ffffff' }).jpeg({ quality: PHOTO_QUALITY, mozjpeg: true }).toBuffer();
    if (out.length < (tooBig ? buf.length : buf.length * (1 - MIN_SAVING))) return { buffer: out, mime: webp ? 'image/webp' : 'image/jpeg', ext: webp ? 'webp' : 'jpg' };
  } catch {
    // Not decodable (or a format sharp refuses): stored as sent, like before.
  }
  return { buffer: buf, ...type };
}
