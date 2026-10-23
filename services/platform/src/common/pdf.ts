/**
 * A small PDF writer without a library (PLAN.md §19.31): A4 pages, the standard Helvetica fonts (WinAnsi), text,
 * lines, filled boxes and a drawn rupee sign (₹ is not in WinAnsi, so it is a vector glyph, not text).
 * Enough for a GST invoice; nothing is embedded, so files stay a few KB.
 */
const W_REG: Record<string, number> = {};
const W_BOLD: Record<string, number> = {};
// Helvetica / Helvetica-Bold advance widths (Adobe AFM), characters 32..126.
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
for (let i = 0; i < REG.length; i++) {
  W_REG[String.fromCharCode(32 + i)] = REG[i]!;
  W_BOLD[String.fromCharCode(32 + i)] = BOLD[i]!;
}

/** WinAnsi bytes for the characters outside ASCII that people type in names and addresses. */
const WIN_ANSI: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 };

function encode(s: string): string {
  let out = '';
  for (const ch of s.replace(/\s+/g, ' ')) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (WIN_ANSI[ch] !== undefined) byte = WIN_ANSI[ch]!;
    else if (ch === '₹') {
      out += 'Rs.';
      continue;
    } else if (code < 256 && code >= 32) byte = code;
    else byte = 63; // ?
    const c = String.fromCharCode(byte);
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : byte > 126 ? `\\${byte.toString(8).padStart(3, '0')}` : c;
  }
  return out;
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  /** 0 = black … 1 = white. */
  gray?: number;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export class PdfPage {
  readonly width = 595.28;
  readonly height = 841.89;
  ops: string[] = [];

  static textWidth(s: string, size = 10, bold = false): number {
    const table = bold ? W_BOLD : W_REG;
    let w = 0;
    for (const ch of s) w += table[ch] ?? 556;
    return (w * size) / 1000;
  }

  /** `y` is measured from the top of the page (baseline). */
  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const w = PdfPage.textWidth(s, size, o.bold);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${n(o.gray ?? 0)} g /${o.bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(this.height - y)} Td (${encode(s)}) Tj ET`);
    return w;
  }

  /** Lines of `s` that fit `width`. */
  static wrap(s: string, width: number, size = 10, bold = false): string[] {
    const out: string[] = [];
    for (const para of String(s ?? '').split(/\r?\n/)) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (PdfPage.textWidth(next, size, bold) <= width || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.75) {
    this.ops.push(`${n(gray)} G ${n(width)} w ${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S`);
  }

  box(x: number, y: number, w: number, h: number, gray = 0.95) {
    this.ops.push(`${n(gray)} g ${n(x)} ${n(this.height - y - h)} ${n(w)} ${n(h)} re f`);
  }

  /** The rupee sign as strokes, `size` like a font size, baseline at `y`. Returns its width. */
  rupee(x: number, y: number, size = 10, bold = false, gray = 0) {
    const h = size * 0.7;
    const w = size * 0.5;
    const X = (f: number) => n(x + f * w);
    const Y = (f: number) => n(this.height - y + f * h);
    this.ops.push(
      `q ${n(gray)} G ${n(size * (bold ? 0.09 : 0.065))} w 0 J 1 j ` +
        `${X(0)} ${Y(1)} m ${X(1)} ${Y(1)} l S ` +
        `${X(0)} ${Y(0.72)} m ${X(1)} ${Y(0.72)} l S ` +
        `${X(0.18)} ${Y(1)} m ${X(0.95)} ${Y(1)} ${X(0.95)} ${Y(0.42)} ${X(0.08)} ${Y(0.42)} c S ` +
        `${X(0.08)} ${Y(0.42)} m ${X(0.85)} ${Y(-0.02)} l S Q`,
    );
    return w + size * 0.18;
  }

  /** "₹ 1,23,456.00" ending at (or starting at) x. */
  money(x: number, y: number, paise: number, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const text = inr(paise);
    const tw = PdfPage.textWidth(text, size, o.bold);
    const gw = size * 0.5 + size * 0.18;
    const left = o.align === 'right' ? x - tw - gw : x;
    this.rupee(left, y, size, o.bold, o.gray ?? 0);
    this.text(left + gw, y, text, { ...o, align: 'left' });
  }
}

/** 123456.5 rupees (as paise) → "1,23,456.50" (Indian grouping, always 2 decimals; a minus for credits). */
export function inr(paise: number): string {
  const neg = paise < 0;
  const p = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(p / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${rest ? `${rest},` : ''}${last3}.${String(p % 100).padStart(2, '0')}`;
}

/** The finished file. */
export function renderPdf(pages: PdfPage[], title = 'Document'): Buffer {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body); // object number (1-based)
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${encode(title)}) /Producer (Kaampilot) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
