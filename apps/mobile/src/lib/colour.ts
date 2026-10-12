/** Small colour helpers for the company brand colour (a '#rrggbb' from the Settings Center). */

/** '#rrggbb' → [r, g, b] 0–255, or null when it is not a 6-digit hex colour. */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Text colour that reads on top of `hex`: white on dark/strong colours, near-black on light ones. */
export function readableOn(hex: string, dark = '#111e19', light = '#ffffff'): string {
  const bg = parseHex(hex);
  const fgDark = parseHex(dark);
  const fgLight = parseHex(light);
  if (!bg || !fgDark || !fgLight) return light;
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const L = luminance(bg);
  return contrast(L, luminance(fgLight)) >= contrast(L, luminance(fgDark)) ? light : dark;
}

/** '#rrggbb' + opacity (0–1) → '#rrggbbaa' (React Native reads 8-digit hex). */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}${a}`;
}
