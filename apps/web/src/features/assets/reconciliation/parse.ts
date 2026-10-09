import { detectSource, extractRows, RECON_COLUMNS, RECON_SOURCE_LABELS, type ReconSource } from '@eam/shared';

/** What the browser read from the Excel file: only the known columns ever leave this computer. */
export interface ParsedDump {
  source: ReconSource;
  fileName: string;
  sheet: string;
  rows: Record<string, string | null>[];
  /** Rows that were split across lines in the spreadsheet and joined back together. */
  repaired: number;
  missingColumns: string[];
}

/** Reads an .xlsx in the browser and keeps only the reconciliation columns of `expected`. Throws a readable message. */
export async function parseDumpFile(file: File, expected: ReconSource): Promise<ParsedDump> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(file);
  } catch {
    throw new Error('Could not read this file. Save it as an Excel workbook (.xlsx) and try again.');
  }
  for (const s of sheets) {
    const found = detectSource(s.data);
    if (!found) continue;
    if (found.source !== expected) throw new Error(`This looks like a ${RECON_SOURCE_LABELS[found.source]} file — use the other upload button.`);
    const { rows, repaired, missingColumns } = extractRows(s.data, found.source, found.headerRow);
    if (!rows.length) throw new Error('No data rows found under the header.');
    return { source: found.source, fileName: file.name, sheet: s.sheet, rows, repaired, missingColumns };
  }
  throw new Error(`Could not find the ${RECON_SOURCE_LABELS[expected]} header row (e.g. “${RECON_COLUMNS[expected][0].label}”) in any sheet.`);
}
