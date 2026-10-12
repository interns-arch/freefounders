// compressImage (apps/web/src/lib/compress-image.ts, PLAN.md §19.20) in a real browser canvas: big photos shrink to the
// preset, anything that is not a photo passes through untouched. Loads the module from the running web app (Vite dev).
import { expect, test } from '@playwright/test';

type Result = { type: string; name?: string; width: number; height: number; before: number; after: number; same: boolean };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ type: 'module', content: "import * as m from '/src/lib/compress-image.ts'; window.ffCompress = m;" });
  await page.waitForFunction(() => 'ffCompress' in window);
});

test('a 3000×2000 photo shrinks to at most 1600 px and far fewer bytes; a PDF passes through', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { compressImage } = (window as unknown as { ffCompress: typeof import('../apps/web/src/lib/compress-image') }).ffCompress;
    // A photo-like picture: gradients with a little grain.
    const canvas = new OffscreenCanvas(3000, 2000);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(3000, 2000);
    for (let i = 0; i < img.data.length; i += 4) {
      const p = i / 4;
      const x = p % 3000;
      const y = Math.floor(p / 3000);
      const grain = (Math.random() - 0.5) * 30;
      img.data[i] = (x / 3000) * 255 + grain;
      img.data[i + 1] = (y / 2000) * 255 + grain;
      img.data[i + 2] = 128 + grain;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const measure = async (input: Blob, out: Blob, name?: string) => {
      const bmp = await createImageBitmap(out);
      return { type: out.type, name, width: bmp.width, height: bmp.height, before: input.size, after: out.size, same: input === out };
    };
    const out: Record<string, Result> = {};
    for (const type of ['image/png', 'image/jpeg'] as const) {
      const blob = await canvas.convertToBlob({ type, quality: 0.95 });
      const file = new File([blob], `IMG_0001.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
      const small = await compressImage(file, 'photo');
      out[type] = await measure(file, small, small.name);
    }
    const doc = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const asDoc = await compressImage(new File([doc], 'scan.jpg', { type: 'image/jpeg' }), 'document');
    out.document = await measure(doc, asDoc);
    // The punch selfie: a data URL in, a ≤ 720 px JPEG data URL out.
    const camera = new OffscreenCanvas(1280, 960);
    camera.getContext('2d')!.drawImage(canvas, 0, 0, 1280, 960);
    const still = await camera.convertToBlob({ type: 'image/png' });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(still);
    });
    const selfie = await compressImage(dataUrl, 'selfie');
    const selfieBlob = await (await fetch(selfie)).blob();
    out.selfie = await measure(still, selfieBlob);

    const pdf = new File(['%PDF-1.7 a document'], 'quote.pdf', { type: 'application/pdf' });
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'a.gif', { type: 'image/gif' });
    return { out, pdfSame: (await compressImage(pdf, 'document')) === pdf, gifSame: (await compressImage(gif, 'photo')) === gif };
  });

  for (const type of ['image/png', 'image/jpeg']) {
    const r = results.out[type];
    expect(Math.max(r.width, r.height), type).toBe(1600);
    expect(r.height, type).toBe(1067);
    expect(r.after, `${type}: ${r.before} → ${r.after}`).toBeLessThan(r.before / 4);
    expect(r.type).toBe('image/webp'); // Chromium encodes WebP
    expect(r.name).toBe('IMG_0001.webp');
  }
  expect(Math.max(results.out.document.width, results.out.document.height)).toBe(2000);
  expect(results.out.selfie.type).toBe('image/jpeg');
  expect(Math.max(results.out.selfie.width, results.out.selfie.height)).toBe(720);
  expect(results.pdfSame).toBe(true);
  expect(results.gifSame).toBe(true);
});
