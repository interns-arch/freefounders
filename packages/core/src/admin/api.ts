/** Admin API functions + hooks (Platform: /api/platform). Same endpoints the old portal called. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '../http';
import { LOOKUP } from '../query';
import type { AppKey } from '../session';
import type {
  AppCatalogue,
  AppInfo,
  CompanyProfileInput,
  CompanySettings,
  CreatedPerson,
  DeletedPerson,
  DeleteOptions,
  Department,
  ExitResult,
  LoginReset,
  NewPerson,
  Person,
  PersonFields,
  ResetLoginInput,
  Role,
  RoleInput,
  SyncResult,
} from './types';

export const adminKeys = {
  all: ['admin'] as const,
  people: (search = '') => ['admin', 'people', search] as const,
  roles: ['admin', 'roles'] as const,
  catalogue: ['admin', 'roles-catalogue'] as const,
  apps: ['admin', 'apps'] as const,
  departments: ['admin', 'departments'] as const,
  company: ['admin', 'company'] as const,
};

// ─── API functions ─────────────────────────────────────────────────────────

export const adminApi = {
  people: (search = '') => platformApi.get<Person[]>('/people', { search }),
  createPerson: (body: NewPerson) => platformApi.post<CreatedPerson>('/people', body),
  updatePerson: (id: string, body: Partial<PersonFields> & { status?: Person['status'] }) => platformApi.patch<Person>(`/people/${id}`, body),
  resetLogin: (id: string, body: ResetLoginInput = {}) => platformApi.put<LoginReset>(`/people/${id}/login`, body),
  deletePerson: (id: string, confirm: string, options?: DeleteOptions) => platformApi.del<DeletedPerson>(`/people/${id}`, options ? { confirm, options } : { confirm }),
  setPersonRoles: (id: string, roleIds: string[]) => platformApi.put<unknown>(`/people/${id}/roles`, { roleIds }),
  startExit: (id: string, body: { lastWorkingDate: string; reason: string | null }) => platformApi.post<ExitResult>(`/people/${id}/exit`, body),
  apps: () => platformApi.get<AppInfo[]>('/apps'),

  roles: () => platformApi.get<Role[]>('/roles'),
  catalogue: () => platformApi.get<AppCatalogue[]>('/roles/catalogue'),
  createRole: (body: RoleInput) => platformApi.post<Role>('/roles', body),
  updateRole: (id: string, body: RoleInput) => platformApi.patch<Role>(`/roles/${id}`, body),
  duplicateRole: (id: string) => platformApi.post<Role>(`/roles/${id}/duplicate`),
  archiveRole: (id: string) => platformApi.del<unknown>(`/roles/${id}`),

  departments: () => platformApi.get<Department[]>('/departments'),
  createDepartment: (name: string) => platformApi.post<Department>('/departments', { name }),
  updateDepartment: (id: string, body: { name?: string; active?: boolean }) => platformApi.patch<Department>(`/departments/${id}`, body),

  company: () => platformApi.get<CompanySettings>('/company'),
  updateCompany: (body: CompanyProfileInput) => platformApi.patch<CompanySettings>('/company', body),
  uploadLogo: (image: string) => platformApi.put<{ logoUrl: string | null; sync: SyncResult }>('/company/logo', { image }),
  removeLogo: () => platformApi.del<{ logoUrl: null; sync: SyncResult }>('/company/logo'),
  setModules: (changes: Partial<Record<AppKey, Record<string, boolean>>>) => platformApi.put<CompanySettings>('/company/modules', changes),
};

// ─── queries ────────────────────────────────────────────────────────────────

/** GET /people?search= (everyone when blank). */
export function usePeople(search = '') {
  return useQuery({ queryKey: adminKeys.people(search), queryFn: () => adminApi.people(search) });
}
/** GET /apps — the apps in the company's plan. */
export function usePlatformApps() {
  return useQuery({ queryKey: adminKeys.apps, queryFn: adminApi.apps, ...LOOKUP });
}
export function useRoles() {
  return useQuery({ queryKey: adminKeys.roles, queryFn: adminApi.roles });
}
/** Every permission each app offers, with the scopes it can take. */
export function useRoleCatalogue() {
  return useQuery({ queryKey: adminKeys.catalogue, queryFn: adminApi.catalogue, ...LOOKUP });
}
export function useDepartments() {
  return useQuery({ queryKey: adminKeys.departments, queryFn: adminApi.departments });
}
export function useCompanySettings() {
  return useQuery({ queryKey: adminKeys.company, queryFn: adminApi.company });
}

