/** Sign-up, forgot password, companies of an account, invites (Platform /api/platform, PLAN.md §21.2). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useClaims } from '../access';
import { platformApi } from '../http';
import { session, type SignInTokens } from '../session';
import type {
  AcceptAsNew,
  AccountCompany,
  CompanyInput,
  CreatedInvite,
  Invite,
  InviteInput,
  InvitePreview,
  OtpSent,
  SignupComplete,
  SignupCompleteInput,
  SignupVerified,
} from './types';
import { normaliseUsername, type UsernameAvailability, usernameFromName, USERNAME_MESSAGES, usernameShapeProblem, usernameVariants } from './username';

export const accountKeys = {
  companies: (sub?: string) => ['account', 'companies', sub ?? null] as const,
  invites: ['account', 'invites'] as const,
  invite: (token: string) => ['account', 'invite', token] as const,
  username: (name: string) => ['account', 'username', name] as const,
};

export const accountApi = {
  signupStart: (identifier: string) => platformApi.post<OtpSent>('/signup/start', { identifier }),
  signupVerify: (otpId: string, code: string) => platformApi.post<SignupVerified>('/signup/verify', { otpId, code }),
  signupComplete: (body: SignupCompleteInput) => platformApi.post<SignupComplete>('/signup/complete', { ...body, ...session.clientHint() }),
  usernameAvailable: (u: string) => platformApi.get<UsernameAvailability>('/auth/username-available', { u }),
  setUsername: (username: string) => platformApi.put<{ ok: boolean; username: string }>('/auth/username', { username }),
  forgot: (identifier: string) => platformApi.post<OtpSent>('/auth/forgot', { identifier }),
  resetVerify: (otpId: string, code: string) => platformApi.post<{ ok: boolean }>('/auth/reset/verify', { otpId, code }),
  reset: (body: { otpId: string; code: string; newPassword: string }) => platformApi.post<{ ok?: boolean }>('/auth/reset', body),

  companies: () => platformApi.get<AccountCompany[]>('/auth/companies'),
  switchCompany: (companyId: string) => platformApi.post<SignInTokens>('/auth/switch', { companyId, ...session.clientHint() }),
  createCompany: (body: CompanyInput) => platformApi.post<SignInTokens & { companyId?: string; setupIncomplete?: boolean }>('/companies', { ...body, ...session.clientHint() }),

  invitePreview: (token: string) => platformApi.get<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, asNew?: AcceptAsNew) =>
    platformApi.post<SignInTokens>(`/invites/${encodeURIComponent(token)}/accept`, { ...(asNew ?? {}), ...session.clientHint() }),
  invites: () => platformApi.get<Invite[]>('/invites'),
  createInvite: (body: InviteInput) => platformApi.post<CreatedInvite>('/invites', body),
  revokeInvite: (id: string) => platformApi.del<unknown>(`/invites/${encodeURIComponent(id)}`),
};

/**
 * After a sign-in into another company (switch, new company, invite accepted, sign-up): keep the new tokens and drop
 * everything cached, so no data of the company before can show (the cache is also keyed by person).
 */
function useEnterCompany() {
  const qc = useQueryClient();
  return async (tokens: Partial<SignInTokens>) => {
    await qc.cancelQueries();
    await session.adopt(tokens);
    qc.clear();
  };
}

// ─── sign-up and passwords (public) ─────────────────────────────────────────

export function useSignupStart() {
  return useMutation({ mutationFn: (identifier: string) => accountApi.signupStart(identifier) });
}
export function useSignupVerify() {
  return useMutation({ mutationFn: ({ otpId, code }: { otpId: string; code: string }) => accountApi.signupVerify(otpId, code) });
}
/** Creates the account (or uses the existing one) and the company, then signs in to it. Can take several seconds. */
export function useSignupComplete() {
  const enter = useEnterCompany();
  return useMutation({
    mutationFn: async (body: SignupCompleteInput) => {
      const res = await accountApi.signupComplete(body);
      await enter(res);
      return res;
    },
  });
}
export function useForgotPassword() {
  return useMutation({ mutationFn: (identifier: string) => accountApi.forgot(identifier) });
}
/** Checks a reset code on its own step (a wrong one counts as a try); the code stays usable for the reset. */
export function useResetVerify() {
  return useMutation({ mutationFn: ({ otpId, code }: { otpId: string; code: string }) => accountApi.resetVerify(otpId, code) });
}
export function useResetPassword() {
  return useMutation({ mutationFn: accountApi.reset });
}
/** Second step of signing in with an account in several companies. */
export function useSignInWithTicket() {
  return useMutation({ mutationFn: ({ ticket, companyId }: { ticket: string; companyId: string }) => session.loginWithTicket(ticket, companyId) });
}

