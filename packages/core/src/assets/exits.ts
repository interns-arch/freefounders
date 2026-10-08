/** Exit cases: the asset-recovery checklist of someone leaving. */
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { ExitItemStatus } from '@eam/shared';
import type { ExitCaseDetail, ExitCaseListItem, ExitItem, HistoryEvent } from './types';

export function useExitCases(filters: Query) {
  return useQuery({ queryKey: assetsKey('exits', filters), queryFn: () => assetsApi.get<Page<ExitCaseListItem>>('/exit-cases', filters) });
}
/** All open cases (summary cards on the exits page). */
export function useOpenExitCases() {
  return useQuery({ queryKey: assetsKey('exits', 'open-summary'), queryFn: () => assetsApi.get<Page<ExitCaseListItem>>('/exit-cases', { status: 'OPEN', pageSize: 200 }) });
}
export function useExitCase(id: string | undefined) {
  return useQuery({ queryKey: assetsKey('exit', id), queryFn: () => assetsApi.get<ExitCaseDetail>(`/exit-cases/${id}`), enabled: !!id, placeholderData: undefined });
}
export function useExitHistory(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: assetsKey('history', 'exit', id), queryFn: () => assetsApi.get<Page<HistoryEvent>>(`/exit-cases/${id}/history`), enabled: !!id && enabled });
}

export const useUpdateExitItem = mutationHook(({ caseId, item, status }: { caseId: string; item: ExitItem; status: ExitItemStatus }) =>
  assetsApi.patch(`/exit-cases/${caseId}/items/${item.id}`, { status }),
);
export const useScanExitItem = mutationHook(({ caseId, code }: { caseId: string; code: string }) =>
  assetsApi.post<{ item: ExitItem; alreadyCleared: boolean }>(`/exit-cases/${caseId}/scan`, { code }),
);
export const useCompleteExit = mutationHook((caseId: string) => assetsApi.post(`/exit-cases/${caseId}/complete`));
export const useOverrideExit = mutationHook(({ caseId, reason }: { caseId: string; reason: string }) => assetsApi.post(`/exit-cases/${caseId}/override`, { reason }));
export const useCancelExit = mutationHook(({ caseId, reason }: { caseId: string; reason: string }) => assetsApi.post(`/exit-cases/${caseId}/cancel`, { reason }));
export const useAddExitItem = mutationHook(({ caseId, assetName, notes }: { caseId: string; assetName: string; notes: string }) =>
  assetsApi.post(`/exit-cases/${caseId}/items`, { assetName, notes }),
);
