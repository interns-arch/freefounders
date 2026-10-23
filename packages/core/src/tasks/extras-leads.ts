/** Leads & quotations (old pages/Leads.jsx): /leads/, its sub-resources and /quotations/:id/. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import { leadsQuery } from './exports';
import type { UserBrief } from './types';

export type LeadStatus = 'new' | 'contacted' | 'quotation_sent' | 'negotiation' | 'won' | 'lost';
export type LeadSource = 'manual' | 'whatsapp' | 'gmail' | 'web' | 'indiamart' | 'tradeindia' | 'other';
export type LeadPriority = 'low' | 'normal' | 'high' | 'urgent';
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

/** The pipeline, in order (crm.models.LeadStatus). */
export const LEAD_STAGES: Array<[LeadStatus, string]> = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['quotation_sent', 'Quotation sent'],
  ['negotiation', 'Negotiation'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];
/** Stages that still count towards the open pipeline. */
export const LEAD_OPEN_STAGES: LeadStatus[] = ['new', 'contacted', 'quotation_sent', 'negotiation'];
export const LEAD_SOURCES: Array<[LeadSource, string]> = [
  ['manual', 'Manual'],
  ['whatsapp', 'WhatsApp'],
  ['gmail', 'Gmail'],
  ['web', 'Website'],
  ['indiamart', 'IndiaMART'],
  ['tradeindia', 'TradeIndia'],
  ['other', 'Other'],
];
export const LEAD_PRIORITIES: Array<[LeadPriority, string]> = [
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
];
export const QUOTATION_STATUSES: Array<[QuotationStatus, string]> = [
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
];

export interface Lead {
  id: number;
  customer_name: string;
  phone: string;
  email: string;
  company: string;
  requirement: string;
  source: LeadSource;
  source_display: string;
  department: string;
  department_display: string;
  status: LeadStatus;
  status_display: string;
  priority: LeadPriority;
  priority_display: string;
  assigned_to: number | null;
  assigned_to_detail: UserBrief | null;
  created_by_detail: UserBrief | null;
  follow_up_at: string | null;
  /** Decimal as a string from DRF. */
  estimated_value: string | null;
  is_overdue: boolean;
  ai_meta: Record<string, unknown>;
  /** The server's answer to "may I change this lead?" (crm.scoping.can_edit_lead). */
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

/** What the Add / Edit lead form sends (PATCH may send any subset). */
export interface LeadInput {
  customer_name: string;
  phone: string;
  email: string;
  company: string;
  requirement: string;
  source: LeadSource;
  department: string;
  priority: LeadPriority;
  assigned_to: number | null;
  follow_up_at: string | null;
  estimated_value: string | number | null;
}

export interface LeadFilters {
  search?: string;
  status?: LeadStatus | '';
  priority?: LeadPriority | '';
  source?: LeadSource | '';
  assigned_to?: number | string | '';
  department?: string;
  overdue?: boolean;
}

export interface LeadSummary {
  by_status: Record<LeadStatus, number>;
  total: number;
  overdue: number;
}

export type LeadEventType = 'created' | 'status_change' | 'assignment' | 'note' | 'follow_up' | 'document' | 'quotation' | string;

export interface LeadEvent {
  id: number;
  type: LeadEventType;
  type_display: string;
  body: string;
  actor: UserBrief | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface LeadDocument {
  id: number;
  filename: string;
  url: string | null;
  uploaded_by: UserBrief | null;
  created_at: string;
}

export interface Quotation {
  id: number;
  number: string;
  amount: string;
  status: QuotationStatus;
  status_display: string;
  notes: string;
  created_by: UserBrief | null;
  created_at: string;
}

export const leadKeys = {
  all: ['leads'] as const,
  list: (f: Record<string, unknown>) => ['leads', 'list', f] as const,
  summary: ['leads', 'summary'] as const,
  events: (id: number) => ['leads', 'events', id] as const,
  documents: (id: number) => ['leads', 'documents', id] as const,
  quotations: (id: number) => ['leads', 'quotations', id] as const,
};

/** GET /leads/?search=&priority=&source=&assigned_to=&overdue=true (up to 300, like the old board). */
export function useLeads(filters: LeadFilters = {}, options: { enabled?: boolean } = {}) {
  const q = leadsQuery(filters);
  return useQuery({
    queryKey: leadKeys.list(q),
    queryFn: () => tasksApi.get<DrfPage<Lead> | Lead[]>('/leads/', { page_size: 300, ...q }).then(resultsOf),
    enabled: options.enabled ?? true,
  });
}

/** GET /leads/summary/ — counts per stage, total and overdue follow-ups (for the leads I can see). */
export function useLeadSummary(enabled = true) {
  return useQuery({ queryKey: leadKeys.summary, queryFn: () => tasksApi.get<LeadSummary>('/leads/summary/'), enabled });
}

/** Every change to a lead refreshes the board, the summary and the open lead's timeline. */
export function useInvalidateLeads() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: leadKeys.all });
}

