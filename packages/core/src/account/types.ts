/** Accounts, sign-up, companies and invites (PLAN.md §21.2). */
import type { AppKey, SignInTokens } from '../session';

export type OtpChannel = 'email' | 'sms';

/** POST signup/start, auth/forgot. `devCode` only while the OTP sender is fake (OTP_DEV_ECHO=1). */
export interface OtpSent {
  otpId: string;
  channel?: OtpChannel;
  devCode?: string;
}

/** POST signup/verify: the token proves the email / mobile for 30 minutes. */
export interface SignupVerified {
  signupToken: string;
  /** This email / mobile already has an account: it signs in with its password instead of choosing one. */
  accountExists: boolean;
}

export type TeamSize = '1-10' | '11-50' | '51-200' | '200+';

/** A new company (sign-up step, or "New company" from the account menu). */
export interface CompanyInput {
  name: string;
  teamSize: TeamSize;
  industry: string;
  /** Indian state (GST place of supply). */
  state: string;
  /** "tasks" = Attendance + Tasks; "assets" = Assets. */
  apps: AppKey[];
}

export interface SignupCompleteInput {
  signupToken: string;
  fullName: string;
  password: string;
  /** Required for a new account (PLAN.md §21.5); ignored for an existing one. */
  username?: string;
  company: CompanyInput;
}

export interface SignupComplete extends SignInTokens {
  companyId: string;
  /** The company exists and the person is signed in, but an app could not be set up yet (retried by the server). */
  setupIncomplete?: boolean;
}

/** GET auth/companies: every company this account belongs to. */
export interface AccountCompany {
  companyId: string;
  name: string;
  code: string;
  role: string;
  current: boolean;
}

/** A role on an invite: the server may send names or {id, name}. */
export type InviteRole = string | { id?: string; name: string };

/** GET invites/:token (public). */
export interface InvitePreview {
  companyName: string;
  roles: InviteRole[];
  apps: AppKey[];
  expiresAt: string | null;
  valid: boolean;
  /** Why the link no longer works, with the server's message for the person. */
  reason?: 'expired' | 'revoked' | 'used_up';
  message?: string;
}

/** GET invites (people managers). */
export interface Invite {
  id: string;
  token?: string;
  url?: string;
  roles?: InviteRole[];
  roleIds?: string[];
  apps: AppKey[];
  expiresAt: string | null;
  maxUses: number | null;
  uses?: number;
  createdAt?: string;
  revokedAt?: string | null;
  revoked?: boolean;
  /** 'active' | 'revoked' | 'expired' | 'used_up' */
  status?: string;
  active?: boolean;
  createdBy?: string | null;
}

export interface InviteInput {
  roleIds: string[];
  apps: AppKey[];
  expiresInDays: number;
  maxUses: number | null;
}

export interface CreatedInvite {
  id: string;
  token: string;
  url: string;
}

/** POST invites/:token/accept for a new account (an account already signed in sends nothing). */
export interface AcceptAsNew {
  signupToken: string;
  fullName: string;
  password: string;
  /** A new account's username (PLAN.md §21.5). */
  username?: string;
}

export const TEAM_SIZES: Array<{ value: TeamSize; label: string }> = [
  { value: '1-10', label: '1–10 people' },
  { value: '11-50', label: '11–50 people' },
  { value: '51-200', label: '51–200 people' },
  { value: '200+', label: 'More than 200' },
];

export const INDUSTRIES = [
  'Automobile dealership',
  'Retail',
  'Manufacturing',
  'IT and software',
  'Services and consulting',
  'Healthcare',
  'Education',
  'Construction and real estate',
  'Logistics and transport',
  'Hospitality and food',
  'Finance and insurance',
  'Non-profit',
  'Other',
] as const;

/** The name of a role on an invite, whatever shape the server sent. */
export const inviteRoleName = (r: InviteRole) => (typeof r === 'string' ? r : r.name);

/** "email" or "mobile", from what was typed (Indian mobiles: 10 digits, optional +91 / 91 / 0). */
export function identifierKind(value: string): 'email' | 'mobile' | null {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  const digits = v.replace(/[\s()-]/g, '');
  // Indian mobiles only (the server accepts no other numbers yet).
  if (/^(\+?91|0)?[6-9]\d{9}$/.test(digits)) return 'mobile';
  return null;
}
