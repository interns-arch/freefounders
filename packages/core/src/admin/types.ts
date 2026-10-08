/** Platform admin types: People & access, Roles (with duties), Settings Center (PLAN.md §13–§17). */
import type { AppKey } from '../session';

export type PlatformRole = 'owner' | 'admin' | 'member';

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
export const APP_NAMES: Record<AppKey, string> = { tasks: 'Tasks', assets: 'Assets' };

export interface AppInfo {
  app: AppKey;
  name: string;
  path: string;
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
  lastWorkingDate?: string | null;
}

/** Fields an admin edits on a person (POST /people, PATCH /people/:id). */
export interface PersonFields {
  fullName: string;
  email: string;
  employeeCode: string;
  mobile: string;
  platformRole: PlatformRole;
  departmentId: string | null;
  designation: string | null;
  reportsTo: string | null;
  joinDate: string | null;
}

export interface NewPerson extends PersonFields {
  /** Omit for no login. Blank username/password: the API uses email/ID and generates a password. */
  login?: { username?: string; password?: string };
}

export interface CreatedPerson {
  person: Person;
  generatedPassword?: string;
}

export interface LoginReset {
  username: string | null;
  generatedPassword?: string;
}

export interface ExitResult {
  lastWorkingDate: string;
  assets?: { caseNumber?: string | null; url?: string | null; error?: string };
  tasks?: { code?: string; error?: string };
}

export interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
  people: number;
}

// ─── Role builder (Phase 3) ───────────────────────────────────────────────

export type Scope = 'own' | 'team' | 'department' | 'company';
export const SCOPE_LABELS: Record<Scope, string> = { own: 'Own', team: 'Team', department: 'Department', company: 'Company' };
export const LEVEL_LABELS: Record<number, string> = { 1: 'Member', 2: 'Manager', 3: 'Admin' };

export interface Grant {
  app: AppKey;
  permission: string;
  scope: string;
}

export type DutyFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

/** A responsibility of a role: Tasks creates it as a task for everyone holding the role (PLAN.md §17.3). */
export interface Duty {
  id?: string;
  title: string;
  description?: string | null;
  steps: string[];
  frequency: DutyFrequency;
  weekday?: number | null;
  monthDay?: number | null;
}

export const DUTY_FREQUENCY_LABELS: Record<DutyFrequency, string> = {
  daily: 'Every working day',
  weekly: 'Every week',
  monthly: 'Every month',
  once: 'Once, when someone gets this role',
};
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

export interface RoleInput {
  name: string;
  description: string | null;
  level: number;
  grants: Grant[];
  duties: Duty[];
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

/** Which apps a role reaches (it has at least one permission there). */
export function roleApps(role: Pick<Role, 'grants'>): AppKey[] {
  return [...new Set(role.grants.map((g) => g.app))];
}

/** Only an owner gives or takes Super Admin. */
export const SUPER_ADMIN_ROLE = 'ff_super_admin';

// ─── Settings Center (Phase 4) ────────────────────────────────────────────

export interface ModuleState {
  key: string;
  label: string;
  description: string;
  default: boolean;
  on: boolean;
}

/** "ok" or why an app could not be told about a change yet (it is sent again on the next change). */
export type SyncResult = Record<string, string>;

export interface CompanySettings {
  id: string;
  name: string;
  code: string;
  shortName: string | null;
  colour: string | null;
  logoUrl: string | null;
  apps: AppKey[];
  modules: Array<{ app: AppKey; modules: ModuleState[] }>;
  sync?: SyncResult;
}

export interface CompanyProfileInput {
  name: string;
  shortName: string | null;
  colour: string | null;
}

/** Settings each app keeps itself; the Settings Center links to them (PLAN.md §16.1). */
export const APP_SETTINGS_LINKS: Record<AppKey, Array<{ label: string; href: string; blurb: string }>> = {
  tasks: [
    { label: 'Task rules', href: '/tasks/settings', blurb: 'Completion evidence, departments, task categories, notifications' },
    { label: 'HR settings', href: '/tasks/hr?tab=settings', blurb: 'Working hours, week-offs, punch-in locations and photo, face check, leave types' },
  ],
  assets: [
    { label: 'Asset catalogue', href: '/assets/settings/catalog', blurb: 'Categories, asset types and custom fields' },
    { label: 'Departments & vendors', href: '/assets/settings/departments', blurb: 'Lists used by assets and people' },
  ],
};

export const LOGO_MAX_BYTES = 512 * 1024;

/** What the colour picker shows when the company keeps the FreeFounders colours. */
export const DEFAULT_BRAND_COLOUR = '#2457f5';
