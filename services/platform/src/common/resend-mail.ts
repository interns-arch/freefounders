import type { ResendConfig } from '../accounts/resend.sender';

/**
 * One email through Resend (https://resend.com/docs/api-reference/emails/send-email), with attachments
 * (`attachments: [{ filename, content: <base64> }]`). Same settings as the email codes (RESEND_API_KEY, RESEND_FROM,
 * RESEND_BASE_URL; accounts/resend.sender.ts → resendConfig). Used for the GST invoice email (PLAN.md §24.5).
 * Never logs: the caller decides what to log (never the key, never an attachment).
 */
export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

/** Why Resend did not take the email: `status` 0 = not reached (network / timeout). The message is safe to store. */
export class MailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function sendResendMail(config: ResendConfig, mail: Mail, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        from: config.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
    throw new MailError(0, timedOut ? `Resend did not answer in ${config.timeoutMs / 1000} s` : 'Resend could not be reached');
  }
  const body: any = await res.json().catch(() => null);
  if (res.ok && body?.id) return { id: String(body.id) };
  const message = typeof body?.message === 'string' ? body.message.replace(/\s+/g, ' ').slice(0, 200) : '';
  const hint = res.status === 401 || res.status === 403 ? ' (check RESEND_API_KEY and that the From domain is verified in Resend)' : '';
  throw new MailError(res.status, `Resend ${res.status}${message ? `: ${message}` : ''}${hint}`);
}

/** HTML-escape for the few values put into an email. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
