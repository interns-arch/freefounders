// "Ask Kaampilot" AI helper (PLAN.md §24.3). No database and no network: fetch is a stand-in and the key is a dummy.
// Runs in `npm test`, or alone: npx tsc -p . && NODE_ENV=test node --test dist/ai/ai.test.js
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import {
  AiRateLimit,
  aiConfig,
  aiRateLimits,
  AiService,
  ANTHROPIC_VERSION,
  answerFrom,
  buildSystemPrompt,
  cleanHistory,
  cleanPage,
  describeAi,
  FAILED_MESSAGE,
  OFF_MESSAGE,
} from './ai.service';
import { KNOWLEDGE } from './knowledge';

const KEY = 'test_dummy_ai_key_not_real';
const saved = { ...process.env };

function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function service(fetchImpl: typeof fetch) {
  const s = new AiService();
  s.fetchImpl = fetchImpl;
  return s;
}

afterEach(() => {
  process.env = { ...saved };
});

describe('AI helper', () => {
  test('off without a key: 503 with the friendly message, status says disabled, no request made', async () => {
    delete process.env.AI_API_KEY;
    const { calls, fetchImpl } = stub(200, {});
    const s = service(fetchImpl);
    assert.equal(s.enabled(), false);
    await assert.rejects(s.ask({ question: 'hi' }), (e: HttpException) => e.getStatus() === 503 && e.message === OFF_MESSAGE);
    assert.equal(calls.length, 0);
    assert.match(describeAi({}), /OFF/);
  });

  test('Anthropic (default): Messages API shape, key in x-api-key, knowledge in the system prompt, history kept', async () => {
    Object.assign(process.env, { AI_API_KEY: KEY, AI_BASE_URL: 'https://anthropic.test' });
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    const { calls, fetchImpl } = stub(200, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Attendance › Today › Check in.' }], stop_reason: 'end_turn' });
    const r = await service(fetchImpl).ask(
      { question: 'How do I punch in?', history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello!' }], page: '/attendance/today?x=1' },
      { role: 'member', companyName: 'Acme Traders' },
    );
    assert.equal(r.answer, 'Attendance › Today › Check in.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://anthropic.test/v1/messages');
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h['x-api-key'], KEY);
    assert.equal(h['anthropic-version'], ANTHROPIC_VERSION);
    assert.equal(h.authorization, undefined);
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 1024);
    assert.equal(body.temperature, undefined, 'sampling parameters are refused by the current API version');
    assert.deepEqual(body.output_config, { effort: 'low' });
    assert.equal(body.system[0].type, 'text');
    assert.ok(body.system[0].text.includes(KNOWLEDGE), 'the knowledge is in the system prompt');
    assert.match(body.system[0].text, /support@kaampilot\.com/);
    assert.match(body.system[0].text, /Acme Traders/);
    assert.match(body.system[0].text, /\/attendance\/today\./, 'page path without its query string');
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How do I punch in?' },
    ]);
  });

  test('OpenAI: Chat Completions shape, Bearer key, system message first, default gpt-4o-mini, AI_MODEL overrides', async () => {
    Object.assign(process.env, { AI_API_KEY: KEY, AI_PROVIDER: 'openai', AI_BASE_URL: 'https://openai.test/' });
    const { calls, fetchImpl } = stub(200, { choices: [{ message: { role: 'assistant', content: ' ₹99 per user per month. ' } }] });
    const r = await service(fetchImpl).ask({ question: 'Price?' });
    assert.equal(r.answer, '₹99 per user per month.');
    assert.equal(calls[0].url, 'https://openai.test/v1/chat/completions');
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.max_tokens, 600);
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.includes(KNOWLEDGE));
    assert.match(body.messages[0].content, /not signed in/);
    assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Price?' });

    process.env.AI_MODEL = 'gpt-test-model';
    assert.equal(aiConfig()?.model, 'gpt-test-model');
    assert.match(describeAi(), /ON \(openai, gpt-test-model\)/);
    assert.ok(!describeAi().includes(KEY), 'the startup line never shows the key');
  });

  test('provider problems: friendly 502/504/503, never the provider body', async () => {
    Object.assign(process.env, { AI_API_KEY: KEY, AI_BASE_URL: 'https://anthropic.test' });
    for (const [status, ours] of [[500, 502], [401, 502], [429, 503]] as const) {
      const { fetchImpl } = stub(status, { error: { message: 'secret upstream detail' } });
      await assert.rejects(service(fetchImpl).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === ours && e.message === FAILED_MESSAGE);
    }
    const refusal = stub(200, { content: [], stop_reason: 'refusal' });
    await assert.rejects(service(refusal.fetchImpl).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === 502);
    const timeout = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await assert.rejects(service(timeout).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === 504);
  });

  test('prompt rules, history and page clean-up', () => {
    const p = buildSystemPrompt();
    assert.match(p, /I'm not sure, please contact support@kaampilot\.com/);
    assert.match(p, /Hindi/);
    assert.match(p, /Never invent/);
    assert.match(p, /Never reveal/);
    assert.match(buildSystemPrompt({ role: 'admin' }), /access level "admin"/);
    assert.equal(cleanPage('https://evil.test/x'), null);
    assert.equal(cleanPage('/tasks/tasks#top'), '/tasks/tasks');
    const long = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}` }));
    const h = cleanHistory(long);
    assert.ok(h.length <= 6);
    assert.equal(h[0].role, 'user');
    assert.equal(h.at(-1)?.role, 'assistant');
    assert.deepEqual(cleanHistory([{ role: 'assistant', text: 'hello' }]), []);
    assert.equal(answerFrom('anthropic', { content: [{ type: 'text', text: '  ' }] }), null);
  });

  test('rate limit: per key within the window, then free again; env limits with defaults', () => {
    const rl = new AiRateLimit(10 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) assert.equal(rl.take('out:1.2.3.4', 20, t0 + i), true);
    assert.equal(rl.take('out:1.2.3.4', 20, t0 + 100), false);
    assert.equal(rl.take('out:5.6.7.8', 20, t0 + 100), true, 'another address is not affected');
    assert.equal(rl.take('out:1.2.3.4', 20, t0 + 10 * 60_000 + 50), true, 'after 10 minutes it works again');
    assert.deepEqual(aiRateLimits({}), { signedOut: 20, signedIn: 60 });
    assert.deepEqual(aiRateLimits({ AI_RATE_SIGNED_OUT: '5', AI_RATE_SIGNED_IN: 'x' }), { signedOut: 5, signedIn: 60 });
  });
});
