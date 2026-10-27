import { Logger } from '@nestjs/common';
import type { Identifier } from './identifier';
import { maskTarget } from './msg91.sender';
import { OTP_TTL_MS, type OtpPurpose, OtpSendError, type OtpSender } from './otp.service';

/**
 * Resend (https://resend.com/docs/api-reference/emails/send-email) sends our one-time codes by email (PLAN.md §21.8,
 * founder 2026-10-27: "use this for otp purpose"). Email only: SMS still needs a provider. OUR server makes and checks
 * the code (otp.service.ts); Resend only delivers it.
 *
 * `POST https://api.resend.com/emails`, header `Authorization: Bearer <RESEND_API_KEY>`, JSON
 * `{from, to: [email], subject, html, text}`. Success 200 `{"id": "…"}`. Errors `{statusCode, name, message}`:
 * 401/403 bad key or the From domain is not verified, 422 bad field, 429 too many requests, 5xx Resend down.
 * The From domain (kaampilot.com) must be verified in Resend → Domains. The key and the code are never logged.
 */
export const RESEND_DEFAULT_BASE = 'https://api.resend.com';
export const RESEND_DEFAULT_FROM = 'Kaampilot <otp@kaampilot.com>';
const TIMEOUT_MS = 10_000;

export interface ResendConfig {
  apiKey: string;
  from: string;
  baseUrl: string;
  timeoutMs: number;
}

/** Resend settings from the environment; `problem` says why codes cannot go out. */
export function resendConfig(env: NodeJS.ProcessEnv = process.env): { config: ResendConfig | null; problem: string | null } {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (!apiKey) return { config: null, problem: 'OTP_SENDER=resend but RESEND_API_KEY is not set' };
  return {
    config: {
      apiKey,
      from: env.RESEND_FROM?.trim() || RESEND_DEFAULT_FROM,
      baseUrl: (env.RESEND_BASE_URL?.trim() || RESEND_DEFAULT_BASE).replace(/\/+$/, ''),
      timeoutMs: Number(env.RESEND_TIMEOUT_MS) > 0 ? Number(env.RESEND_TIMEOUT_MS) : TIMEOUT_MS,
    },
    problem: null,
  };
}

const SUBJECT: Record<OtpPurpose, string> = {
  login: 'Your Kaampilot sign-in code',
  signup: 'Your Kaampilot sign-up code',
  reset: 'Your Kaampilot password reset code',
};
const PURPOSE_TEXT: Record<OtpPurpose, string> = { signup: 'finish signing up', reset: 'reset your password', login: 'sign in' };

/** The email: plain text and simple HTML (inline styles only; mail apps drop <style>). */
export function otpEmail(code: string, purpose: OtpPurpose): { subject: string; html: string; text: string } {
  const minutes = OTP_TTL_MS / 60_000;
  const text = `Your Kaampilot code to ${PURPOSE_TEXT[purpose]} is ${code}. It is valid for ${minutes} minutes. Do not share it with anyone. If you did not ask for it, ignore this email.`;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">' +
    '<p style="font-size:18px;font-weight:bold;margin:0 0 16px">Kaampilot</p>' +
    `<p style="margin:0 0 8px">Your code to ${PURPOSE_TEXT[purpose]}:</p>` +
    `<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:0 0 16px;color:#4338ca">${code}</p>` +
    `<p style="margin:0 0 8px">It is valid for ${minutes} minutes. Do not share it with anyone.</p>` +
    '<p style="margin:0;color:#475569;font-size:13px">If you did not ask for this code, ignore this email.</p></div>';
  return { subject: SUBJECT[purpose], html, text };
}

export class ResendOtpSender implements OtpSender {
  private readonly log = new Logger('OTP');

  constructor(
    private readonly config: ResendConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  canSend(channel: 'email' | 'sms'): boolean {
    return channel === 'email';
  }

  async send(target: Identifier, code: string, purpose: OtpPurpose): Promise<void> {
    if (target.channel !== 'email') throw new OtpSendError('config', 'Resend sends email only');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/emails`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ from: this.config.from, to: [target.value], ...otpEmail(code, purpose) }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      this.log.warn(`Resend email to ${maskTarget(target)} (${purpose}): ${timedOut ? `no answer in ${this.config.timeoutMs / 1000} s` : 'could not connect'}`);
      throw new OtpSendError('unavailable', timedOut ? 'timeout' : 'network');
    }
    const body: any = await res.json().catch(() => null);
    if (res.ok && body?.id) {
      this.log.log(`Resend email accepted: ${String(body.id)} to ${maskTarget(target)} (${purpose})`);
      return;
    }
    const message = short(body?.message);
    if (res.status === 401 || res.status === 403) {
      this.log.error(`Resend: ${res.status} ${message} (check RESEND_API_KEY and that the From domain is verified in Resend)`);
      throw new OtpSendError('config', `Resend ${res.status}`);
    }
    if (res.status >= 500 || res.status === 429) {
      this.log.warn(`Resend email to ${maskTarget(target)} (${purpose}): ${res.status} ${message}`);
      throw new OtpSendError('unavailable', `Resend ${res.status}`);
    }
    this.log.warn(`Resend email to ${maskTarget(target)} (${purpose}) refused: ${res.status} ${message}`);
    throw new OtpSendError('rejected', `Resend ${res.status}`);
  }
}

/** A provider message for the log, at most 200 characters, no long digit runs. */
function short(message: unknown): string {
  const s = typeof message === 'string' ? message : message == null ? '' : JSON.stringify(message);
  return s.replace(/\s+/g, ' ').replace(/\d{4,}/g, '#').slice(0, 200);
}
