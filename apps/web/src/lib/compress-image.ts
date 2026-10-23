/**
 * Smaller photos before they are uploaded (PLAN.md §19.20): a phone photo of 3–10 MB goes up as a few hundred KB, which
 * matters on a slow connection. Used for every image the web app uploads (it is also the Android app, a WebView).
 *
 * The image is decoded upright (EXIF orientation applied), scaled so its longest side fits the preset, and re-encoded as
 * WebP (JPEG where the browser cannot encode WebP). Re-encoding drops all metadata, the photo's GPS position included.
 * Anything that is not a photo (PDF, spreadsheet, GIF, SVG, a HEIC the browser cannot read) comes back untouched, and so
 * does a photo the re-encode would not make smaller. The servers shrink again as a safety net for other clients.
 */

export type CompressPreset = 'selfie' | 'photo' | 'document';

export interface CompressOptions {
  /** Longest side in px. */
  maxSide: number;
  /** 0–1. */
  quality: number;
  /** Encode as this type; default WebP when the browser can, else JPEG. */
  type?: 'image/webp' | 'image/jpeg';
}

export const COMPRESS_PRESETS: Record<CompressPreset, CompressOptions> = {
  // Punch photos are stored and served as JPEG.
  selfie: { maxSide: 720, quality: 0.65, type: 'image/jpeg' },
  // Asset, handover, return and ticket photos.
  photo: { maxSide: 1600, quality: 0.72 },
  // Images attached as documents (task files, leave and lead documents, form uploads): text stays readable.
  document: { maxSide: 2000, quality: 0.8 },
};

const SKIP_TYPES = /^image\/(gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;
/** Files this module produced: compressing one again would only lose quality. */
const done = new WeakMap<Blob, number>();

/** The size of the picked file before it was compressed, or undefined when it was not. */
export function originalSize(file: Blob): number | undefined {
  return done.get(file);
}

/** "1.2 MB", "180 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function compressImage(input: File, opts?: CompressPreset | CompressOptions): Promise<File>;
export function compressImage(input: Blob, opts?: CompressPreset | CompressOptions): Promise<Blob>;
export function compressImage(input: string, opts?: CompressPreset | CompressOptions): Promise<string>;
export async function compressImage(input: File | Blob | string, opts: CompressPreset | CompressOptions = 'photo'): Promise<File | Blob | string> {
  const o = typeof opts === 'string' ? COMPRESS_PRESETS[opts] : opts;
  try {
    if (typeof input === 'string') {
      if (!input.startsWith('data:image/')) return input;
      const blob = dataUrlToBlob(input);
      const out = await shrink(blob, o);
      return out === blob ? input : await blobToDataUrl(out);
    }
    const out = await shrink(input, o);
    if (out === input) return input;
    let result: Blob = out;
    if (input instanceof File) {
      const ext = out.type === 'image/webp' ? 'webp' : 'jpg';
      result = new File([out], `${input.name.replace(/\.[^./\\]+$/, '') || 'photo'}.${ext}`, { type: out.type, lastModified: input.lastModified });
    }
    done.set(result, input.size);
    return result;
  } catch {
    return input; // never block an upload: the server shrinks it instead
  }
}

/** Several picked files: images compressed (in turn, to keep memory low on phones), the rest as they are. */
export async function compressImages(files: File[], opts: CompressPreset | CompressOptions = 'photo'): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) out.push(await compressImage(f, opts));
  return out;
}

async function shrink(blob: Blob, o: CompressOptions): Promise<Blob> {
  if (done.has(blob)) return blob;
  if (blob.type && (!blob.type.startsWith('image/') || SKIP_TYPES.test(blob.type))) return blob;
  if (!blob.type && !(await looksLikePhoto(blob))) return blob;

  const img = await decode(blob);
  try {
    const scale = Math.min(1, o.maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    let type = o.type ?? ((await canEncodeWebp()) ? 'image/webp' : 'image/jpeg');
    let out = await encode(img.source, w, h, type, o.quality);
    if (out && out.type !== type) {
      // The browser ignored the type (no WebP encoder): JPEG instead.
      type = 'image/jpeg';
      out = await encode(img.source, w, h, type, o.quality);
    }
    return out && out.type === type && out.size < blob.size ? out : blob;
  } finally {
    img.close();
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Older browsers reject the options or the format: try an <img>, which also applies EXIF orientation.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function encode(source: CanvasImageSource, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  const draw = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    if (type === 'image/jpeg') {
      ctx.fillStyle = 'white'; // transparent parts of a PNG become white, not black
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
  };
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        draw(ctx);
        return await canvas.convertToBlob({ type, quality });
      }
    } catch {
      // Some browsers have OffscreenCanvas without 2D or without convertToBlob: use a normal canvas.
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webp: Promise<boolean> | null = null;
function canEncodeWebp(): Promise<boolean> {
  webp ??= (async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.5));
      return blob?.type === 'image/webp';
    } catch {
      return false;
    }
  })();
  return webp;
}

/** A file without a type (some Android pickers): only JPEG, PNG and WebP are tried. */
async function looksLikePhoto(blob: Blob): Promise<boolean> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && ascii(1, 4) === 'PNG') || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP');
}

/** A data: URL (e.g. a photo from the phone app's camera) as a Blob. */
export function dataUrlToBlob(url: string): Blob {
  const [head, body = ''] = url.split(',', 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? '';
  const bin = head.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
