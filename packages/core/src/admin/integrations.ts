/** Settings → Integrations (PLAN.md §19.40): the company's WhatsApp, Gmail and AI values, kept by Tasks. Owner / Admin. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';

export interface IntegrationField {
  key: string;
  label: string;
  kind: 'bool' | 'text' | 'secret';
  /** Where the value comes from: the company's own, the server's environment, or nowhere. */
  source: 'company' | 'server' | null;
  /** Text and on/off fields only; a secret is never sent. */
  value?: string;
  /** Secrets: set or not, and "••••abcd" (or "Set on the server"). */
  set?: boolean;
  masked?: string;
  changed: { by: string; at: string; action: 'set' | 'removed' } | null;
}
export interface IntegrationGroup {
  key: 'whatsapp' | 'gmail' | 'ai';
  label: string;
  description: string;
  fields: IntegrationField[];
}

const KEY = ['admin', 'integrations'] as const;

export function useIntegrations(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => tasksApi.get<{ groups: IntegrationGroup[] }>('/integrations/'), enabled });
}

/** PUT /integrations/ {values}: a value sets it, null or "" removes the company's own value. */
export function useSaveIntegrations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string | null>) => tasksApi.put<{ groups: IntegrationGroup[] }>('/integrations/', { values }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
