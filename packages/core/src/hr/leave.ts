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
  balance: number;
  pending: number;
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
  reason: string;
  document_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  status_display: string;
  reviewed_by_detail: UserBrief | null;
  remarks: string;
  reviewed_at: string | null;
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

/** POST /leaves/:id/review/ or /attendance-corrections/:id/review/ {decision, remarks}. */
export function useReviewHrRequest() {
  const done = useInvalidateHr();
  return useMutation({
    mutationFn: ({ kind, id, decision, remarks }: { kind: 'leave' | 'correction'; id: number; decision: 'approved' | 'rejected'; remarks: string }) =>
      tasksApi.post(kind === 'leave' ? `/leaves/${id}/review/` : `/attendance-corrections/${id}/review/`, { decision, remarks }),
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
