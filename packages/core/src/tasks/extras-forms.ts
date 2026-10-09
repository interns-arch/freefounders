/**
 * Web forms (old pages/Forms.jsx, FormRenderer.jsx, PublicForm.jsx): /forms/, /form-fields/ and the public
 * /public/forms/<token>/ endpoints of the Tasks API (backend/webforms). The public page runs with no sign-in:
 * the HTTP client simply sends no token then (the endpoints allow anyone).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import type { UserBrief } from './types';

export type FormFieldType = 'short_text' | 'long_text' | 'number' | 'email' | 'phone' | 'date' | 'dropdown' | 'radio' | 'checkbox' | 'file';
export type FormStatus = 'draft' | 'published' | 'closed';

export const FORM_FIELD_TYPES: Array<[FormFieldType, string]> = [
  ['short_text', 'Short text'],
  ['long_text', 'Long text'],
  ['number', 'Number'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['date', 'Date'],
  ['dropdown', 'Dropdown'],
  ['radio', 'Radio'],
  ['checkbox', 'Checkbox'],
  ['file', 'File upload'],
];
/** Field types that need a list of options. */
export const FORM_FIELD_TYPES_WITH_OPTIONS: FormFieldType[] = ['dropdown', 'radio', 'checkbox'];
/** What a field can fill on the lead a submission creates. */
export const FORM_LEAD_ATTRS: Array<[string, string]> = [
  ['', '—'],
  ['customer_name', 'Customer name'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['requirement', 'Requirement'],
];
export const FORM_STATUS_LABELS: Record<FormStatus, string> = { draft: 'Draft', published: 'Published', closed: 'Closed' };

export interface FormField {
  id: number;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  lead_attr: string;
  order: number;
}

export interface WebForm {
  id: number;
  name: string;
  description: string;
  status: FormStatus;
  status_display: string;
  public_token: string;
  created_by_detail: UserBrief | null;
  fields: FormField[];
  submission_count: number;
  create_lead: boolean;
  lead_department: string;
  create_task: boolean;
  task_title: string;
  created_at: string;
  updated_at: string;
}

/** What a visitor of the share link sees: no token, no integration settings. */
export interface PublicWebForm {
  name: string;
  description: string;
  fields: FormField[];
}

export interface FormSubmission {
  id: number;
  person: string;
  /** field id → text, or the chosen options (checkbox), or the file name. */
  answers: Record<string, string | string[]>;
  files: Array<{ field_id: number; filename: string; url: string }>;
  lead: number | null;
  lead_name: string | null;
  task: number | null;
  task_title: string | null;
  created_at: string;
}

export interface FormFieldInput {
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  lead_attr: string;
}

export type WebFormPatch = Partial<Pick<WebForm, 'name' | 'description' | 'create_lead' | 'lead_department' | 'create_task' | 'task_title'>>;

/** The answers a person typed: field id → text, chosen options, and the picked files. */
export interface FormAnswers {
  values: Record<string, string | string[]>;
  files: Record<string, File | null>;
}

/** Field errors from the API for a submission: field id → message. */
export class FormSubmitError extends Error {
  constructor(public fieldErrors: Record<string, string>) {
    super('Please check the highlighted answers.');
  }
}

function answersToFormData({ values, files }: FormAnswers): FormData {
  const fd = new FormData();
  for (const [id, v] of Object.entries(values)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(id, x));
    else fd.append(id, v);
  }
  for (const [id, f] of Object.entries(files)) if (f) fd.append(`file_${id}`, f);
  return fd;
}

/** GET /forms/ — the published forms anyone signed in may fill. */
export function usePublishedForms() {
  return useQuery({ queryKey: ['forms', 'published'], queryFn: () => tasksApi.get<WebForm[]>('/forms/') });
}

/** GET /forms/?manage=true — my forms (every form for tasks.view_all). Needs tasks.assign. */
export function useManagedForms(enabled = true) {
  return useQuery({ queryKey: ['forms', 'manage'], queryFn: () => tasksApi.get<WebForm[]>('/forms/', { manage: 'true' }), enabled });
}

export function useWebForm(id: number | null) {
  return useQuery({ queryKey: ['forms', 'detail', id], queryFn: () => tasksApi.get<WebForm>(`/forms/${id}/`), enabled: id != null });
}

export function useFormSubmissions(id: number | null) {
  return useQuery({ queryKey: ['forms', 'submissions', id], queryFn: () => tasksApi.get<FormSubmission[]>(`/forms/${id}/submissions/`), enabled: id != null });
}

