/**
 * Where the APIs are and how to reach them. The web app needs nothing (same address, cookies). The mobile app
 * (Phase 7) sets `origin` to the FreeFounders address and gives a `refreshStore` (secure storage), because it
 * keeps the refresh token itself instead of in a cookie.
 */
export interface RefreshStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

export const config: {
  origin: string;
  fetch: typeof fetch;
  refreshStore: RefreshStore | null;
} = {
  origin: '',
  fetch: (...args) => globalThis.fetch(...args),
  refreshStore: null,
};

export function configureCore(options: Partial<typeof config>) {
  Object.assign(config, options);
}
