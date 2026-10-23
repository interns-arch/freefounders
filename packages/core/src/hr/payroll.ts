/** Payroll (old pages/Payroll.jsx): salary structures, advances, monthly runs and payslips. Module `payroll`. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import type { UserBrief } from '../tasks/types';
import type { ExportTarget } from '../export';

/** Money and day counts come from the API as decimal strings ("12500.00"). */
export type Money = string;

export interface SalaryStructure {
  id: number;
  user: number;
  user_detail: UserBrief;
  monthly_gross: Money;
  basic: Money | null;
  pf_percent: Money;
  professional_tax: Money;
  other_deduction: Money;
  effective_from: string;
  note: string;
  created_at: string;
}

export interface SalaryInput {
  user: number;
  monthly_gross: number | string;
  basic: number | string | null;
  pf_percent: number | string;
  professional_tax: number | string;
  other_deduction: number | string;
  effective_from: string;
  note: string;
}

export interface Advance {
  id: number;
  user: number;
  user_detail: UserBrief;
  amount: Money;
  given_on: string;
  reason: string;
  recovered: boolean;
  created_at: string;
}

export interface AdvanceInput {
  user: number;
  amount: number | string;
  given_on: string;
  reason: string;
}

export type PayrollRunStatus = 'draft' | 'finalised';

export interface PayrollRun {
  id: number;
  year: number;
  month: number;
  status: PayrollRunStatus;
  working_days: number;
  total_net: Money;
  payslip_count: number;
  created_by_detail: UserBrief | null;
  finalised_at: string | null;
  created_at: string;
}

export interface Payslip {
  id: number;
  run: number;
  month: number;
  year: number;
  run_status: PayrollRunStatus;
  user: number;
  user_detail: UserBrief;
  monthly_gross: Money;
  working_days: number;
  payable_days: Money;
  lwp_days: Money;
  earned_gross: Money;
  pf: Money;
  professional_tax: Money;
  advance_deduction: Money;
  other_deduction: Money;
  total_deductions: Money;
  net_payable: Money;
  breakdown: { present?: number; half_day?: number; paid_leave?: number; per_day?: Money | number; structure_id?: number; [k: string]: unknown } | null;
  note: string;
}

/** What POST /payroll-runs/:id/generate/ and /finalise/ answer. */
export interface PayrollRunResult {
  run: PayrollRun;
  payslips?: number;
  skipped_no_salary?: string[];
  advances_settled?: number;
}

function useInvalidatePayroll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['payroll'] });
}

/** GET /salary-structures/?user= — everyone's for hr.manage (or one person's with `user`), only mine otherwise. Newest first. */
export function useSalaryStructures(params: { user?: number; enabled?: boolean } = {}) {
  const q = { user: params.user };
  return useQuery({ queryKey: ['payroll', 'salaries', q], queryFn: () => tasksApi.get<SalaryStructure[]>('/salary-structures/', q), enabled: params.enabled ?? true });
}

/** POST /salary-structures/ (hr.manage). A new entry never overwrites an old one. */
export function useAddSalaryStructure() {
  const done = useInvalidatePayroll();
  return useMutation({ mutationFn: (body: SalaryInput) => tasksApi.post<SalaryStructure>('/salary-structures/', body), onSuccess: done });
}

/** GET /advances/ — everyone's for hr.manage, only mine otherwise. */
export function useAdvances(enabled = true) {
  return useQuery({ queryKey: ['payroll', 'advances'], queryFn: () => tasksApi.get<Advance[]>('/advances/'), enabled });
}

/** POST /advances/ (hr.manage). */
export function useAddAdvance() {
  const done = useInvalidatePayroll();
  return useMutation({ mutationFn: (body: AdvanceInput) => tasksApi.post<Advance>('/advances/', body), onSuccess: done });
}

/** DELETE /advances/:id/ — only while still pending. */
export function useDeleteAdvance() {
  const done = useInvalidatePayroll();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/advances/${id}/`), onSuccess: done });
}

/** GET /payroll-runs/ (hr.manage). */
export function usePayrollRuns(enabled = true) {
  return useQuery({ queryKey: ['payroll', 'runs'], queryFn: () => tasksApi.get<PayrollRun[]>('/payroll-runs/'), enabled });
}

/** GET /payroll-runs/:id/payslips/ */
export function useRunPayslips(runId: number | null) {
  return useQuery({ queryKey: ['payroll', 'run-payslips', runId], queryFn: () => tasksApi.get<Payslip[]>(`/payroll-runs/${runId}/payslips/`), enabled: runId != null });
}

/** POST /payroll-runs/ { year, month } — creates the draft and computes it from attendance. */
export function useCreatePayrollRun() {
  const done = useInvalidatePayroll();
  return useMutation({ mutationFn: (body: { year: number; month: number }) => tasksApi.post<PayrollRun>('/payroll-runs/', body), onSuccess: done });
}

/** POST /payroll-runs/:id/generate/ (recalculate a draft) or /finalise/. */
export function usePayrollRunAction() {
  const done = useInvalidatePayroll();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'generate' | 'finalise' }) => tasksApi.post<PayrollRunResult>(`/payroll-runs/${id}/${action}/`),
    onSuccess: done,
  });
}

/**
 * GET /payslips/?user=<me> — my payslips. The API gives hr.manage every payslip (drafts too), so the person's own id is
 * passed and only finalised runs are kept, exactly what everyone else gets.
 */
export function useMyPayslips(userId: number | undefined) {
  return useQuery({
    queryKey: ['payroll', 'payslips', 'mine', userId],
    queryFn: () => tasksApi.get<Payslip[]>('/payslips/', { user: userId }).then((rows) => rows.filter((s) => s.run_status === 'finalised')),
    enabled: userId != null,
  });
}

/**
 * Payroll downloads (PLAN.md §19.31): one payslip as PDF, a run's payslips as a ZIP of PDFs or one combined PDF, and
 * Excel/CSV of the runs, a run's payslips, salaries, advances and my payslips. Same permission checks as viewing.
 */
export const payrollExports = {
  payslipPdf: (id: number): ExportTarget => ({ api: 'tasks', path: `/payslips/${id}/pdf/`, param: 'none', formats: ['pdf'] }),
  runPayslips: (runId: number, bundle: 'zip' | 'pdf'): ExportTarget => ({ api: 'tasks', path: `/payroll-runs/${runId}/payslips_pdf/`, query: { bundle }, param: 'none', formats: [bundle] }),
  runSheet: (runId: number): ExportTarget => ({ api: 'tasks', path: `/payroll-runs/${runId}/export/` }),
  runs: (): ExportTarget => ({ api: 'tasks', path: '/payroll-runs/' }),
  salaries: (): ExportTarget => ({ api: 'tasks', path: '/salary-structures/' }),
  advances: (): ExportTarget => ({ api: 'tasks', path: '/advances/' }),
  /** Only finalised months, as My salary shows. */
  myPayslips: (userId: number): ExportTarget => ({ api: 'tasks', path: '/payslips/', query: { user: userId, status: 'finalised' } }),
};