/** POST /leads/ */
export function useCreateLead() {
  const done = useInvalidateLeads();
  return useMutation({ mutationFn: (body: LeadInput) => tasksApi.post<Lead>('/leads/', body), onSuccess: done });
}

/** PATCH /leads/:id/ — status (the pipeline move), priority, assignee, follow-up or any detail. */
export function useUpdateLead() {
  const done = useInvalidateLeads();
  return useMutation({ mutationFn: ({ id, ...body }: Partial<LeadInput> & { id: number; status?: LeadStatus }) => tasksApi.patch<Lead>(`/leads/${id}/`, body), onSuccess: done });
}

/** DELETE /leads/:id/ — admins only. */
export function useDeleteLead() {
  const done = useInvalidateLeads();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/leads/${id}/`), onSuccess: done });
}

/** GET /leads/:id/events/ — the timeline, newest first. */
export function useLeadEvents(id: number | null) {
  return useQuery({ queryKey: leadKeys.events(id ?? 0), queryFn: () => tasksApi.get<LeadEvent[]>(`/leads/${id}/events/`), enabled: id != null });
}

/** POST /leads/:id/notes/ {body} */
export function useAddLeadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => tasksApi.post<LeadEvent>(`/leads/${id}/notes/`, { body }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: leadKeys.events(v.id) }),
  });
}

/** GET /leads/:id/documents/ */
export function useLeadDocuments(id: number | null) {
  return useQuery({ queryKey: leadKeys.documents(id ?? 0), queryFn: () => tasksApi.get<LeadDocument[]>(`/leads/${id}/documents/`), enabled: id != null });
}

/** POST /leads/:id/documents/ (multipart, one file, 10 MB max on the server). */
export function useUploadLeadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return tasksApi.upload<LeadDocument>(`/leads/${id}/documents/`, form);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: leadKeys.documents(v.id) });
      qc.invalidateQueries({ queryKey: leadKeys.events(v.id) });
    },
  });
}

/** GET /leads/:id/quotations/ */
export function useLeadQuotations(id: number | null) {
  return useQuery({ queryKey: leadKeys.quotations(id ?? 0), queryFn: () => tasksApi.get<Quotation[]>(`/leads/${id}/quotations/`), enabled: id != null });
}

/** POST /leads/:id/quotations/ {amount, notes} — needs quotations.manage and edit rights on the lead. */
export function useAddQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, notes }: { id: number; amount: string | number; notes: string }) => tasksApi.post<Quotation>(`/leads/${id}/quotations/`, { amount, notes }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: leadKeys.quotations(v.id) });
      qc.invalidateQueries({ queryKey: leadKeys.events(v.id) });
    },
  });
}

/** PATCH /quotations/:id/ {status | notes} */
export function useUpdateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; leadId: number; status?: QuotationStatus; notes?: string }) => {
      const { leadId: _l, ...rest } = body;
      return tasksApi.patch<Quotation>(`/quotations/${id}/`, rest);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: leadKeys.quotations(v.leadId) });
      qc.invalidateQueries({ queryKey: leadKeys.events(v.leadId) });
    },
  });
}

/** "₹1.2 Cr" / "₹4.5 L" / "₹12,000", or null when empty — the old board's money format. */
export function fmtINR(n: string | number | null | undefined): string | null {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}
