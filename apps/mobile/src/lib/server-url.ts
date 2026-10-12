/**
 * The FreeFounders address the app opens. Default: EXPO_PUBLIC_WEB_URL (apps/mobile/.env, see .env.example), else
 * app.json "extra.webUrl". A person can change it on the "Can't reach FreeFounders" screen (e.g. another Wi-Fi); that
 * choice is kept on the phone (expo-secure-store) until they reset it.
 *
 * Store builds lock the address (EXPO_PUBLIC_LOCK_SERVER=1 or app.json "extra.lockServer": true): the app then always
 * opens the built-in address and offers no field, so nobody can be talked into pointing the app at a look-alike server
 * (that server would see their password and could ask the app for their location and camera). Development builds leave
 * it unlocked; that build-time switch is the only way to unlock it.
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl } from './protocol';

const KEY = 'ff.serverUrl';
const extra = Constants.expoConfig?.extra as { webUrl?: string; lockServer?: boolean } | undefined;
const fromConfig = extra?.webUrl;

/** True in builds whose server address cannot be changed on the phone. */
export const SERVER_LOCKED = process.env.EXPO_PUBLIC_LOCK_SERVER === '1' || extra?.lockServer === true;

export const DEFAULT_SERVER_URL = normalizeServerUrl(process.env.EXPO_PUBLIC_WEB_URL || fromConfig || '') ?? 'http://192.168.137.1:8080';

export const SERVER_ADDRESS_HELP =
  'That is not a server address. Office network: http://192.168.137.1:8080 · anywhere else: https://your-company-address';

export async function loadServerUrl(): Promise<string> {
  if (SERVER_LOCKED) return DEFAULT_SERVER_URL;
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  return (saved && normalizeServerUrl(saved)) || DEFAULT_SERVER_URL;
}

/** Saves an address typed by the person; null = back to the default. Returns the address now in use. */
export async function saveServerUrl(input: string | null): Promise<string> {
  if (SERVER_LOCKED) return DEFAULT_SERVER_URL;
  if (input === null) {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    return DEFAULT_SERVER_URL;
  }
  const url = normalizeServerUrl(input);
  if (!url) throw new Error(SERVER_ADDRESS_HELP);
  await SecureStore.setItemAsync(KEY, url);
  return url;
}
