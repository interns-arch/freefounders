/** Platform admin types: People & access, Roles (with duties), Settings Center (PLAN.md §13–§17). */
import type { AppKey } from '../session';

export type PlatformRole = 'owner' | 'admin' | 'member';

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
export const APP_NAMES: Record<AppKey, string> = { tasks: 'Tasks', assets: 'Assets' };

/** Where a role's permissions live: the company's apps, plus the Admin workspace itself (PLAN.md §19.19). */
export type GrantApp = AppKey | 'platform';
export const GRANT_APP_NAMES: Record<GrantApp, string> = { ...APP_NAMES, platform: 'Admin' };

/** The Admin workspace permissions (People & access, Roles, Settings). Owners and admins have them all. */
export type AdminPermission = 'people.manage' | 'people.passwords' | 'people.exit' | 'people.delete' | 'roles.manage' | 'company.settings';
/** Any of these opens People & access. */
export const PEOPLE_SCREEN: AdminPermission[] = ['people.manage', 'people.passwords', 'people.exit', 'people.delete', 'roles.manage'];

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
  /** Their listed roles (Admin, Member, roles made in the role builder). */
  roleIds: string[];
  /** They have extra access or duties of their own (PLAN.md §19.28). */
  extraAccess?: boolean;
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

/** PUT /people/:id/login. No password: one is generated and returned once. */
export interface ResetLoginInput {
  /** Needed only when the person has no login and no email or employee ID to sign in with. */
  username?: string;
  /** At least PLATFORM_PASSWORD_MIN characters (a weak one is only warned about: weakPasswordWarning). */
  password?: string;
}

/** The shortest password the Platform accepts (founder's choice, PLAN.md §19.12). */
export const PLATFORM_PASSWORD_MIN = 6;

/** A choice for work someone leaves behind: hand it to another person (a Platform person id), or `other`. */
export type HandOver<Other extends string> = { mode: Other } | { mode: 'hand_over'; to: string };

/**
 * Delete choices (PLAN.md §19.12). Leave out a key (or all of them) to delete that part entirely.
 * Founder's default (2026-10-09): keep and hand over.
 */
export interface DeleteOptions {
  /** Their open tasks (Tasks). */
  tasks?: HandOver<'delete'>;
  /** Leads assigned to or created by them (Tasks; with their tasks when deleted). */
  leads?: HandOver<'delete'>;
  /** Finished tasks, attendance, leave, salary records, comments: kept under "Deleted user", or erased. */
  history?: { mode: 'keep' | 'delete' };
  /** Assets they hold (Assets): back to stock, or to someone. */
  assets?: HandOver<'stock'>;
}

/** DELETE /people/:id: per app, how many records went, how many were handed over, and whether history was kept anonymised. */
export interface DeletedPerson {
  deleted: true;
  apps: Partial<Record<AppKey, Record<string, number>>>;
  handedOver: Partial<Record<AppKey, Record<string, number>>>;
  anonymised: Partial<Record<AppKey, boolean>>;
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

/**
 * What each level really does (checked in Tasks and Assets, 2026-10-12): Assets ignores the level; in Tasks, Manager
 * only marks the role as a manager post (offered as "Reports to" in Tasks' own user screen), and Admin is an
 * administrator in Tasks. Everything else comes from the ticked permissions.
 */
export const LEVEL_HINTS: Record<number, string> = {
  1: 'Uses the apps with exactly the permissions ticked below.',
  2: 'Same as Member: the ticked permissions decide what they can do. Tasks also lists them as a manager people can report to.',
  3: 'Also an administrator in Tasks: sees everyone’s delegated work on Tasks Home and manages other admins’ Tasks accounts; work given to them is protected from deletion (only the Owner can delete it).',
};

export interface Grant {
  app: GrantApp;
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
  /** One line shown under the permission in the role editor. */
  description?: string;
  scopes: Scope[] | null;
  superAdminOnly?: boolean;
}

export interface AppCatalogue {
  app: GrantApp;
  scopes: Scope[];
  permissions: CataloguePermission[];
}

/** Which apps a role reaches (it has at least one permission there); "platform" = the Admin workspace. */
export function roleApps(role: Pick<Role, 'grants'>): GrantApp[] {
  return [...new Set(role.grants.map((g) => g.app))];
}

/**
 * The two built-in roles (PLAN.md §19.28): edited like any role, never deleted or renamed. "Make Admin" / "Make Member"
 * swap one for the other. The Owner is a mark on the person (full access), not a role in the list.
 */
export const ADMIN_ROLE = 'ff_admin';
export const MEMBER_ROLE = 'ff_member';

/** A person's access (GET /people/:id/access): roles, what they give together, and their own extra access and duties. */
export interface PersonAccess {
  personId: string;
  owner: boolean;
  roleIds: string[];
  fromRoles: Grant[];
  extra: { grants: Grant[]; duties: Duty[] };
  /** The extra permissions their roles do not already give. */
  adds: Grant[];
}

export interface PersonalAccessInput {
  grants: Grant[];
  duties: Duty[];
}

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
    { label: 'HR settings', href: '/attendance/settings', blurb: 'Working hours, week-offs, punch-in locations and photo, leave types' },
  ],
  assets: [
    { label: 'Asset catalogue', href: '/assets/settings/catalog', blurb: 'Categories, asset types and custom fields' },
    { label: 'Departments & vendors', href: '/assets/settings/departments', blurb: 'Lists used by assets and people' },
  ],
};

export const LOGO_MAX_BYTES = 512 * 1024;

/** What the colour picker shows when the company keeps the Kaampilot colours. */
export const DEFAULT_BRAND_COLOUR = '#2457f5';

/**
 * The Guard role in one click (PLAN.md §22): punch in/out and their own attendance, notifications (overstay alerts),
 * and the gate (visitors + vehicles). Nothing else: no Tasks or Assets menus.
 */
export const GUARD_ROLE_PRESET: RoleInput = {
  name: 'Guard',
  description: 'Security / reception at the gate: visitors and vehicles in and out, and their own attendance.',
  level: 1,
  grants: [
    { app: 'tasks', permission: 'attendance.punch', scope: '' },
    { app: 'tasks', permission: 'attendance.self', scope: '' },
    { app: 'tasks', permission: 'notifications.view', scope: '' },
    { app: 'tasks', permission: 'visitors.gate', scope: '' },
  ],
  duties: [],
};
