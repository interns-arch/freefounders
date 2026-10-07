import { z } from 'zod';

/**
 * Reconciliation of third-party dumps (Airtel connections, Salary Box employees) against the register.
 * Parsing runs in the browser so only the columns below ever reach the server — Aadhaar, PAN, bank
 * details and addresses in a Salary Box export stay on the uploader's computer.
 */
export const RECON_SOURCES = ['AIRTEL', 'SALARYBOX'] as const;
export type ReconSource = (typeof RECON_SOURCES)[number];
export const RECON_SOURCE_LABELS: Record<ReconSource, string> = { AIRTEL: 'Airtel connections', SALARYBOX: 'Salary Box employees' };

export const RECON_STATUSES = ['MATCHED', 'MISMATCH', 'MISSING_IN_SYSTEM', 'MISSING_IN_DUMP', 'INVALID'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

interface ColumnSpec {
  key: string;
  label: string;
  aliases: string[];
}

const AIRTEL_COLUMNS: ColumnSpec[] = [
  { key: 'connectionNumber', label: 'Connection Number', aliases: ['connection number', 'mobile number', 'connection no'] },
  { key: 'billableName', label: 'Billable Name', aliases: ['billable name'] },
  { key: 'billableId', label: 'Billable ID', aliases: ['billable id', 'billable account'] },
  { key: 'status', label: 'Status', aliases: ['status'] },
  { key: 'circle', label: 'Circle', aliases: ['circle'] },
  { key: 'plan', label: 'Plan Name', aliases: ['plan name', 'plan'] },
  { key: 'simNumber', label: 'SIM Number', aliases: ['sim number', 'sim no'] },
  { key: 'name', label: 'Name', aliases: ['name', 'user name'] },
  { key: 'email', label: 'Email', aliases: ['email', 'email id'] },
];

const SALARYBOX_COLUMNS: ColumnSpec[] = [
  { key: 'salaryBoxId', label: 'SalaryBox ID', aliases: ['salarybox id', 'salary box id'] },
  { key: 'name', label: 'Employee Name', aliases: ['employee name', 'name'] },
  { key: 'employeeCode', label: 'Employee ID', aliases: ['employee id', 'employee code'] },
  { key: 'phone', label: 'Phone Number', aliases: ['phone number', 'phone', 'mobile number'] },
  { key: 'branch', label: 'Branch', aliases: ['branch'] },
  { key: 'department', label: 'Department', aliases: ['department'] },
  { key: 'designation', label: 'Designation', aliases: ['designation'] },
  { key: 'employeeType', label: 'Employee Type', aliases: ['employee type'] },
  { key: 'personalEmail', label: 'Personal Email ID', aliases: ['personal email id', 'personal email'] },
  { key: 'officialEmail', label: 'Official Email ID', aliases: ['official email id', 'official email'] },
  { key: 'laptop', label: 'Laptop', aliases: ['laptop'] },
  { key: 'simDetails', label: 'SIM Details', aliases: ['sim details', 'sim'] },
  { key: 'charger', label: 'Laptop Charger', aliases: ['laptop charger', 'charger'] },
  { key: 'other', label: 'Other', aliases: ['other', 'other assets'] },
];

export const RECON_COLUMNS: Record<ReconSource, ColumnSpec[]> = { AIRTEL: AIRTEL_COLUMNS, SALARYBOX: SALARYBOX_COLUMNS };

/** A record starts on a row whose key cell looks like this; other rows are wrapped continuations. */
const RECORD_KEY: Record<ReconSource, { key: string; test: (v: string) => boolean }> = {
  AIRTEL: { key: 'connectionNumber', test: (v) => /\d{10}/.test(v.replace(/\D/g, '')) },
  SALARYBOX: { key: 'salaryBoxId', test: (v) => /^SB[A-Z0-9]{6,}$/i.test(v.trim()) },
};

const normHeader = (h: unknown) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Card and ID numbers (12–19 digits, not SIM ICCIDs) are masked to their last four digits. */
export function maskLongNumbers(text: string): string {
  return text.replace(/\d[\d\s-]{10,22}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 12 || digits.length > 19 || digits.startsWith('89')) return m;
    return `•••• ${digits.slice(-4)}`;
  });
}

function mapColumns(header: unknown[], specs: ColumnSpec[]) {
  const names = header.map(normHeader);
  const map: Record<string, number> = {};
  for (const spec of specs) {
    const idx = spec.aliases.map((a) => names.indexOf(a)).find((i) => i >= 0);
    if (idx !== undefined) map[spec.key] = idx;
  }
  return map;
}

export function detectSource(table: unknown[][]): { source: ReconSource; headerRow: number } | null {
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const names = (table[r] ?? []).map(normHeader);
    if (names.includes('salarybox id') || names.includes('salary box id')) return { source: 'SALARYBOX', headerRow: r };
    if (names.includes('connection number') && names.includes('sim number')) return { source: 'AIRTEL', headerRow: r };
  }
  return null;
}

