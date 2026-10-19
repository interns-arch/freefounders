/** Sign-up, forgot password, companies of an account, invites (Platform /api/platform, PLAN.md §21.2). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export const accountKeys = {
  companies: (sub?: string) => ['account', 'companies', sub ?? null] as const,
  invites: ['account', 'invites'] as const,
  invite: (token: string) => ['account', 'invite', token] as const,
};

export const accountApi = {
  signupStart: (identifier: string) => platformApi.post<OtpSent>('/signup/start', { identifier }),
  signupVerify: (otpId: string, code: string) => platformApi.post<SignupVerified>('/signup/verify', { otpId, code }),
  signupComplete: (body: SignupCompleteInput) => platformApi.post<SignupComplete>('/signup/complete', { ...body, ...session.clientHint() }),
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
