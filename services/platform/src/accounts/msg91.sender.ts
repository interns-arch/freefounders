import { Logger } from '@nestjs/common';
import type { Identifier } from './identifier';
import { OTP_TTL_MS, type OtpPurpose, OtpSendError, type OtpSender } from './otp.service';

/**
 * MSG91 (https://docs.msg91.com) sends our one-time codes (PLAN.md §21.8). OUR server makes the code and checks it
 * (sha256, 10 minutes, 5 tries, resend gap and limits: otp.service.ts); MSG91 only delivers it, so we never call
 * MSG91's own Verify / Retry endpoints.
 *
 * Endpoints used (base https://control.msg91.com, header `authkey: <MSG91_AUTHKEY>`, JSON in and out):
 * - SMS: SendOTP, `POST /api/v5/otp?template_id=<MSG91_SMS_TEMPLATE_ID>&mobile=91XXXXXXXXXX&otp=<our code>&otp_length=6&otp_expiry=10`
 *   (docs.msg91.com/otp/sendotp: "pass your own value in `otp`"; the OTP template must contain `##OTP##` and be
 *   DLT-approved in India). Extra template variables go in the JSON body (case sensitive): we send `app` and `minutes`.
 *   Success `{"request_id": "…", "type": "success"}`. Errors come back as HTTP 200 with `{"type": "error", "message": …}`
 *   (e.g. "The provided flow ID or template ID is invalid."), 401 `{"message": "Auth Key missing"}` without a key.
 *   Chosen over the Flow API (`POST /api/v5/flow`, `recipients[].mobiles` + `VAR1…`) because it takes our own code as
 *   a first-class field, goes on MSG91's OTP route, and needs no sender ID in the request (the template carries it).
 * - Email: `POST /api/v5/email/send` with `{recipients:[{to:[{email}], variables:{…}}], from:{name, email}, domain,
 *   template_id}` (docs.msg91.com/email/send-email; template variables are written `{{otp}}` in the template). Success
 *   `{"status": "success", "hasError": false, "data": {"unique_id": "…"}}`.
 * The code is in the SendOTP query string (that is where MSG91 takes it): URLs are never logged, nor the authkey.
 * If IP whitelisting is switched on in MSG91, the server's public IP must be on the list (infra/deploy/README.md).
 */
export const MSG91_DEFAULT_BASE = 'https://control.msg91.com';
/** How long one MSG91 request may take (10 s; MSG91_TIMEOUT_MS only for tests). */
const TIMEOUT_MS = 10_000;
const APP_NAME = 'Kaampilot';

export interface Msg91Config {
  authkey: string;
  baseUrl: string;
  timeoutMs: number;
  smsTemplateId: string | null;
  email: { templateId: string; from: string; fromName: string; domain: string } | null;
}

/**
 * MSG91 settings from the environment. Each channel is optional (founder 2026-10-24: "use email otp for now"; SMS
 * waits for DLT): `problem` is set only when nothing can go out (no authkey, or neither the SMS template nor the email
 * template + From); `smsProblem` / `emailProblem` name what one channel is missing.
 */
export function msg91Config(env: NodeJS.ProcessEnv = process.env): {
  config: Msg91Config | null;
  problem: string | null;
  smsProblem: string | null;
  emailProblem: string | null;
} {
  const authkey = env.MSG91_AUTHKEY?.trim() ?? '';
  const smsTemplateId = env.MSG91_SMS_TEMPLATE_ID?.trim() || null;
  const emailTemplate = env.MSG91_EMAIL_TEMPLATE_ID?.trim() ?? '';
  const from = env.MSG91_EMAIL_FROM?.trim() ?? '';
  const domain = env.MSG91_EMAIL_DOMAIN?.trim() || (from.includes('@') ? from.split('@')[1] : '');
  const smsProblem = smsTemplateId ? null : 'MSG91_SMS_TEMPLATE_ID is not set';
  const emailProblem = !emailTemplate || !from ? 'MSG91_EMAIL_TEMPLATE_ID and MSG91_EMAIL_FROM are not set' : null;
  const problem = !authkey
    ? 'OTP_SENDER=msg91 but MSG91_AUTHKEY is not set'
    : smsProblem && emailProblem
      ? 'OTP_SENDER=msg91 but neither MSG91_SMS_TEMPLATE_ID nor MSG91_EMAIL_TEMPLATE_ID + MSG91_EMAIL_FROM is set'
      : null;
  if (!authkey) return { config: null, problem, smsProblem, emailProblem };
  return {
    config: {
      authkey,
      baseUrl: (env.MSG91_BASE_URL?.trim() || MSG91_DEFAULT_BASE).replace(/\/+$/, ''),
      timeoutMs: Number(env.MSG91_TIMEOUT_MS) > 0 ? Number(env.MSG91_TIMEOUT_MS) : TIMEOUT_MS,
      smsTemplateId,
      email: emailProblem ? null : { templateId: emailTemplate, from, fromName: env.MSG91_EMAIL_FROM_NAME?.trim() || APP_NAME, domain },
    },
    problem,
    smsProblem,
    emailProblem,
  };
}

