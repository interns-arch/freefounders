import { saveFile } from '@/lib/native-bridge';

/** Saves rows as a CSV file (Excel opens it). In the phone app the file goes to the app's share sheet. */
export function downloadCSV(filename: string, header: Array<string | number>, rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  return saveFile(filename, new Blob([csv], { type: 'text/csv' }));
}

/** Saves a file the API produced (e.g. a server-side CSV or XLSX). In the phone app it goes through the app. */
export function downloadBlob(filename: string, blob: Blob) {
  return saveFile(filename, blob);
}