// ─── mutations ──────────────────────────────────────────────────────────────

/** People, roles and departments show each other's counts: reload all admin lists after a change. */
function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: adminKeys.all });
}
/** Role changes can change what the signed-in person holds themselves (/auth/me `held`, R1). */
function useInvalidateRoles() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: adminKeys.all }), qc.invalidateQueries({ queryKey: ['platform', 'me'] })]);
}

export function useCreatePerson() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createPerson, onSuccess: invalidate });
}
export function useUpdatePerson() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PersonFields> & { id: string; status?: Person['status'] }) => adminApi.updatePerson(id, body),
    onSuccess: invalidate,
  });
}
/** Creates a login, or sets a new password: the admin's own or a generated one (signs them out everywhere). */
export function useResetLogin() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: ({ id, ...body }: ResetLoginInput & { id: string }) => adminApi.resetLogin(id, body), onSuccess: invalidate });
}
/**
 * Deletes a person (PLAN.md §19.12). `confirm` is their full name; `options` hand over or keep their work (none = erase everything).
 * A 400 means a choice was refused (nothing changed).
 * A 502 means an app could not delete: they stay switched off and it can be tried again.
 */
export function useDeletePerson() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: ({ id, confirm, options }: { id: string; confirm: string; options?: DeleteOptions }) => adminApi.deletePerson(id, confirm, options), onSuccess: invalidate });
}
export function useSetPersonRoles() {
  const invalidate = useInvalidateRoles();
  return useMutation({ mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) => adminApi.setPersonRoles(id, roleIds), onSuccess: invalidate });
}
/** Start someone's exit (PLAN.md §17.4): Assets lists the assets to recover, Tasks makes the exit checklist. */
export function useStartExit() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; lastWorkingDate: string; reason: string | null }) => adminApi.startExit(id, body),
    onSuccess: invalidate,
  });
}

/** POST /roles, or PATCH /roles/:id when `id` is given. */
export function useSaveRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, ...body }: RoleInput & { id?: string }) => (id ? adminApi.updateRole(id, body) : adminApi.createRole(body)),
    onSuccess: invalidate,
  });
}
export function useDuplicateRole() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.duplicateRole, onSuccess: invalidate });
}
export function useArchiveRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({ mutationFn: adminApi.archiveRole, onSuccess: invalidate });
}

export function useCreateDepartment() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createDepartment, onSuccess: invalidate });
}
export function useUpdateDepartment() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; active?: boolean }) => adminApi.updateDepartment(id, body),
    onSuccess: invalidate,
  });
}

/** Company name, brand and modules feed the shell (brand, menus) and the apps: reload those too. */
function useCompanyChanged() {
  const qc = useQueryClient();
  return (company?: CompanySettings) => {
    if (company) qc.setQueryData(adminKeys.company, company);
    void qc.invalidateQueries({ queryKey: adminKeys.company });
    void qc.invalidateQueries({ queryKey: ['platform', 'me'] });
    void qc.invalidateQueries({ queryKey: ['tasks', 'me'] });
    void qc.invalidateQueries({ queryKey: ['assets', 'config'] });
  };
}

export function useUpdateCompany() {
  const changed = useCompanyChanged();
  return useMutation({ mutationFn: adminApi.updateCompany, onSuccess: (c) => changed(c) });
}
/** `image` is a data URL (PNG, JPEG or WebP, at most LOGO_MAX_BYTES). */
export function useUploadLogo() {
  const changed = useCompanyChanged();
  return useMutation({ mutationFn: adminApi.uploadLogo, onSuccess: () => changed() });
}
export function useRemoveLogo() {
  const changed = useCompanyChanged();
  return useMutation({ mutationFn: adminApi.removeLogo, onSuccess: () => changed() });
}
/** Switch one module of one app on or off. */
export function useSetModule() {
  const changed = useCompanyChanged();
  return useMutation({
    mutationFn: ({ app, key, on }: { app: AppKey; key: string; on: boolean }) => adminApi.setModules({ [app]: { [key]: on } }),
    onSuccess: (c) => changed(c),
  });
}