const PURPOSE_TEXT: Record<OtpPurpose, string> = { signup: 'finish signing up', reset: 'reset your password', login: 'sign in' };

/** "+919876543210" → "******3210", "asha@example.com" → "as***@example.com" (log lines only). */
export function maskTarget(t: Identifier): string {
  if (t.kind === 'mobile') return `******${t.value.slice(-4)}`;
  const [user, host] = t.value.split('@');
  return `${user.slice(0, 2)}***@${host}`;
}

export class Msg91OtpSender implements OtpSender {
  private readonly log = new Logger('OTP');

  constructor(
    private readonly config: Msg91Config,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  canSend(channel: 'email' | 'sms'): boolean {
    return channel === 'sms' ? !!this.config.smsTemplateId : !!this.config.email;
  }

  async send(target: Identifier, code: string, purpose: OtpPurpose): Promise<void> {
    if (target.channel === 'sms') return this.sendSms(target, code, purpose);
    return this.sendEmail(target, code, purpose);
  }

  private async sendSms(target: Identifier, code: string, purpose: OtpPurpose) {
    if (!this.config.smsTemplateId) throw new OtpSendError('config', 'MSG91 SMS is not set up');
    const minutes = String(OTP_TTL_MS / 60_000);
    const query = new URLSearchParams({
      template_id: this.config.smsTemplateId,
      // Identifier values are +91XXXXXXXXXX; MSG91 wants the country code without the plus.
      mobile: target.value.replace(/^\+/, ''),
      otp: code,
      otp_length: String(code.length),
      otp_expiry: minutes,
    });
    const body = await this.post(`/api/v5/otp?${query}`, { app: APP_NAME, minutes }, 'sms', target, purpose);
    if (body?.type !== 'success') throw this.refused('sms', target, purpose, 200, body?.message);
    this.log.log(`MSG91 sms accepted: request ${String(body.request_id ?? '?')} to ${maskTarget(target)} (${purpose})`);
  }

  private async sendEmail(target: Identifier, code: string, purpose: OtpPurpose) {
    const email = this.config.email;
    if (!email) throw new OtpSendError('config', 'MSG91 email is not set up');
    const payload = {
      recipients: [{ to: [{ email: target.value }], variables: { otp: code, minutes: String(OTP_TTL_MS / 60_000), app: APP_NAME, purpose: PURPOSE_TEXT[purpose] } }],
      from: { name: email.fromName, email: email.from },
      domain: email.domain,
      template_id: email.templateId,
    };
    const body = await this.post('/api/v5/email/send', payload, 'email', target, purpose);
    if (body?.hasError === true || (body?.status !== undefined && body.status !== 'success')) throw this.refused('email', target, purpose, 200, body?.message);
    this.log.log(`MSG91 email accepted: request ${String(body?.data?.unique_id ?? '?')} to ${maskTarget(target)} (${purpose})`);
  }

  /** One JSON request with a timeout (10 s). Network errors and timeouts → 'unavailable'; 401/403 → 'config'. */
  private async post(path: string, payload: unknown, channel: string, target: Identifier, purpose: OtpPurpose): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.baseUrl + path, {
        method: 'POST',
        headers: { authkey: this.config.authkey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      this.log.warn(`MSG91 ${channel} to ${maskTarget(target)} (${purpose}): ${timedOut ? `no answer in ${this.config.timeoutMs / 1000} s` : 'could not connect'}`);
      throw new OtpSendError('unavailable', timedOut ? 'timeout' : 'network');
    }
    const text = await res.text().catch(() => '');
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.status === 401 || res.status === 403) {
      this.log.error(`MSG91 ${channel}: ${res.status} ${short(body?.message)} (check MSG91_AUTHKEY and the IP whitelist)`);
      throw new OtpSendError('config', `MSG91 ${res.status}`);
    }
    if (res.status >= 500 || res.status === 429) {
      this.log.warn(`MSG91 ${channel} to ${maskTarget(target)} (${purpose}): ${res.status} ${short(body?.message)}`);
      throw new OtpSendError('unavailable', `MSG91 ${res.status}`);
    }
    if (res.status >= 400) throw this.refused(channel, target, purpose, res.status, body?.message);
    return body;
  }

  private refused(channel: string, target: Identifier, purpose: OtpPurpose, status: number, message: unknown) {
    this.log.warn(`MSG91 ${channel} to ${maskTarget(target)} (${purpose}) refused: ${status} ${short(message)}`);
    return new OtpSendError('rejected', `MSG91 ${status}`);
  }
}

/** A provider message for the log (never the request), at most 200 characters. */
function short(message: unknown): string {
  const s = typeof message === 'string' ? message : message == null ? '' : JSON.stringify(message);
  // Long digit runs (a number, or a code a provider might echo back) never reach the log.
  return s.replace(/\s+/g, ' ').replace(/\d{4,}/g, '#').slice(0, 200);
}
