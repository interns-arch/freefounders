/** Leave, leave types, holidays and approvals (old pages/HR.jsx). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { UserBrief } from '../tasks/types';

export interface LeaveType {
  id: number;
  name: string;
  annual_quota: number;
  paid: boolean;
  requires_document: boolean;
  active: boolean;
}

export interface LeaveBalance {
  leave_type: number;
  name: string;
  paid: boolean;
  quota: number;
  /** Approved days (half days count 0.5). */
  used?: number;
  /** quota - used (approved only). */
  balance: number;
  pending: number;
  /** A balance is enforced for this type (paid with a quota, or comp-off); unpaid / no-quota types are unlimited. */
  limited?: boolean;
  /** What can still be asked for: quota - approved - pending; null when unlimited. */
  available?: number | null;
}

/** For a pending request: would approving it go beyond the person's balance? (null when the type is unlimited) */
export interface LeaveBalanceCheck {
  available: number;
  needs: number;
  over: boolean;
}

export interface LeaveRequest {
  id: number;
  user: number;
  user_detail: UserBrief;
  leave_type: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  days: number;
  /** Half a day (one date): counts 0.5. */
  half_day?: boolean;
  /** What it takes from the balance: 0.5 for a half day, else `days`. */
  leave_days?: number;
  reason: string;
  document_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  status_display: string;
  reviewed_by_detail: UserBrief | null;
  remarks: string;
  reviewed_at: string | null;
  /** Approved (or marked by HR) beyond the balance with the explicit override: who and when. */
  beyond_balance?: boolean;
  beyond_balance_by_detail?: UserBrief | null;
  beyond_balance_at?: string | null;
  balance_check?: LeaveBalanceCheck | null;
  created_at: string;
}

function useInvalidateHr() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['hr'] });
}

export function useLeaveTypes() {
  return useQuery({ queryKey: ['hr', 'leave-types'], queryFn: () => tasksApi.get<DrfPage<LeaveType> | LeaveType[]>('/leave-types/').then(resultsOf) });
}

export function useLeaveBalances() {
  return useQuery({ queryKey: ['hr', 'balances'], queryFn: () => tasksApi.get<LeaveBalance[]>('/leaves/balances/') });
}

/** GET /leaves/?page_size=100 — my requests. */
export function useMyLeaves() {
  return useQuery({ queryKey: ['hr', 'leaves', 'mine'], queryFn: () => tasksApi.get<DrfPage<LeaveRequest> | LeaveRequest[]>('/leaves/', { page_size: 100 }).then(resultsOf) });
}

export interface LeaveInput {
  leave_type: number | string;
  start_date: string;
  end_date: string;
  reason: string;
  /** Half a day (start and end the same date). */
  half_day?: boolean;
  /** A supporting document (sent as multipart when given). */
  document?: Blob & { name?: string };
}

/** POST /leaves/ — JSON, or multipart with the supporting document. */
export function useApplyLeave() {
  const done = useInvalidateHr();
  return useMutation({
    mutationFn: ({ document, ...body }: LeaveInput) => {
      if (!document) return tasksApi.post<LeaveRequest>('/leaves/', body);
      const fd = new FormData();
      for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
      fd.append('document', document, document.name ?? 'document');
      return tasksApi.upload<LeaveRequest>('/leaves/', fd);
    },
    onSuccess: done,
  });
}

export function useCancelLeave() {
  const done = useInvalidateHr();
  return useMutation({ mutationFn: (id: number) => tasksApi.post(`/leaves/${id}/cancel/`), onSuccess: done });
}

/** Pending leave of the people I approve for. */
export function usePendingLeaves(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'leaves', 'pending'],
    queryFn: () => tasksApi.get<DrfPage<LeaveRequest> | LeaveRequest[]>('/leaves/', { scope: 'team', status: 'pending', page_size: 100 }).then(resultsOf),
    enabled,
  });
}

/**
 * POST /leaves/:id/review/ or /attendance-corrections/:id/review/ {decision, remarks}. `beyondBalance`: approve leave
 * beyond the person's balance (HR only; logged on the request).
 */
export function useReviewHrRequest() {
  const done = useInvalidateHr();
  return useMutation({
    mutationFn: ({ kind, id, decision, remarks, beyondBalance }: { kind: 'leave' | 'correction'; id: number; decision: 'approved' | 'rejected'; remarks: string; beyondBalance?: boolean }) =>
      tasksApi.post(kind === 'leave' ? `/leaves/${id}/review/` : `/attendance-corrections/${id}/review/`, { decision, remarks, ...(beyondBalance ? { beyond_balance: true } : {}) }),
    onSuccess: done,
  });
}

export function useAddLeaveType() {
  const done = useInvalidateHr();
  return useMutation({
    mutationFn: (body: { name: string; annual_quota: number; paid: boolean; requires_document: boolean }) => tasksApi.post<LeaveType>('/leave-types/', body),
    onSuccess: done,
  });
}

// ─── holidays ────────────────────────────────────────────────────────────

export interface Holiday {
  id: number;
  name: string;
  date: string;
}

export function useHolidays() {
  return useQuery({ queryKey: ['hr', 'holidays'], queryFn: () => tasksApi.get<DrfPage<Holiday> | Holiday[]>('/holidays/').then(resultsOf) });
}
export function useAddHoliday() {
  const done = useInvalidateHr();
  return useMutation({ mutationFn: (body: { name: string; date: string }) => tasksApi.post<Holiday>('/holidays/', body), onSuccess: done });
}
export function useDeleteHoliday() {
  const done = useInvalidateHr();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/holidays/${id}/`), onSuccess: done });
}
