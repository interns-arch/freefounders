/**
 * The FreeFounders address the app opens. Default: EXPO_PUBLIC_WEB_URL (apps/mobile/.env, see .env.example), else
 * app.json "extra.webUrl". A person can change it on the "Can't reach FreeFounders" screen (e.g. another Wi-Fi); that
 * choice is kept on the phone (expo-secure-store) until they reset it.
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl } from './protocol';

const KEY = 'ff.serverUrl';
const fromConfig = (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl;

export const DEFAULT_SERVER_URL = normalizeServerUrl(process.env.EXPO_PUBLIC_WEB_URL || fromConfig || '') ?? 'http://192.168.137.1:8080';

export async function loadServerUrl(): Promise<string> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  return (saved && normalizeServerUrl(saved)) || DEFAULT_SERVER_URL;
}

/** Saves an address typed by the person; null = back to the default. Returns the address now in use. */
export async function saveServerUrl(input: string | null): Promise<string> {
  if (input === null) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    return DEFAULT_SERVER_URL;
  }
  const url = normalizeServerUrl(input);
  if (!url) throw new Error('That is not a server address. Example: http://192.168.137.1:8080');
  await SecureStore.setItemAsync(KEY, url);
  return url;
}
