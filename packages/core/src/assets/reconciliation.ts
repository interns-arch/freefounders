/**
 * Reconciliation: an Airtel connections or Salary Box employees export is checked against the register
 * (SIM module). Parsing the Excel file happens in the screen (browser only); the API gets just the known columns.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReconSource, ReconStatus, ReconUploadInput } from '@eam/shared';
import { assetsApi } from '../http';
import { assetsKey, invalidateAssetData, mutationHook } from './keys';

export interface ReconIssue {
  field: string;
  label: string;
  dump: string | null;
  system: string | null;
  /** error: the two sides disagree; warning: worth a look (e.g. a name spelled differently). */
  level: 'error' | 'warning';
}

export interface ReconItem {
  status: ReconStatus;
  key: string;
  title: string;
  subtitle: string | null;
  entity: { kind: 'ASSET' | 'EMPLOYEE'; id: string; label: string } | null;
  issues: ReconIssue[];
  /** Airtel rows with no SIM record: what is needed to add it (and whom to assign it to). */
  addSim?: { connectionNumber: string; simNumber?: string | null; plan?: string | null; circle?: string | null; billableId?: string | null; employeeId: string | null; employeeName: string | null };
}

/** One row of GET /reconciliations. `summary` counts by status plus `warnings` (matched with notes). */
export interface ReconRunSummary {
  id: string;
  source: ReconSource;
  fileName: string;
  rowCount: number;
  summary: Record<string, number>;
  createdByName: string | null;
  createdAt: string;
}

export interface ReconRun extends ReconRunSummary {
  repairedRows: number;
  items: ReconItem[];
}

export interface AddSimsResult {
  added: number;
  results: { key: string; ok: boolean; error?: string }[];
  summary: Record<string, number>;
}

/** GET /reconciliations: the last 100 checks this person may see. */
export function useReconciliations() {
  return useQuery({ queryKey: assetsKey('reconciliations'), queryFn: () => assetsApi.get<ReconRunSummary[]>('/reconciliations') });
}

/** GET /reconciliations/:id: one check with every row's result. */
export function useReconciliation(id: string | null | undefined) {
  return useQuery({ queryKey: assetsKey('reconciliation', id), queryFn: () => assetsApi.get<ReconRun>(`/reconciliations/${id}`), enabled: !!id, placeholderData: undefined });
}

/** POST /reconciliations: runs the check and notifies the team. */
export const useRunReconciliation = mutationHook((body: ReconUploadInput) => assetsApi.post<{ id: string; summary: Record<string, number> }>('/reconciliations', body));

/** POST /reconciliations/:id/add-sims {keys}: adds Airtel connections to the SIM register (and assigns them). */
export const useAddReconSims = mutationHook(({ id, keys }: { id: string; keys: string[] }) => assetsApi.post<AddSimsResult>(`/reconciliations/${id}/add-sims`, { keys }));

/** Refreshes the check lists (and the notification bell) after a run; also everything that shows assets after SIMs are added. */
export function useInvalidateReconciliation() {
  const qc = useQueryClient();
  return async (id?: string, assetsChanged = false) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: assetsKey('reconciliations') }),
      id ? qc.invalidateQueries({ queryKey: assetsKey('reconciliation', id) }) : Promise.resolve(),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
      assetsChanged ? invalidateAssetData(qc) : Promise.resolve(),
    ]);
  };
}
