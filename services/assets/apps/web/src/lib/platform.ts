// FreeFounders single login.
//
// Built with VITE_PLATFORM_LOGIN=true (and VITE_BASE=/assets/) the app runs under /assets/ on the shared
// FreeFounders address. Sign-in happens once in the portal; this app turns the Platform's short access
// token into its own session cookie (POST /api/auth/platform-session), so everything else — photos,
// downloads — works exactly as before. Built without it, nothing here is used.

export const PLATFORM = import.meta.env.VITE_PLATFORM_LOGIN === 'true';
export const BASE: string = import.meta.env.BASE_URL || '/';

/** '/api/x' → '/assets/api/x' under the shared address; unchanged otherwise. */
export const withBase = (path: string) => (path.startsWith('/') ? BASE + path.slice(1) : path);

const PLATFORM_AUTH = '/api/platform/auth';
let apps: string[] | null = null;
let pending: Promise<boolean> | null = null;

function platformPost(path: string) {
  return fetch(PLATFORM_AUTH + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: '{}',
  });
}

function appsIn(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Object.keys(payload.apps ?? {});
  } catch {
    return [];
  }
}

/** A fresh Platform access token, or null when signed out there. */
async function platformToken(): Promise<string | null> {
  try {
    const res = await platformPost('/refresh');
    if (!res.ok) return null;
    const token = (await res.json()).accessToken as string;
    apps = appsIn(token);
    return token;
  } catch {
    return null;
  }
}

/**
 * Makes sure this app has a session made from the Platform sign-in. Concurrent callers share one attempt.
 * False when the person is signed out of the Platform (or lost access to Assets).
 */
export function ensurePlatformSession(): Promise<boolean> {
  pending ??= (async () => {
    const token = await platformToken();
    if (!token) return false;
    const res = await fetch(withBase('/api/auth/platform-session'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
    }).catch(() => null);
    return !!res?.ok;
  })().finally(() => {
    setTimeout(() => (pending = null), 0);
  });
  return pending;
}

/** Apps this person can open; asks the Platform once if not known yet. */
export async function platformApps(): Promise<string[]> {
  if (apps === null) await platformToken();
  return apps ?? [];
}

export async function platformLogout() {
  await platformPost('/logout').catch(() => {});
  apps = null;
}

/** Off to the portal's sign-in; it sends the person back here afterwards. */
export function goToPortal() {
  window.location.assign(`/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export const APP_LINKS = [
  { app: 'tasks', name: 'Tasks', href: '/tasks/' },
  { app: 'assets', name: 'Assets', href: '/assets/' },
] as const;
