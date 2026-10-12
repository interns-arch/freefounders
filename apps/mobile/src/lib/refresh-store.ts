/**
 * Where the phone keeps the FreeFounders refresh token (PLAN.md §13.4: mobile gets it in the body and keeps it in
 * secure storage). `storage` is expo-secure-store in the app (Android Keystore) and a fake in the tests.
 * The value is cached in memory after the first read; a storage failure counts as "signed out", never a crash.
 */
import type { RefreshStore } from '@freefounders/core';

export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const REFRESH_KEY = 'ff.refreshToken';

export function createRefreshStore(storage: SecureStorage): RefreshStore {
  let cached: string | null | undefined;
  return {
    async get() {
      if (cached === undefined) {
        try {
          cached = (await storage.getItemAsync(REFRESH_KEY)) || null;
        } catch {
          cached = null;
        }
      }
      return cached;
    },
    async set(token) {
      cached = token || null;
      try {
        if (cached) await storage.setItemAsync(REFRESH_KEY, cached);
        else await storage.deleteItemAsync(REFRESH_KEY);
      } catch {
        // Keep the in-memory value: this session still works, the next app start asks to sign in again.
      }
    },
  };
}
