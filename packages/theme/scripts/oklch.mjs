// oklch() → sRGB hex, for places that cannot read oklch (React Native). Björn Ottosson's OKLab matrices; colours outside
// sRGB are clipped per channel (our tokens are all inside or a hair outside it). No dependencies.

/** 'oklch(0.5 0.12 168)' or 'oklch(0.5 0.12 168 / 0.4)' → '#rrggbb' (or '#rrggbbaa' with an alpha below 1). */
export function oklchToHex(value) {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(String(value).trim());
  if (!m) throw new Error(`Not an oklch() colour: ${value}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1);
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const encode = (x) => {
    const c = Math.min(1, Math.max(0, x));
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  const hex = `#${linear.map(encode).join('')}`;
  return alpha < 1 ? hex + Math.round(alpha * 255).toString(16).padStart(2, '0') : hex;
}