// ─── usernames (PLAN.md §21.5) ──────────────────────────────────────────────

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export type UsernameCheckState = 'empty' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved' | 'error';

/**
 * Live check of a username while it is typed: the shape at once, then the server after 400 ms of no typing.
 * `ok` only when the server said it is free (forms keep Continue disabled until then). A signed-in account's own name
 * counts as free.
 */
export function useUsernameCheck(value: string, enabled = true) {
  const name = normaliseUsername(value);
  const settled = useDebounced(name, 400);
  const shapeOk = !!name && !usernameShapeProblem(name);
  const q = useQuery({
    queryKey: accountKeys.username(settled),
    queryFn: () => accountApi.usernameAvailable(settled),
    enabled: enabled && shapeOk && settled === name,
    staleTime: 15_000,
    retry: false,
  });
  let state: UsernameCheckState;
  let message: string | null = null;
  if (!name) state = 'empty';
  else if (!shapeOk) (state = 'invalid'), (message = USERNAME_MESSAGES.invalid);
  else if (settled !== name || q.isFetching || (!q.data && !q.isError)) state = 'checking';
  else if (q.isError) (state = 'error'), (message = 'Could not check this username. Try again.');
  else if (q.data!.available) (state = 'available'), (message = 'Available');
  else (state = q.data!.reason ?? 'taken'), (message = q.data!.message);
  return { state, message, ok: state === 'available', username: name };
}

/**
 * A free username from a person's name ("Asha Rao" → "asha.rao", or asha.rao2 … when taken), asking the server for
 * each candidate (a handful at most). null when nothing fitting was found.
 */
export async function suggestUsername(fullName: string): Promise<string | null> {
  const base = usernameFromName(fullName);
  if (!base) return null;
  for (const candidate of [base, ...usernameVariants(base)]) {
    try {
      const res = await accountApi.usernameAvailable(candidate);
      if (res.available) return res.username ?? candidate;
      if (res.reason === 'invalid') return null;
    } catch {
      return null;
    }
  }
  return null;
}

/** PUT auth/username: the signed-in account adds or changes its username (409 when taken). */
export function useSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => accountApi.setUsername(username),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform', 'me'] });
      await qc.invalidateQueries({ queryKey: ['account', 'username'] });
    },
  });
}

/** The server's answer about the username (409 taken at submit, 400 reserved / malformed), shown on the Username field. */
export function usernameErrorOf(err: unknown): string | null {
  const e = err as { status?: number; errors?: Record<string, string> } | null;
  return e && (e.status === 409 || e.status === 400) && e.errors?.username ? e.errors.username : null;
}

// ─── companies of the signed-in account ─────────────────────────────────────

/** GET auth/companies (only for a person with an account: pass `enabled` false otherwise). */
export function useMyCompanies(enabled = true) {
  const claims = useClaims();
  return useQuery({ queryKey: accountKeys.companies(claims?.sub), queryFn: accountApi.companies, enabled: enabled && !!claims, staleTime: 60_000 });
}
/** Signs in to another company of this account. */
export function useSwitchCompany() {
  const enter = useEnterCompany();
  return useMutation({ mutationFn: async (companyId: string) => enter(await accountApi.switchCompany(companyId)) });
}
/** Creates another company for this account and signs in to it. */
export function useCreateCompany() {
  const enter = useEnterCompany();
  return useMutation({
    mutationFn: async (body: CompanyInput) => {
      const res = await accountApi.createCompany(body);
      await enter(res);
      return res;
    },
  });
}

// ─── invites ────────────────────────────────────────────────────────────────

/** GET invites/:token (public): what the link joins. */
export function useInvitePreview(token: string | undefined) {
  return useQuery({ queryKey: accountKeys.invite(token ?? ''), queryFn: () => accountApi.invitePreview(token!), enabled: !!token, staleTime: 60_000, retry: false });
}
/** Joins the company of the link: signed in (nothing to send) or as a new account (sign-up token, name, password). */
export function useAcceptInvite() {
  const enter = useEnterCompany();
  return useMutation({ mutationFn: async ({ token, asNew }: { token: string; asNew?: AcceptAsNew }) => enter(await accountApi.acceptInvite(token, asNew)) });
}
/** GET invites: the company's invite links (people managers). */
export function useInvites(enabled = true) {
  return useQuery({ queryKey: accountKeys.invites, queryFn: accountApi.invites, enabled });
}
export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: accountApi.createInvite, onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.invites }) });
}
export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: accountApi.revokeInvite, onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.invites }) });
}
