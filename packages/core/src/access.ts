/**
 * Who is signed in, what they may do, and which modules are on, across the three APIs. Screens ask
 * `useAccess()` instead of reading tokens or calling /me themselves.
 */
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { assetsApi, platformApi, tasksApi } from './http';
import { type AppKey, type Claims, session } from './session';

// ─── /me of each API ──────────────────────────────────────────────────────

export interface PlatformMe {
  person: { id: string; fullName: string; email: string | null; employeeCode: string | null; role: 'owner' | 'admin' | 'member' };
  company: { id: string; name: string; shortName: string | null; colour: string | null; logoUrl: string | null };
  apps: Array<{ app: AppKey; name: string; path: string }>;
  /** Admin workspace permissions (PLAN.md §19.19): owners and admins have them all. */
  permissions?: string[];
  /**
   * What their roles give them (docs/security/platform.md R1): every app permission with each scope a role gives it,
   * the Admin permissions, and their highest role level. Without being the owner, they can give only this.
   */
  held?: { level: number; grants: Array<{ app: 'tasks' | 'assets' | 'platform'; permission: string; scope: string }> };
  /** Always false now: nobody is forced to change their password (R7). Kept for older servers. */
  mustChangePassword?: boolean;
}

export interface TasksMe {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_display: string;
  department: string;
  department_display: string;
  whatsapp_phone: string;
  reporting_manager: number | null;
  reporting_manager_name: string | null;
  is_active: boolean;
  capabilities: string[];
  /** Highest role level: 1 member, 2 manager, 3 admin (an administrator in Tasks). */
  level?: number;
  /** Module switches (Settings Center); missing = on. */
  modules?: Record<string, boolean>;
  brand?: { name: string; short_name: string; colour: string | null; logo_url: string | null } | null;
}

export interface AssetsMe {
  user: { id: string; name: string; email: string | null };
  role: { id: string; name: string };
  permissions: string[];
  employee: { id: string; fullName: string; employeeCode: string; status: string; designation: string | null } | null;
}

export interface AssetsConfig {
  publicUrl: string | null;
  companyName: string | null;
  brand?: { shortName: string | null; colour: string | null; logoUrl: string | null } | null;
  modules?: Record<string, boolean> | null;
}

/** The signed-in person's token claims; re-renders when someone signs in or out. */
export function useClaims(): Claims | null {
  return useSyncExternalStore(session.subscribe, session.claims, session.claims);
}

const STALE = 5 * 60_000;

export function usePlatformMe() {
  const claims = useClaims();
  return useQuery({ queryKey: ['platform', 'me', claims?.sub], queryFn: () => platformApi.get<PlatformMe>('/auth/me'), enabled: !!claims, staleTime: STALE });
}

export function useTasksMe() {
  const claims = useClaims();
  return useQuery({ queryKey: ['tasks', 'me', claims?.sub], queryFn: () => tasksApi.get<TasksMe>('/auth/me'), enabled: !!claims?.apps?.tasks, staleTime: STALE });
}

export function useAssetsMe() {
  const claims = useClaims();
  return useQuery({ queryKey: ['assets', 'me', claims?.sub], queryFn: () => assetsApi.get<AssetsMe>('/auth/me'), enabled: !!claims?.apps?.assets, staleTime: STALE });
}

export function useAssetsConfig() {
  const claims = useClaims();
  return useQuery({ queryKey: ['assets', 'config', claims?.sub], queryFn: () => assetsApi.get<AssetsConfig>('/config'), enabled: !!claims?.apps?.assets, staleTime: STALE });
}

// ─── one answer for screens ────────────────────────────────────────────────

// A Tasks capability belongs to a module the company can switch off; then it counts as missing (PLAN.md §16.2).
const TASKS_CAP_MODULE: Array<[string, string]> = [
  ['leads.', 'leads'],
  ['quotations.', 'leads'],
  ['intake.', 'intake'],
  ['mistakes.', 'mistakes'],
  ['sops.', 'mistakes'],
  ['links.', 'links'],
  ['payroll.', 'payroll'],
];

export interface Access {
  ready: boolean;
  claims: Claims | null;
  apps: AppKey[];
  /** Owner or admin access level (everything in the Admin workspace). For what a person may do there, use `admin`. */
  isAdmin: boolean;
  /** The Admin workspace (People & access, Roles, Settings): each action is its own permission (PLAN.md §19.19). */
  admin: {
    /** Has at least one Admin permission (the Admin menu shows). */
    any: boolean;
    /** Has ANY of these Admin permissions (e.g. "people.manage"). */
    can: (...permissions: string[]) => boolean;
  };
  platform: PlatformMe | undefined;
  tasks: {
    on: boolean;
    me: TasksMe | undefined;
    /** Has this Tasks capability (e.g. "tasks.view_all"), and its module is on. */
    can: (capability: string) => boolean;
    /** Has any capability starting with this (e.g. "leads.view"). */
    canAny: (prefix: string) => boolean;
    module: (key: string) => boolean;
  };
  assets: {
    on: boolean;
    me: AssetsMe | undefined;
    config: AssetsConfig | undefined;
    /** Has ANY of these Assets permissions (e.g. "asset:assign"). */
    can: (...permissions: string[]) => boolean;
    module: (key: string) => boolean;
  };
  /** Company brand from the Settings Center (null = FreeFounders defaults). */
  brand: { name: string; shortName: string; colour: string | null; logoUrl: string | null } | null;
}

export function useAccess(): Access {
  const claims = useClaims();
  const platform = usePlatformMe();
  const tasksMe = useTasksMe();
  const assetsMe = useAssetsMe();
  const assetsConfig = useAssetsConfig();
  const apps = claims ? (Object.keys(claims.apps ?? {}) as AppKey[]) : [];
  const t = tasksMe.data;
  const a = assetsMe.data;
  const tasksModule = (key: string) => t?.modules?.[key] !== false;
  const caps = new Set(t?.capabilities ?? []);
  const perms = new Set(a?.permissions ?? []);
  const adminPerms = new Set(platform.data?.permissions ?? (claims?.role === 'owner' || claims?.role === 'admin' ? ['*'] : []));
  const company = platform.data?.company;
  const ready =
    !!claims &&
    !platform.isLoading &&
    (!apps.includes('tasks') || !tasksMe.isLoading) &&
    (!apps.includes('assets') || (!assetsMe.isLoading && !assetsConfig.isLoading));
  return {
    ready,
    claims,
    apps,
    isAdmin: claims?.role === 'owner' || claims?.role === 'admin',
    admin: {
      any: adminPerms.size > 0,
      can: (...p) => adminPerms.has('*') || p.some((x) => adminPerms.has(x)),
    },
    platform: platform.data,
    tasks: {
      on: apps.includes('tasks'),
      me: t,
      can: (cap) => caps.has(cap) && tasksModule(TASKS_CAP_MODULE.find(([p]) => cap.startsWith(p))?.[1] ?? '-'),
      canAny: (prefix) => [...caps].some((c) => c.startsWith(prefix)) && tasksModule(TASKS_CAP_MODULE.find(([p]) => prefix.startsWith(p))?.[1] ?? '-'),
      module: tasksModule,
    },
    assets: {
      on: apps.includes('assets'),
      me: a,
      config: assetsConfig.data,
      can: (...p) => p.some((x) => perms.has(x)),
      module: (key) => assetsConfig.data?.modules?.[key] !== false,
    },
    brand: company ? { name: company.name, shortName: company.shortName || company.name, colour: company.colour, logoUrl: company.logoUrl } : null,
  };
}
