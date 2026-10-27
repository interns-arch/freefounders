// @kaampilot/core/ai: the "Ask Kaampilot" helper (PLAN.md §24.3). Works signed out (website) and signed in; the
// Platform adds only the person's level and company name as context. Off (status disabled, ask = 503) until a key is set.
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, platformApi } from '../http';

export interface AiTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskAiInput {
  question: string;
  /** Earlier turns of this chat (the last 6 are sent). */
  history?: AiTurn[];
  /** The page the person is on (path only), as a hint. */
  page?: string;
}

export interface AiStatus {
  enabled: boolean;
}

/** Longest question the Platform accepts. */
export const AI_MAX_QUESTION = 1000;
/** Turns of history sent with a question. */
export const AI_HISTORY_TURNS = 6;

export const aiApi = {
  status: () => platformApi.get<AiStatus>('/ai/status'),
  ask: (body: AskAiInput) => platformApi.post<{ answer: string }>('/ai/ask', body),
};

/** Whether the helper is switched on (hide the button when not). */
export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: ['platform', 'ai', 'status'],
    queryFn: aiApi.status,
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** One question → `{ answer }`. Sends at most the last 6 turns. */
export function useAskAi() {
  return useMutation({
    mutationFn: ({ question, history, page }: AskAiInput) =>
      aiApi.ask({ question: question.trim().slice(0, AI_MAX_QUESTION), history: history?.slice(-AI_HISTORY_TURNS), page }),
  });
}

/** True when the error means "the helper is not set up" (503 from /ai/ask). */
export function isAiOff(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503 && /set up/i.test(err.message);
}
