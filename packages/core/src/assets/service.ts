/** Requests (ask for an asset), tickets (report a problem) and maintenance (repairs, servicing). */
import { useQuery } from '@tanstack/react-query';
import { ApiError, assetsApi, type Page, type Query } from '../http';
import { assetsKey, mutationHook } from './keys';
import type { AssetRequest, MaintenanceRecord, Ticket } from './types';

// ─── requests ───
export function useRequests(filters: Query) {
  return useQuery({
    queryKey: assetsKey('requests', filters),
    queryFn: () => assetsApi.get<Page<AssetRequest>>('/requests', { ...filters, status: filters.status === 'ALL' ? '' : filters.status, open: undefined }),
  });
}
/**
 * One request by id (notification links open /assets/requests?open=<id>). The API has no GET /requests/:id, so this
 * looks through the requests this person can see (up to 1,000).
 */
/** GET /requests/:id — null when it does not exist or this person may not see it. */
export async function findRequest(id: string): Promise<AssetRequest | null> {
  try {
    return await assetsApi.get<AssetRequest>(`/requests/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}
export function useRequest(id: string | null | undefined) {
  return useQuery({ queryKey: assetsKey('requests', 'one', id), queryFn: () => findRequest(id!), enabled: !!id, placeholderData: undefined });
}
/** POST /requests/:id/decision {decision, note} · /cancel. */
export const useRequestAction = mutationHook(({ id, path, body }: { id: string; path: string; body?: unknown }) => assetsApi.post(`/requests/${id}/${path}`, body ?? {}));
/** POST /requests/:id/fulfil {assetId}. */
export function fulfilRequest(id: string, assetId: string) {
  return assetsApi.post<{ allocationId: string }>(`/requests/${id}/fulfil`, { assetId });
}
export const useCreateRequest = mutationHook((body: unknown) => assetsApi.post<{ number: string }>('/requests', body));

// ─── tickets ───
export function useTickets(filters: Query) {
  return useQuery({
    queryKey: assetsKey('tickets', filters),
    queryFn: () => assetsApi.get<Page<Ticket>>('/tickets', { ...filters, status: filters.status === 'ALL' ? '' : filters.status, open: undefined }),
  });
}
export function useTicket(id: string | null | undefined) {
  return useQuery({ queryKey: assetsKey('ticket', id), queryFn: () => assetsApi.get<Ticket>(`/tickets/${id}`), enabled: !!id, placeholderData: undefined });
}
export const useUpdateTicket = mutationHook(({ id, body }: { id: string; body: { status: string; assigneeId: string | null; resolution: string } }) => assetsApi.patch(`/tickets/${id}`, body));
export const useCreateTicket = mutationHook((body: unknown) => assetsApi.post<{ number: string }>('/tickets', body));

// ─── maintenance ───
export function useMaintenanceList(filters: Query) {
  return useQuery({
    queryKey: assetsKey('maintenance', filters),
    queryFn: () => assetsApi.get<Page<MaintenanceRecord>>('/maintenance', { ...filters, status: filters.status === 'ALL' ? '' : filters.status }),
  });
}
export const useUpdateMaintenance = mutationHook(({ id, body }: { id: string; body: unknown }) => assetsApi.patch(`/maintenance/${id}`, body));
export const useCreateMaintenance = mutationHook((body: unknown) => assetsApi.post<{ number: string }>('/maintenance', body));
