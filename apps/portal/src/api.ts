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
  company: { id: string; name: string; shortName: string | null; colour: string | null; logoUrl: string | null };
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
  roleIds: string[];
  departmentId: string | null;
  designation: string | null;
  reportsTo: string | null;
  joinDate: string | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
  people: number;
}

// Role builder (Phase 3)
export type Scope = 'own' | 'team' | 'department' | 'company';
export const SCOPE_LABELS: Record<Scope, string> = { own: 'Own', team: 'Team', department: 'Department', company: 'Company' };
export const LEVEL_LABELS: Record<number, string> = { 1: 'Member', 2: 'Manager', 3: 'Admin' };

export interface Grant {
  app: AppKey;
  permission: string;
  scope: string;
}

/** A responsibility of a role: Tasks creates it as a task for everyone holding the role (PLAN.md §17.3). */
export interface Duty {
  id?: string;
  title: string;
  description?: string | null;
  steps: string[];
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  weekday?: number | null;
  monthDay?: number | null;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  colour: string | null;
  level: number;
  system: boolean;
  archived: boolean;
  people: number;
  grants: Grant[];
  duties?: Duty[];
}

export interface CataloguePermission {
  key: string;
  label: string;
  group: string;
  scopes: Scope[] | null;
  superAdminOnly?: boolean;
}

export interface AppCatalogue {
  app: AppKey;
  scopes: Scope[];
  permissions: CataloguePermission[];
}

export const APP_NAMES: Record<AppKey, string> = { tasks: 'Tasks', assets: 'Assets' };

// Settings Center (Phase 4)
export interface ModuleState {
  key: string;
  label: string;
  description: string;
  default: boolean;
  on: boolean;
}

export interface CompanySettings {
  id: string;
  name: string;
  code: string;
  shortName: string | null;
  colour: string | null;
  logoUrl: string | null;
  apps: AppKey[];
  modules: Array<{ app: AppKey; modules: ModuleState[] }>;
  sync?: Record<string, string>;
}

export interface AppRole {
  value: string;
  label: string;
}

export const isAdmin = (me: Me | null) => me?.person.role === 'owner' || me?.person.role === 'admin';
