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
  GEMINI_MAX_TOKENS,
  geminiSchema,
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
    const context = body.system.map((b: { text: string }) => b.text).join(' ');
    assert.match(context, /Acme Traders/);
    assert.match(context, /\/attendance\/today\./, 'page path without its query string');
    assert.equal(body.system.at(-1).cache_control, undefined, 'who / where comes after the cached part');
    assert.equal(body.tools, undefined, 'no data tools without the person and their token');
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

  test('Gemini: generateContent shape, key only in x-goog-api-key (never the URL), model/model roles, default model', async () => {
    Object.assign(process.env, { AI_API_KEY: KEY, AI_PROVIDER: 'Gemini', AI_BASE_URL: 'https://gemini.test/' });
    delete process.env.AI_MODEL;
    const { calls, fetchImpl } = stub(200, {
      candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: ' Attendance › Today › ' }, { text: 'Check in. ' }] }, finishReason: 'STOP' }],
    });
    const r = await service(fetchImpl).ask(
      { question: 'How do I punch in?', history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello!' }], page: '/attendance/today' },
      { role: 'member', companyName: 'Acme Traders' },
    );
    assert.equal(r.answer, 'Attendance › Today › Check in.', 'thought parts are not shown');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gemini.test/v1beta/models/gemini-3.8-flash:generateContent');
    assert.ok(!calls[0].url.includes(KEY) && !calls[0].url.includes('key='), 'the key is never in the URL');
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h['x-goog-api-key'], KEY);
    assert.equal(h.authorization, undefined);
    assert.equal(h['x-api-key'], undefined);
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(String(calls[0].init.body));
    assert.ok(!String(calls[0].init.body).includes(KEY), 'the key is not in the body either');
    assert.equal(body.model, undefined);
    assert.ok(body.systemInstruction.parts[0].text.includes(KNOWLEDGE));
    assert.match(body.systemInstruction.parts[1].text, /Acme Traders/);
    assert.equal(body.generationConfig.maxOutputTokens, GEMINI_MAX_TOKENS);
    assert.equal(body.generationConfig.temperature, undefined, 'Gemini 3+ keeps its default temperature');
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.contents, [
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello!' }] },
      { role: 'user', parts: [{ text: 'How do I punch in?' }] },
    ]);
    assert.match(describeAi(), /ON \(gemini, gemini-3\.8-flash\)/);

    process.env.AI_MODEL = 'gemini-2.5-flash';
    const s2 = stub(200, { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'MAX_TOKENS' }] });
    assert.equal((await service(s2.fetchImpl).ask({ question: 'x' })).answer, 'ok', 'MAX_TOKENS keeps the text written');
    assert.equal(s2.calls[0].url, 'https://gemini.test/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(JSON.parse(String(s2.calls[0].init.body)).generationConfig.temperature, 0.2, 'low temperature for 2.x');
  });

  test('Gemini problems: same friendly errors; blocked answers and bad keys never shown', async () => {
    Object.assign(process.env, { AI_API_KEY: KEY, AI_PROVIDER: 'gemini', AI_BASE_URL: 'https://gemini.test' });
    const badKey = { error: { code: 400, message: 'API key not valid. secret upstream detail', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } };
    for (const [status, body, ours] of [
      [400, badKey, 502],
      [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }, 502],
      [403, { error: { code: 403, status: 'PERMISSION_DENIED' } }, 502],
      [404, { error: { code: 404, status: 'NOT_FOUND' } }, 502],
      [429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 503],
      [500, { error: { code: 500 } }, 502],
      [503, { error: { code: 503, status: 'UNAVAILABLE' } }, 502],
    ] as const) {
      const { fetchImpl } = stub(status, body);
      await assert.rejects(service(fetchImpl).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === ours && e.message === FAILED_MESSAGE);
    }
    for (const blocked of [
      { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }] },
      { promptFeedback: { blockReason: 'SAFETY' } },
      { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] },
      { candidates: [] },
    ]) {
      const { fetchImpl } = stub(200, blocked);
      await assert.rejects(service(fetchImpl).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === 502 && e.message === FAILED_MESSAGE);
    }
    const timeout = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await assert.rejects(service(timeout).ask({ question: 'x' }), (e: HttpException) => e.getStatus() === 504);
  });

  test('Gemini schema conversion: OpenAPI subset, capital types, unsupported keywords dropped', () => {
    const converted = geminiSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM' },
        status: { type: 'string', enum: ['present', 'late'] },
        ids: { type: 'array', items: { type: 'integer', additionalProperties: false } },
      },
      required: ['month'],
      additionalProperties: false,
    });
    assert.deepEqual(converted, {
      type: 'OBJECT',
      properties: {
        month: { type: 'STRING', description: 'YYYY-MM' },
        status: { type: 'STRING', enum: ['present', 'late'] },
        ids: { type: 'ARRAY', items: { type: 'INTEGER' } },
      },
      required: ['month'],
    });
    assert.doesNotMatch(JSON.stringify(converted), /additionalProperties|\$schema|pattern/);
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