function useInvalidateForms() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['forms'] });
}

/** POST /forms/ {name} — a new draft. */
export function useCreateForm() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: (name: string) => tasksApi.post<WebForm>('/forms/', { name }), onSuccess: done });
}

/** PATCH /forms/:id/ — name, description and the lead / task integrations. */
export function usePatchForm() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: ({ id, ...body }: WebFormPatch & { id: number }) => tasksApi.patch<WebForm>(`/forms/${id}/`, body), onSuccess: done });
}

/** publish / close / reopen (POST /forms/:id/<action>/) or delete (only without submissions). */
export function useFormAction() {
  const done = useInvalidateForms();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'publish' | 'close' | 'reopen' | 'delete' }) =>
      action === 'delete' ? tasksApi.del(`/forms/${id}/`) : tasksApi.post<WebForm>(`/forms/${id}/${action}/`),
    onSuccess: done,
  });
}

/** POST /forms/:id/add_field/ */
export function useAddFormField() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: ({ formId, ...body }: FormFieldInput & { formId: number }) => tasksApi.post<FormField>(`/forms/${formId}/add_field/`, body), onSuccess: done });
}

/** PATCH /form-fields/:id/ */
export function usePatchFormField() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: ({ id, ...body }: Partial<FormFieldInput> & { id: number }) => tasksApi.patch<FormField>(`/form-fields/${id}/`, body), onSuccess: done });
}

/** DELETE /form-fields/:id/ */
export function useRemoveFormField() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/form-fields/${id}/`), onSuccess: done });
}

/** POST /forms/:id/reorder_fields/ {order: [field ids]} */
export function useReorderFormFields() {
  const done = useInvalidateForms();
  return useMutation({ mutationFn: ({ formId, order }: { formId: number; order: number[] }) => tasksApi.post<WebForm>(`/forms/${formId}/reorder_fields/`, { order }), onSuccess: done });
}

/** POST /forms/:id/submit/ — a signed-in person fills a published form (multipart: answers + file_<id>). */
export function useSubmitForm() {
  const done = useInvalidateForms();
  return useMutation({
    mutationFn: ({ formId, answers }: { formId: number; answers: FormAnswers }) => tasksApi.upload<FormSubmission>(`/forms/${formId}/submit/`, answersToFormData(answers)).catch(rethrowFieldErrors),
    onSuccess: done,
  });
}

/** GET /forms/:id/export/ — the submissions as a CSV file (needs the token, so not a plain link). */
export function useExportFormCsv() {
  return useMutation({ mutationFn: (id: number) => tasksApi.blob(`/forms/${id}/export/`) });
}

// ─── the share link (no sign-in) ──────────────────────────────────────────

/**
 * The share link: /f/<token>?c=<company id>. The visitor has no token, so the link names the company (multi-company
 * installs; a single-company install ignores it).
 */
export function publicFormUrl(origin: string, token: string, companyId: string | null | undefined): string {
  return `${origin}/f/${token}${companyId ? `?c=${encodeURIComponent(companyId)}` : ''}`;
}

const withCompany = (path: string, company: string | null | undefined) => (company ? `${path}?company=${encodeURIComponent(company)}` : path);

/** GET /public/forms/<token>/ — the form behind a share link; 404 when it is not published. */
export function usePublicForm(token: string | undefined, company?: string | null) {
  return useQuery({
    queryKey: ['forms', 'public', token, company],
    queryFn: () => tasksApi.get<PublicWebForm>(withCompany(`/public/forms/${token}/`, company)),
    enabled: !!token,
    retry: false,
  });
}

/** POST /public/forms/<token>/submit/ — the visitor's answers. Field errors come back as FormSubmitError. */
export function useSubmitPublicForm() {
  return useMutation({
    mutationFn: ({ token, company, answers }: { token: string; company?: string | null; answers: FormAnswers }) =>
      tasksApi.upload<{ detail: string; id: number }>(withCompany(`/public/forms/${token}/submit/`, company), answersToFormData(answers)).catch(rethrowFieldErrors),
  });
}

/** A 400 with {field id: message} becomes a FormSubmitError, so the screen can mark each answer. */
function rethrowFieldErrors(err: unknown): never {
  const e = err as { status?: number; errors?: Record<string, string> };
  if (e?.status === 400 && e.errors && Object.keys(e.errors).some((k) => /^\d+$/.test(k))) throw new FormSubmitError(e.errors);
  throw err;
}
