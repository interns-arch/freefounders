import { Logger } from '@nestjs/common';
import type { Identifier } from './identifier';
import { Msg91OtpSender, msg91Config } from './msg91.sender';
import { CODES_OFF_MESSAGE, demoMode, FakeOtpSender, type OtpPurpose, type OtpSender } from './otp.service';

const EMAIL_OFF_MESSAGE = "Codes by email aren't set up yet. Use your mobile number instead.";

/** `OTP_SENDER`: fake (default: codes go to the Platform log) or msg91. Anything else is treated as not set up. */
export function otpSenderName(env: NodeJS.ProcessEnv = process.env): 'fake' | 'msg91' | 'unknown' {
  const raw = (env.OTP_SENDER ?? '').trim().toLowerCase();
  if (!raw || raw === 'fake') return 'fake';
  return raw === 'msg91' ? 'msg91' : 'unknown';
}

/**
 * The sender the Platform uses (PLAN.md §21.8). The environment is read on every send, so tests can switch it; the
 * startup line says what is on (like payments: a missing key never stops the server, sending answers 503 instead).
 *
 * - `OTP_SENDER=fake`: the code is written to the log (dev, tests, and the open demo, which also shows it on screen).
 * - `OTP_SENDER=msg91`: SMS through MSG91 SendOTP; email through MSG91 when its email template and from address are
 *   set. Without them, email codes keep using the fake sender on a dev machine or the open demo (DEMO_MODE=1), and in
 *   production answer 503 "Codes by email aren't set up yet".
 */
export class EnvOtpSender implements OtpSender {
  private readonly fake = new FakeOtpSender();
  private cached: { key: string; sender: Msg91OtpSender | null } | null = null;

  constructor(private readonly fetchImpl?: typeof fetch) {}

  /** One line at startup: what sends codes, or why nothing can. */
  describe(): string {
    const name = otpSenderName();
    if (name === 'fake') return 'One-time codes: fake sender (written to this log; nothing is sent)';
    if (name === 'unknown') return `One-time codes are OFF (sending answers 503): OTP_SENDER="${process.env.OTP_SENDER}" is not known (use fake or msg91)`;
    const { problem, emailProblem } = msg91Config();
    if (problem) return `One-time codes are OFF (sending answers 503): ${problem}. Everything else keeps working.`;
    const email = emailProblem ? (this.emailFallback() ? 'email: fake sender (MSG91 email not set up)' : 'email: OFF (MSG91 email not set up)') : 'email: MSG91';
    return `One-time codes: MSG91 (SMS: SendOTP template; ${email})`;
  }

  private emailFallback(): boolean {
    return demoMode() || process.env.NODE_ENV !== 'production';
  }

  private msg91(): Msg91OtpSender | null {
    const { config, problem } = msg91Config();
    const key = JSON.stringify(config);
    if (this.cached?.key !== key) this.cached = { key, sender: config ? new Msg91OtpSender(config, this.fetchImpl) : null };
    return problem ? null : this.cached.sender;
  }

  canSend(channel: 'email' | 'sms'): boolean {
    const name = otpSenderName();
    if (name === 'fake') return true;
    if (name === 'unknown') return false;
    const sender = this.msg91();
    if (!sender) return false;
    return sender.canSend(channel) || (channel === 'email' && this.emailFallback());
  }

  unavailableMessage(channel: 'email' | 'sms'): string {
    if (channel === 'email' && otpSenderName() === 'msg91' && this.msg91()) return EMAIL_OFF_MESSAGE;
    return CODES_OFF_MESSAGE;
  }

  async send(target: Identifier, code: string, purpose: OtpPurpose): Promise<void> {
    if (otpSenderName() === 'fake') return this.fake.send(target, code, purpose);
    const sender = this.msg91();
    if (sender && sender.canSend(target.channel)) return sender.send(target, code, purpose);
    // Only reached for email on a dev machine / the open demo (canSend said yes).
    return this.fake.send(target, code, purpose);
  }
}

/** The provider for OTP_SENDER (app.module.ts), with its startup line. */
export function otpSenderFromEnv(): EnvOtpSender {
  const sender = new EnvOtpSender();
  if (process.env.NODE_ENV !== 'test') {
    const line = sender.describe();
    const log = new Logger('OTP');
    if (/OFF/.test(line)) log.error(line);
    else log.log(line);
  }
  return sender;
}
