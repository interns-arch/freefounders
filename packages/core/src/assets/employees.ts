/** Employees: list, profile, history, status (notice / exit), portal access, ID cards. */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { Employee, EmployeeDetail, HistoryEvent } from './types';

/** A login made for an employee (shown once). */
export interface Credentials {
  loginId: string;
  employeeCode: string;
  email: string | null;
  password: string;
  created: boolean;
}

export interface AccessInput {
  roleId: string;
  username: string;
  email: string;
  password: string;
}

export function useEmployees(filters: Query) {
  return useQuery({ queryKey: assetsKey('employees', filters), queryFn: () => assetsApi.get<Page<Employee>>('/employees', filters) });
}

export function useEmployee(id: string | undefined) {
  return useQuery({ queryKey: assetsKey('employee', id), queryFn: () => assetsApi.get<EmployeeDetail>(`/employees/${id}`), enabled: !!id, placeholderData: undefined });
}

export function useEmployeeHistory(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: assetsKey('history', 'employee', id), queryFn: () => assetsApi.get<Page<HistoryEvent>>(`/employees/${id}/history`), enabled: !!id && enabled });
}

/** Several profiles at once (ID cards page). */
export function useEmployeesByIds(ids: string[]) {
  return useQuery({
    queryKey: assetsKey('id-cards', ids),
    queryFn: () => Promise.all(ids.map((id) => assetsApi.get<EmployeeDetail>(`/employees/${id}`))),
    enabled: ids.length > 0,
  });
}

/** Pickers: employees by name / code. */
export function usePickerEmployees(search: string, filter: Record<string, string | undefined> | undefined, enabled: boolean) {
  return useQuery({
    queryKey: assetsKey('picker', 'employees', search, filter),
    queryFn: () => assetsApi.get<Page<Employee>>('/employees', { search, pageSize: 20, ...filter }),
    enabled,
  });
}

/** POST /employees/:id/verify-assets — "everything they hold was checked today". */
export const useVerifyEmployeeAssets = mutationHook((id: string) => assetsApi.post(`/employees/${id}/verify-assets`, {}));

/** POST /employees/:id/access — make or change their login. */
export const useGrantEmployeeAccess = mutationHook(({ id, body }: { id: string; body: AccessInput }) => assetsApi.post<Credentials>(`/employees/${id}/access`, body));

/** PATCH /users/:id {isActive:false} — turn a login off. */
export const useDisableLogin = mutationHook((userId: string) => assetsApi.patch(`/users/${userId}`, { isActive: false }));

/** POST /employees or PATCH /employees/:id. */
export const useSaveEmployee = mutationHook(({ id, body }: { id?: string | null; body: unknown }) =>
  id ? assetsApi.patch<EmployeeDetail & { credentials?: Credentials | null }>(`/employees/${id}`, body) : assetsApi.post<EmployeeDetail & { credentials: Credentials | null }>('/employees', body),
);

/** POST /employees/:id/status — active / notice period (opens an exit case) / exited. */
export const useSetEmployeeStatus = mutationHook(
  ({ id, body }: { id: string; body: { status: string; lastWorkingDate: string | null; noticeDate: string | null; reason: string } }) =>
    assetsApi.post<{ ok: boolean; exitCaseId?: string }>(`/employees/${id}/status`, body),
);
