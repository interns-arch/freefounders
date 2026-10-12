/** What the app does for the web app (PLAN.md §19.17): save + share a file, print a page. Location: ./location.ts. */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { isBase64, safeFilename, stripDataUrl } from './files';

/**
 * Saves the file in the app's cache and opens Android's share sheet, where the person picks "Save to Files", Drive,
 * WhatsApp, e-mail… (an app cannot write into Downloads without extra permissions; the share sheet needs none).
 */
export async function saveAndShare(filename: string, mime: string, base64: string): Promise<{ saved: true; name: string }> {
  if (!isBase64(base64)) throw new Error('The file could not be read. Try again.');
  const name = safeFilename(filename, mime);
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(stripDataUrl(base64), { encoding: 'base64' });
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files.');
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
  return { saved: true, name };
}

/** Android's print dialog for the page (ID cards, labels); "Save as PDF" is one of its printers. */
export async function printHtml(html: string): Promise<{ printed: true }> {
  await Print.printAsync({ html });
  return { printed: true };
}
