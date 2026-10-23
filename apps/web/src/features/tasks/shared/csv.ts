import { saveFile } from '@/lib/native-bridge';

/** Saves a file the API produced (e.g. a server-side CSV or XLSX). In the phone app it goes through the app. */
export function downloadBlob(filename: string, blob: Blob) {
  return saveFile(filename, blob);
}
