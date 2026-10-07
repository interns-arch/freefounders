// Platform API client. The access token lives in memory only; the refresh token is an httpOnly cookie
// the browser sends to /api/platform/auth by itself.

const BASE = '/api/platform';
let access: string | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string>,
  ) {
    super(message);
  }
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach FreeFounders. Check your connection.');
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`, data?.errors);
  return data as T;
}

let refreshing: Promise<boolean> | null = null;

/** Gets a fresh access token from the session cookie. False when signed out. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const res = await send('POST', '/auth/refresh', {});
    if (!res.ok) {
      access = null;
      return false;
    }
    access = (await res.json()).accessToken;
    return true;
  })().finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 401 && (await refresh())) res = await send(method, path, body);
  return parse<T>(res);
}

export async function login(loginId: string, password: string) {
  const data = await parse<{ accessToken: string; mustChangePassword: boolean }>(
    await send('POST', '/auth/login', { login: loginId, password }),
  );
  access = data.accessToken;
  return data;
}

export async function logout() {
  await send('POST', '/auth/logout', {}).catch(() => null);
  access = null;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

// ─── Types ──────────────────────────────────────────────────────────────────
export type AppKey = 'tasks' | 'assets';
export type PlatformRole = 'owner' | 'admin' | 'member';

export interface AppInfo {
  app: AppKey;
  name: string;
  path: string;
}

export interface Me {
  person: { id: string; fullName: string; email: string | null; employeeCode: string | null; role: PlatformRole };
  company: { id: string; name: string };
  apps: AppInfo[];
  mustChangePassword: boolean;
}

export interface Person {
  id: string;
  fullName: string;
  email: string | null;
  employeeCode: string | null;
  mobile: string | null;
  platformRole: PlatformRole;
  status: 'active' | 'inactive';
  login: { username: string | null; lastLoginAt: string | null; locked: boolean } | null;
  apps: AppKey[];
}

export interface AppRole {
  value: string;
  label: string;
}

export const isAdmin = (me: Me | null) => me?.person.role === 'owner' || me?.person.role === 'admin';
