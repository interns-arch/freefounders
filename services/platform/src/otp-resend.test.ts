// Resend email codes (PLAN.md §21.8, founder 2026-10-27). Run with `npm test`. No network: fetch is a stand-in and
// the key is a dummy, never a real one.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { EnvOtpSender } from './accounts/otp-senders';
import { OtpSendError } from './accounts/otp.service';
import { ResendOtpSender, resendConfig } from './accounts/resend.sender';

const KEY = 're_dummy_key_for_tests_only';
const email = { kind: 'email' as const, value: 'asha@example.com', channel: 'email' as const };
const sms = { kind: 'mobile' as const, value: '+919876543210', channel: 'sms' as const };
const saved = { ...process.env };

function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const config = { apiKey: KEY, from: 'Kaampilot <otp@kaampilot.com>', baseUrl: 'https://resend.test', timeoutMs: 300 };

afterEach(() => {
  process.env = { ...saved };
});

describe('Resend sender', () => {
  test('sends OUR code by email with the Bearer key and the From address', async () => {
    const { calls, fetchImpl } = stub(200, { id: 'e-1' });
    await new ResendOtpSender(config, fetchImpl).send(email, '839201', 'login');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://resend.test/emails');
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.to, ['asha@example.com']);
    assert.equal(body.from, 'Kaampilot <otp@kaampilot.com>');
    assert.match(body.subject, /sign-in code/);
    assert.match(body.html, /839201/);
    assert.match(body.text, /839201/);
  });

  test('errors: 401/403 → config, 429/5xx → unavailable, 422 → rejected; SMS is refused', async () => {
    for (const [status, kind] of [[403, 'config'], [429, 'unavailable'], [500, 'unavailable'], [422, 'rejected']] as const) {
      const { fetchImpl } = stub(status, { statusCode: status, name: 'x', message: 'nope' });
      await assert.rejects(new ResendOtpSender(config, fetchImpl).send(email, '123456', 'reset'), (e: OtpSendError) => e.kind === kind);
    }
    const sender = new ResendOtpSender(config, stub(200, { id: 'x' }).fetchImpl);
    assert.equal(sender.canSend('sms'), false);
    await assert.rejects(sender.send(sms, '123456', 'login'), OtpSendError);
  });

  test('config: no key is a problem; the From defaults to Kaampilot <otp@kaampilot.com>', () => {
    assert.match(resendConfig({}).problem ?? '', /RESEND_API_KEY/);
    assert.equal(resendConfig({ RESEND_API_KEY: KEY }).config?.from, 'Kaampilot <otp@kaampilot.com>');
  });

  test('OTP_SENDER=resend: email goes to Resend; SMS stays on the fake sender outside production, off in production', async () => {
    Object.assign(process.env, { OTP_SENDER: 'resend', RESEND_API_KEY: KEY, RESEND_BASE_URL: 'https://resend.test', NODE_ENV: 'test' });
    const { calls, fetchImpl } = stub(200, { id: 'e-2' });
    const sender = new EnvOtpSender(fetchImpl);
    assert.match(sender.describe(), /Resend email/);
    assert.equal(sender.canSend('email'), true);
    assert.equal(sender.canSend('sms'), true);
    await sender.send(email, '111222', 'signup');
    await sender.send(sms, '333444', 'login');
    assert.equal(calls.length, 1, 'only the email went to Resend');

    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    assert.equal(sender.canSend('sms'), false);
    assert.match(sender.unavailableMessage('sms'), /SMS aren't set up/);

    delete process.env.RESEND_API_KEY;
    assert.equal(sender.canSend('email'), false);
    assert.match(sender.describe(), /OFF/);
  });
});
