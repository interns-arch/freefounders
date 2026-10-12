/*
 * A company's brand colour (Settings Center) as readable theme colours (WCAG AA, 4.5:1).
 *
 * The brand colour replaces --primary, which is used for button fills (white text on it in light mode, dark text in
 * dark mode) and for text and icons on cards (links, active tabs, pills). A light brand colour such as a sky blue
 * would leave white button text and blue links at about 2.4:1. So --primary keeps the brand's hue and chroma but its
 * lightness is moved just enough for 4.5:1: darker in light mode, lighter in dark mode. --brand-2 (gradients,
 * highlights, the sidebar marker) and --ring keep the colour exactly as chosen. A colour that already passes is used
 * unchanged.
 */

type Lch = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function parseHex(colour: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

function linearToOklch([r, g, b]: [number, number, number]): Lch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/** Relative luminance of an OKLCH colour after clipping to sRGB (what the screen shows). */
function luminance([L, C, H]: Lch): number {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const ratio = (y1: number, y2: number) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

/** A little above 4.5:1, so rounding never lands under it. */
const TARGET = 4.6;
/** Luminance of white (light-mode cards and button text) and of the dark theme's cards (tokens.css .dark --card). */
const WHITE_Y = 1;
const DARK_CARD_Y = 0.0075;

const css = ([L, C, H]: Lch) => `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;

export interface BrandColours {
  /** The colour as chosen (--brand-2, --ring). */
  raw: string;
  /** --primary in light mode (white text on it, and text on white cards, reach 4.5:1). */
  light: string;
  /** --primary in dark mode (readable on the dark cards, and dark text on it). */
  dark: string;
  /** True when the chosen colour had to be darkened or lightened for one of the modes. */
  adjusted: boolean;
}

export function brandColours(colour: string | null | undefined): BrandColours | null {
  if (!colour) return null;
  const rgb = parseHex(colour);
  if (!rgb) return { raw: colour, light: colour, dark: colour, adjusted: false };
  const lch = linearToOklch(rgb);
  const [L, C, H] = lch;

  let light = colour;
  if (ratio(WHITE_Y, luminance(lch)) < TARGET) {
    let lo = 0;
    let hi = L;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(WHITE_Y, luminance([mid, C, H])) >= TARGET) lo = mid;
      else hi = mid;
    }
    light = css([lo, C, H]);
  }

  let dark = colour;
  if (ratio(luminance(lch), DARK_CARD_Y) < TARGET) {
    let lo = L;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(luminance([mid, C, H]), DARK_CARD_Y) >= TARGET) hi = mid;
      else lo = mid;
    }
    dark = css([hi, C, H]);
  }

  return { raw: colour, light, dark, adjusted: light !== colour || dark !== colour };
}

/** The style sheet that puts the brand colour into both themes (one <style> element, see useBrandColour). */
export function brandCss(colour: string | null | undefined): string {
  const b = brandColours(colour);
  if (!b) return '';
  return (
    `html:root{--brand-2:${b.raw};--ring:${b.raw};--primary:${b.light};}` +
    `html.dark{--primary:${b.dark};}`
  );
}
