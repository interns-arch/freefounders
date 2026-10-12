/**
 * The punch selfie (PLAN.md §19.16, §19.17): JPEG, quality 0.6, longer side at most 720 px, handed to the web as a data
 * URL, which sends it in the punch's `photo` field. The app never computes a face descriptor (founder, 2026-10-12).
 */

/** A JPEG data URL from the camera's base64 (with or without a data: prefix already). */
export function jpegDataUrl(base64: string): string {
  const raw = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  return `data:image/jpeg;base64,${raw}`;
}

/** The size to shrink a photo to so its longer side is at most `max` px (never enlarges). */
export function fitWithin(width: number, height: number, max = 720): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!long || long <= max) return { width, height };
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}
