/** New joiners: HR lists what a joiner needs, IT approves and hands it over. */
import { useMutation, useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, type MutationOptions, mutationHook } from './keys';
import type { HistoryEvent, OnboardingDetail, OnboardingKit, OnboardingListItem } from './types';

export function useOnboardingList(filters: Query) {
  return useQuery({ queryKey: assetsKey('onboarding', filters), queryFn: () => assetsApi.get<Page<OnboardingListItem>>('/onboarding', { ...filters, view: undefined }) });
}
/** How many joiner lists wait for IT (the requests page tab). */
export function useOnboardingWaitingCount(enabled: boolean) {
  return useQuery({ queryKey: assetsKey('onboarding', 'waiting-count'), queryFn: () => assetsApi.get<Page<unknown>>('/onboarding', { status: 'SUBMITTED', pageSize: 1 }), enabled });
}
export function useOnboardingCase(id: string | undefined) {
  return useQuery({ queryKey: assetsKey('onboarding-case', id), queryFn: () => assetsApi.get<OnboardingDetail>(`/onboarding/${id}`), enabled: !!id });
}
export function useOnboardingHistory(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: assetsKey('history', 'onboarding', id), queryFn: () => assetsApi.get<Page<HistoryEvent>>(`/onboarding/${id}/history`), enabled: !!id && enabled });
}
export function useOnboardingKits() {
  return useQuery({ queryKey: assetsKey('onboarding-kits'), queryFn: () => assetsApi.get<OnboardingKit[]>('/onboarding-kits') });
}

export interface OnboardingActionInput {
  /** e.g. "/submit", "/approve", "/send-back", "/cancel", "/items/:itemId". */
  path: string;
  body?: unknown;
  method?: 'post' | 'patch' | 'del';
}
/** POST / PATCH / DELETE /onboarding/:id<path> — the case's workflow buttons. */
export function useOnboardingAction(caseId: string | undefined, options?: MutationOptions<unknown, OnboardingActionInput>) {
  return useMutation<unknown, Error, OnboardingActionInput>({
    ...options,
    mutationFn: ({ path, body, method = 'post' }) =>
      method === 'patch'
        ? assetsApi.patch(`/onboarding/${caseId}${path}`, body ?? {})
        : method === 'del'
          ? assetsApi.del(`/onboarding/${caseId}${path}`)
          : assetsApi.post(`/onboarding/${caseId}${path}`, body ?? {}),
  });
}

export interface KitItemInput {
  assetTypeId: string;
  itemName: string;
  quantity: number;
  notes: string;
}
/** POST /onboarding-kits — save (or update by name) a reusable kit. */
export function saveOnboardingKit(body: { name: string; items: KitItemInput[] }) {
  return assetsApi.post<{ updated: boolean }>('/onboarding-kits', body);
}
/** POST /onboarding/:id/items {items}. */
export function addOnboardingItems(caseId: string, items: KitItemInput[]) {
  return assetsApi.post(`/onboarding/${caseId}/items`, { items });
}
export const useAddOnboardingItems = mutationHook(({ caseId, items }: { caseId: string; items: KitItemInput[] }) => assetsApi.post(`/onboarding/${caseId}/items`, { items }));
export interface AssignAllResult {
  assigned: number;
  results: { ok: boolean; itemName: string; error?: string }[];
}
/** POST /onboarding/:id/assign-all {assignments}. */
export const useAssignAllOnboarding = mutationHook(({ caseId, assignments }: { caseId: string; assignments: { itemId: string; assetId: string }[] }) =>
  assetsApi.post<AssignAllResult>(`/onboarding/${caseId}/assign-all`, { assignments }),
);
/** POST /onboarding/:id/items/:itemId/issue {assetId}. */
export function issueOnboardingItem(caseId: string, itemId: string, assetId: string) {
  return assetsApi.post<{ allocationId: string; assetId: string }>(`/onboarding/${caseId}/items/${itemId}/issue`, { assetId });
}
/** PATCH /onboarding/:id {joinDate}. */
export const useSetJoinDate = mutationHook(({ caseId, joinDate }: { caseId: string; joinDate: string }) => assetsApi.patch(`/onboarding/${caseId}`, { joinDate }));
/** POST /onboarding — HR starts a joiner's list. */
export const useCreateOnboarding = mutationHook((body: unknown) => assetsApi.post<{ id: string; caseNumber: string }>('/onboarding', body));
