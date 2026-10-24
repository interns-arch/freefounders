/**
 * Bulk import of people (PLAN.md §19.40): reading the uploaded CSV / XLSX into rows, and the template's columns.
 * No library: CSV is split by hand, XLSX is unzipped with node:zlib and its first sheet read from the XML.
 */
import { inflateRawSync } from 'node:zlib';

/** The template's columns, in order (the header row people fill in). */
export const IMPORT_COLUMNS = ['Name', 'Email', 'Mobile', 'Employee ID', 'Department', 'Designation', 'Reports to', 'Join date', 'Role'] as const;
export const IMPORT_EXAMPLE = ['Asha Verma', 'asha@example.com', '98765 43210', 'EMP-101', 'Sales', 'Sales Executive', 'EMP-100', '2026-10-01', 'Member'];
export const IMPORT_MAX_ROWS = 500;

export interface ImportRow {
  /** Line in the file (the header is line 1). */
  line: number;
  fullName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  department: string;
  designation: string;
  reportsTo: string;
  joinDate: string;
  role: string;
}

type Field = Exclude<keyof ImportRow, 'line'>;

/** Header text (any case, spaces / punctuation ignored) → field. */
const HEADER_ALIASES: Record<string, Field> = {
  name: 'fullName', fullname: 'fullName', employeename: 'fullName',
  email: 'email', emailid: 'email', emailaddress: 'email',
  mobile: 'mobile', phone: 'mobile', mobileno: 'mobile', mobilenumber: 'mobile', phonenumber: 'mobile',
  employeeid: 'employeeCode', employeecode: 'employeeCode', empid: 'employeeCode', empcode: 'employeeCode', code: 'employeeCode',
  department: 'department', dept: 'department',
  designation: 'designation', title: 'designation', jobtitle: 'designation',
  reportsto: 'reportsTo', manager: 'reportsTo', reportingmanager: 'reportsTo',
  joindate: 'joinDate', joiningdate: 'joinDate', dateofjoining: 'joinDate', doj: 'joinDate',
  role: 'role', level: 'role', access: 'role',
};

// ─── CSV ─────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  // Excel in some locales saves with semicolons: use them when the header has more of those than commas.
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

/** The files of a zip (stored or deflated entries), read from the central directory. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip file');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 }));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** All the text of the <t> elements inside a piece of XML (a shared string or an inline string, rich text included). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1]!)).join('');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first sheet of an .xlsx as rows of text (numbers as written; dates stay day numbers, read by `parseDate`). */
export function parseXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const shared = files.get('xl/sharedStrings.xml');
  const strings = shared ? [...shared.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!)) : [];
  // The first sheet in the workbook's order (its relationship target), else the lowest-numbered sheet file.
  let sheetPath = '';
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (rid) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? '';
  const sheet = files.get(sheetPath)?.toString('utf8');
  if (!sheet) throw new Error('No sheet in this file');
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') text = texts(body);
      else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = v !== undefined ? unxml(v) : '';
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = text;
    }
    rows.push(row);
  }
  return rows;
}

// ─── rows ────────────────────────────────────────────────────────────────────

/** A cell as typed: trimmed, without the apostrophe a spreadsheet adds in front of "+91…" or "=…". */
const clean = (v: string | undefined) => (v ?? '').replace(/^'(?=[=+\-@])/, '').trim();

/** The file → header-mapped rows (blank lines skipped). Throws Error with a message for the person. */
export function readImportFile(fileName: string, content: Buffer): ImportRow[] {
  const isXlsx = /\.xlsx$/i.test(fileName) || (content[0] === 0x50 && content[1] === 0x4b);
  let grid: string[][];
  try {
    grid = isXlsx ? parseXlsx(content) : parseCsv(content.toString('utf8'));
  } catch {
    throw new Error(isXlsx ? 'This Excel file could not be read. Save it again as .xlsx (or CSV) and retry.' : 'This file could not be read as CSV.');
  }
  const headerAt = grid.findIndex((r) => r.some((c) => clean(c)));
  if (headerAt < 0) throw new Error('The file is empty.');
  const header = grid[headerAt]!.map((h) => HEADER_ALIASES[clean(h).toLowerCase().replace(/[^a-z]/g, '')]);
  if (!header.includes('fullName')) throw new Error('No "Name" column. Download the template and keep its header row.');
  const rows: ImportRow[] = [];
  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells = grid[i]!;
    if (!cells.some((c) => clean(c))) continue;
    const row: ImportRow = { line: i + 1, fullName: '', email: '', mobile: '', employeeCode: '', department: '', designation: '', reportsTo: '', joinDate: '', role: '' };
    header.forEach((field, ci) => {
      if (field && !row[field]) row[field] = clean(cells[ci]);
    });
    rows.push(row);
  }
  if (rows.length > IMPORT_MAX_ROWS) throw new Error(`At most ${IMPORT_MAX_ROWS} people per file; this one has ${rows.length}. Split it and import each part.`);
  return rows;
}

/** "2026-10-01", "01-10-2026", "01/10/2026", "1.10.2026" or an Excel day number → "2026-10-01"; null when not a date. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (/^\d{4,5}(\.\d+)?$/.test(v)) {
    const date = new Date(Math.round((Number(v) - 25569) * 86_400_000));
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1950 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "Admin" / "Member" (any case; blank = Member) → level; null when something else. */
export function parseRole(value: string): 'admin' | 'member' | null {
  const v = value.trim().toLowerCase();
  if (!v || v === 'member' || v === 'employee' || v === 'user') return 'member';
  if (v === 'admin' || v === 'administrator') return 'admin';
  return null;
}
