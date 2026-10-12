/** HR settings: attendance rules (PLAN.md §16.1), office locations (old pages/HR.jsx). No face check (PLAN.md §19.18). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';

/** One saved rule: its value, whether the company set it (else the default), and what may be chosen. */
export interface HrSetting<T> {
  value: T;
  custom: boolean;
  kind: string;
  choices: string[] | null;
  range: [number, number] | null;
}

export interface HrSettingValues {
  work_start: string;
  work_end: string;
  grace_minutes: number;
  half_day_hours: number;
  full_day_hours: number;
  week_offs: number[];
  geofence_enabled: boolean;
  photo: 'off' | 'optional' | 'required';
  photo_retention_days: number;
  leave_approval: 'department' | 'manager';
  approval_remind_hours: number;
}

export type HrSettings = { [K in keyof HrSettingValues]: HrSetting<HrSettingValues[K]> };

/** GET /hr/settings/ */
export function useHrSettings() {
  return useQuery({ queryKey: ['hr', 'settings'], queryFn: () => tasksApi.get<HrSettings>('/hr/settings/') });
}

/** PUT /hr/settings/ — field errors come back on the ApiError (`errors`). */
export function useSaveHrSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Record<keyof HrSettingValues, unknown>>) => tasksApi.put<HrSettings>('/hr/settings/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

export interface OfficeLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  active: boolean;
}

export function useOfficeLocations() {
  return useQuery({ queryKey: ['hr', 'offices'], queryFn: () => tasksApi.get<DrfPage<OfficeLocation> | OfficeLocation[]>('/office-locations/').then(resultsOf) });
}
export function useAddOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; latitude: number; longitude: number; radius_m: number }) => tasksApi.post<OfficeLocation>('/office-locations/', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}
export function useDeleteOffice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/office-locations/${id}/`), onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }) });
}
