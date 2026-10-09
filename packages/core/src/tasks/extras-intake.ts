/** AI inbox (old pages/Intake.jsx): /intake/ — inbound WhatsApp / Gmail messages and the simulator. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';

export type IntakeChannel = 'whatsapp' | 'gmail';
export type IntakeStatus = 'pending' | 'processed' | 'ignored' | 'failed';
export const INTAKE_CHANNELS: Array<[IntakeChannel, string]> = [
  ['whatsapp', 'WhatsApp'],
  ['gmail', 'Gmail'],
];
export const INTAKE_STATUSES: Array<[IntakeStatus, string]> = [
  ['pending', 'Pending'],
  ['processed', 'Processed'],
  ['ignored', 'Ignored'],
  ['failed', 'Failed'],
];

/** What the AI made of a message (intake.ai). Keys are free-form; these are the ones the screen shows. */
export interface IntakeAiResult {
  intent?: string;
  vehicle?: string;
  items?: Array<{ name: string; quantity?: number | string | null }>;
  priority?: string;
  department?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface InboundMessage {
  id: number;
  channel: IntakeChannel;
  sender: string;
  sender_name: string;
  subject: string;
  body: string;
  media: Array<{ id?: string; mime_type?: string; caption?: string }>;
  ai_result: IntakeAiResult | null;
  lead: number | null;
  lead_name: string | null;
  status: IntakeStatus;
  error: string;
  created_at: string;
  processed_at: string | null;
}

export interface IntakeSimulateInput {
  channel: IntakeChannel;
  sender: string;
  sender_name: string;
  subject: string;
  body: string;
}

/** GET /intake/?channel=&status= (latest 50) — needs intake.view. */
export function useIntakeMessages(filters: { channel?: IntakeChannel | ''; status?: IntakeStatus | '' } = {}) {
  const q = { channel: filters.channel || undefined, status: filters.status || undefined };
  return useQuery({
    queryKey: ['intake', 'list', q],
    queryFn: () => tasksApi.get<DrfPage<InboundMessage> | InboundMessage[]>('/intake/', { page_size: 50, ...q }).then(resultsOf),
  });
}

/** POST /intake/simulate/ — runs the real pipeline on typed text (settings.manage; needs INTAKE_ENABLED on the server). */
export function useSimulateIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IntakeSimulateInput) => tasksApi.post<InboundMessage>('/intake/simulate/', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] });
      qc.invalidateQueries({ queryKey: ['leads'] }); // a message may have become a lead
    },
  });
}
