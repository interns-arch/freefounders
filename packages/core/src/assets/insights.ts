/** Dashboards: the home dashboard (organisation or personal), leadership numbers, the IT priority queue. */
import type { AssetStatus, HolderType } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '../http';
import { assetsKey } from './keys';
import type { HeldAsset, HistoryEvent, Queue } from './types';

export interface OrgDashboard {
  scope: 'organisation';
  totals: {
    assets: number;
    assigned: number;
    available: number;
    inMaintenance: number;
    lost: number;
    employees: number;
    onNotice: number;
    pendingRequests: number;
    approvedRequests: number;
    openTickets: number;
    warrantyExpiring: number;
    exitPendingItems: number;
  };
  byStatus: Partial<Record<AssetStatus, number>>;
  byCategory: { id: string; name: string; icon: string | null; color: string | null; count: number; assigned: number }[];
  byHolder: Partial<Record<HolderType, number>>;
  byType: { id: string; name: string; icon: string | null; available: number; total: number }[];
  expiring: { id: string; assetTag: string; name: string; warrantyExpiry: string; holderName: string | null }[];
  exits: { id: string; caseNumber: string; lastWorkingDate: string; employeeName: string; employeeId: string; total: number; pending: number }[];
  activity: HistoryEvent[];
}
export interface PersonalDashboard {
  scope: 'personal';
  myAssets: HeldAsset[];
  requests: {
    id: string;
    number: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'CANCELLED';
    createdAt: string;
    typeName: string;
    quantity: number;
    decisionNote: string | null;
  }[];
  tickets: { id: string; number: string; title: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'; createdAt: string }[];
  openExit: { id: string; caseNumber: string; lastWorkingDate: string } | null;
}
export interface Leadership {
  days: number;
  headline: { headcount: number; joiners: number; leavers: number; upcomingJoiners: number; onNotice: number; assetsInUse: number; assetsAvailable: number };
  service: {
    ticketsOpened: number;
    ticketsResolved: number;
    ticketsOpen: number;
    ticketsStale: number;
    avgResolutionHours: number | null;
    requestsRaised: number;
    requestsFulfilled: number;
    requestsWaiting: number;
    avgFulfilDays: number | null;
    handovers: number;
    exitsCompleted: number;
    itemsRecovered: number;
    itemsWrittenOff: number;
    onboardingsCompleted: number;
    onboardingsOnTime: number;
  };
  team: {
    id: string;
    name: string;
    roleName: string;
    ticketsResolved: number;
    ticketsOpen: number;
    avgResolutionHours: number | null;
    handovers: number;
    returns: number;
    requestsFulfilled: number;
    onboardingItems: number;
    lastActive: string | null;
  }[];
  departments: { id: string; name: string; headcount: number; onNotice: number; assetsHeld: number; pendingRecovery: number }[];
}

export function useAssetsDashboard() {
  return useQuery({ queryKey: assetsKey('dashboard'), queryFn: () => assetsApi.get<OrgDashboard | PersonalDashboard>('/dashboard'), refetchInterval: 60_000 });
}
export function useLeadership(days: string) {
  return useQuery({ queryKey: assetsKey('leadership', days), queryFn: () => assetsApi.get<Leadership>('/leadership', { days }) });
}
/** GET /queue — IT's priority queue (refreshes every 30 s). */
export function useQueue(params: Record<string, string> = {}) {
  return useQuery({ queryKey: assetsKey('queue', params), queryFn: () => assetsApi.get<Queue>('/queue', params), refetchInterval: 30_000 });
}