export type DumpRow = Record<string, string | null>;

/**
 * Turns a sheet into records of the known columns. Spreadsheets pasted from CSV often split a cell
 * containing a line break (e.g. an address) across rows; those continuation rows are stitched back:
 * their first cell continues the last filled cell, and the rest shift right from there.
 */
export function extractRows(table: unknown[][], source: ReconSource, headerRow: number) {
  const header = table[headerRow] ?? [];
  const width = header.length;
  const cols = mapColumns(header, RECON_COLUMNS[source]);
  const keyCol = cols[RECORD_KEY[source].key];
  const records: unknown[][] = [];
  let current: unknown[] | null = null;
  let last = -1;
  let repaired = 0;
  const lastFilled = (row: unknown[]) => {
    for (let i = row.length - 1; i >= 0; i--) if (cellText(row[i]) !== null) return i;
    return -1;
  };

  // The cell that was split is the last one before a long empty gap (later cells can already be set).
  const breakPoint = (row: unknown[]) => {
    const end = lastFilled(row);
    let lastSeen = -1;
    for (let i = 0; i <= end; i++) {
      if (cellText(row[i]) !== null) {
        lastSeen = i;
        continue;
      }
      let gap = 0;
      while (i + gap <= end && cellText(row[i + gap]) === null) gap++;
      if (gap >= 3) return lastSeen;
      i += gap - 1;
    }
    return end;
  };

  for (const row of table.slice(headerRow + 1)) {
    if (!row || lastFilled(row) < 0) continue;
    const key = keyCol === undefined ? null : cellText(row[keyCol]);
    if (key && RECORD_KEY[source].test(key)) {
      current = [...row];
      records.push(current);
      last = breakPoint(current);
      continue;
    }
    if (!current || last < 0) continue;
    repaired++;
    const cont = lastFilled(row);
    const head = cellText(row[0]);
    if (head) current[last] = [cellText(current[last]), head].filter(Boolean).join('\n');
    for (let j = 1; j <= cont && last + j < width; j++) if (cellText(row[j]) !== null) current[last + j] = row[j];
    last = Math.min(width - 1, last + Math.max(cont, 0));
  }

  const rows: DumpRow[] = records.map((rec) => {
    const out: DumpRow = {};
    for (const [key, idx] of Object.entries(cols)) {
      const text = cellText(rec[idx]);
      out[key] = text === null ? null : maskLongNumbers(text).slice(0, 500);
    }
    return out;
  });
  const missing = RECON_COLUMNS[source].filter((c) => cols[c.key] === undefined).map((c) => c.label);
  return { rows, repaired, missingColumns: missing };
}

// ─── Normalisers shared by the matcher ─────────────────────────────────────
export const normalizePhone = (v: string | null | undefined) => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};
export const normalizeIccid = (v: string | null | undefined) => {
  const s = (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/U$/, '');
  return s.length >= 15 ? s : null;
};
/** CT000122, CT0000122 and ct122 compare equal. */
export const employeeCodeKey = (v: string | null | undefined) => {
  const m = (v ?? '').trim().toUpperCase().match(/^([A-Z]*)0*(\d+)$/);
  return m ? `${m[1]}${m[2]}` : (v ?? '').trim().toUpperCase() || null;
};
export const normalizeText = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Identifiers an employee has written against their assets (laptop, SIM, charger, other). */
export function extractIdentifiers(text: string | null | undefined) {
  let rest = ` ${text ?? ''} `;
  const take = (re: RegExp, norm: (s: string) => string | null) => {
    const found = new Set<string>();
    rest = rest.replace(re, (m) => {
      const n = norm(m);
      if (n) found.add(n);
      return ' ';
    });
    return [...found];
  };
  const iccids = take(/89\d{16,20}[A-Z]?/gi, normalizeIccid);
  const guids = take(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (s) => s.toUpperCase());
  const deviceNames = take(/\b(?:LAPTOP|DESKTOP)-[A-Z0-9]{4,15}\b/gi, (s) => s.toUpperCase());
  // No lookbehind: older iOS Safari cannot parse it, which would break the whole app.
  const phones = take(/(?:^|\D)(?:\+?91[\s-]?)?[6-9]\d{9}(?:\.0)?(?!\d)/g, normalizePhone);
  const serials = take(/\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,20}\b/gi, (s) => s.toUpperCase());
  return { iccids, guids, deviceNames, phones, serials };
}

// ─── API contract ──────────────────────────────────────────────────────────
const cell = z.string().trim().max(500).nullish().transform((v) => v || null);
export const reconUploadSchema = z.object({
  source: z.enum(RECON_SOURCES),
  fileName: z.string().trim().min(1).max(200),
  repairedRows: z.number().int().min(0).default(0),
  rows: z.array(z.record(z.string(), cell)).min(1, 'The file has no data rows').max(5000, 'At most 5000 rows per upload'),
});
export type ReconUploadInput = z.infer<typeof reconUploadSchema>;
