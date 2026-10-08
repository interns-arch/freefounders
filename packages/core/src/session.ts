/**
 * The FreeFounders sign-in (PLAN.md §13.4): a 15-minute access token kept in memory, renewed from the refresh
 * token (an httpOnly cookie on the web; secure storage on mobile). One renewal at a time for everybody.
 */
import { config } from './config';

export type AppKey = 'tasks' | 'assets';

export interface Claims {
  sub: string;
  cid: string;
  name?: string;
  role?: 'owner' | 'admin' | 'member';
  /** The apps this person can open, with their user id in each. */
  apps: Partial<Record<AppKey, string>>;
  exp: number;
}

type Listener = () => void;

const AUTH = '/api/platform/auth';
let accessToken: string | null = null;
let claims: Claims | null = null;
let renewing: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

function decode(token: string): Claims | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(part) : '';
    return JSON.parse(decodeURIComponent(escape(json))) as Claims;
  } catch {
    return null;
  }
}

function set(token: string | null) {
  const before = claims?.sub ?? null;
  accessToken = token;
  claims = token ? decode(token) : null;
  if ((claims?.sub ?? null) !== before) listeners.forEach((l) => l());
}

async function post(path: string, body: Record<string, unknown> = {}) {
  return config.fetch(`${config.origin}${AUTH}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
}

export const session = {
  token: () => accessToken,
  claims: () => claims,
  signedIn: () => !!accessToken,
  apps: (): AppKey[] => (claims ? (Object.keys(claims.apps ?? {}) as AppKey[]) : []),

  /** Renews the access token. False when the person is signed out. */
  refresh(): Promise<boolean> {
    renewing ??= (async () => {
      try {
        const store = config.refreshStore;
        const stored = store ? await store.get() : null;
        if (store && !stored) return false;
        const res = await post('/refresh', stored ? { refreshToken: stored } : {});
        if (!res.ok) {
          set(null);
          if (store) await store.set(null);
          return false;
        }
        const data = (await res.json()) as { accessToken: string; refreshToken?: string };
        if (store && data.refreshToken) await store.set(data.refreshToken);
        set(data.accessToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => setTimeout(() => (renewing = null), 0));
    return renewing;
  },

  /** Signs in with email, username or employee ID. */
  async login(login: string, password: string): Promise<{ mustChangePassword: boolean }> {
    const store = config.refreshStore;
    const res = await post('/login', { login, password, ...(store ? { client: 'mobile' } : {}) });
    const data = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; mustChangePassword?: boolean; message?: string };
    if (!res.ok || !data.accessToken) {
      const { ApiError } = await import('./http');
      throw new ApiError(res.status, data.message ?? 'Sign-in failed');
    }
    if (store && data.refreshToken) await store.set(data.refreshToken);
    set(data.accessToken);
    return { mustChangePassword: !!data.mustChangePassword };
  },

  async logout() {
    await post('/logout').catch(() => null);
    if (config.refreshStore) await config.refreshStore.set(null);
    set(null);
  },

  /** A request was refused even after renewing: forget the token so the app shows sign-in. */
  signedOut() {
    set(null);
  },

  /** Called when the signed-in person changes (sign-in, sign-out, someone else). */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
