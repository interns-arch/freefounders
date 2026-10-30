// "Ask Kaampilot" data answers (PLAN.md §24.3 "Data answers"). No database and no network: one stand-in fetch plays
// the AI provider and the apps. Runs in `npm test`, or alone: npx tsc -p . && NODE_ENV=test node --test dist/ai/ai-tools.test.js
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { AiService, MAX_TOOL_CALLS, MAX_TOOL_ROUNDS, toolSummary } from './ai.service';
import { appBaseUrl, DATA_TOOLS, istToday, makeReader, MAX_RESULT_CHARS, runTool, slim, toIst, toolJson, toolsFor, type ToolUser } from './tools';

const KEY = 'test_dummy_ai_key_not_real';
const USER_TOKEN = 'user.access.token.for.asha';
const saved = { ...process.env };
const USER: ToolUser = { token: USER_TOKEN, name: 'Asha Rao', role: 'member', apps: { tasks: 'u1', assets: 'u2' } };

type Call = { url: string; init: RequestInit };
type Reply = { status?: number; body: unknown };

/** One fetch for everything: provider replies in order; app answers by path (a function may vary per call). */
function world(providerReplies: Reply[], apps: Record<string, Reply | ((url: URL) => Reply)> = {}) {
  const provider: Call[] = [];
  const app: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    let reply: Reply;
    if (u.host.endsWith('.ai.test')) {
      provider.push({ url, init });
      reply = providerReplies.shift() ?? { status: 500, body: {} };
    } else {
      app.push({ url, init });
      const hit = Object.entries(apps).find(([p]) => `${u.host}${u.pathname}` === p);
      const r = hit?.[1];
      reply = typeof r === 'function' ? r(u) : (r ?? { status: 404, body: { detail: 'Not found' } });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { provider, app, fetchImpl, bodies: () => provider.map((c) => JSON.parse(String(c.init.body))) };
}

function setEnv(provider: 'anthropic' | 'openai' | 'gemini') {
  Object.assign(process.env, {
    AI_API_KEY: KEY,
    AI_PROVIDER: provider,
    AI_BASE_URL: `https://${provider}.ai.test`,
    TASKS_INTERNAL_URL: 'http://tasks.test:8000/api/internal',
    ASSETS_INTERNAL_URL: 'http://assets.test:3000/api/internal',
    PLATFORM_SELF_URL: 'http://platform.test:4000/api/platform',
  });
}

function service(fetchImpl: typeof fetch) {
  const s = new AiService();
  s.fetchImpl = fetchImpl;
  return s;
}

const LEAVE_BALANCES = {
  body: [
    { leave_type: 1, name: 'Casual leave', paid: true, quota: 12, used: 4, balance: 8, pending: 1, available: 7, limited: true, icon_url: 'https://x/y.png' },
  ],
};
const LEAVE_REQUESTS = {
  body: {
    count: 1,
    results: [
      { id: 9, leave_type_name: 'Casual leave', start_date: '2026-10-02', end_date: '2026-10-02', days: 1, status: 'approved', reason: 'Family', document_url: 'https://secret/doc.pdf', reviewed_by_detail: { id: 2, name: 'Ravi', phone: '9999999999' }, created_at: '2026-09-30T04:30:00Z' },
    ],
  },
};
const ANSWER = (text: string) => ({ body: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });

afterEach(() => {
  process.env = { ...saved };
});

describe('AI data answers', () => {
  test('Anthropic tool loop: the user token is forwarded with GET, results come back trimmed, the answer follows', async () => {
    setEnv('anthropic');
    const w = world(
      [
        { body: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'toolu_1', name: 'my_leave', input: {} }], stop_reason: 'tool_use' } },
        ANSWER('You have **8** casual leaves left.'),
      ],
      { 'tasks.test:8000/api/leaves/balances/': LEAVE_BALANCES, 'tasks.test:8000/api/leaves/': LEAVE_REQUESTS },
    );
    const r = await service(w.fetchImpl).ask({ question: 'How many leaves do I have left?' }, { role: 'member', companyName: 'Acme', user: USER });
    assert.equal(r.answer, 'You have **8** casual leaves left.');
    assert.deepEqual(r.tools.map((t) => [t.name, t.status]), [['my_leave', 'ok']]);

    // The apps were read with the person's own token, GET only, never a service token.
    assert.equal(w.app.length, 2);
    for (const c of w.app) {
      assert.equal(c.init.method, 'GET');
      assert.equal((c.init.headers as Record<string, string>).authorization, `Bearer ${USER_TOKEN}`);
      assert.equal(c.init.body, undefined);
    }
    assert.ok(w.app.some((c) => c.url.startsWith('http://tasks.test:8000/api/leaves/?')), 'the API base is TASKS_INTERNAL_URL without /internal');

    const [first, second] = w.bodies();
    assert.ok(first.tools.some((t: { name: string }) => t.name === 'team_today'));
    assert.deepEqual(first.tool_choice, { type: 'auto' });
    assert.ok(first.tools.every((t: { input_schema: { type: string } }) => t.input_schema.type === 'object'));
    assert.equal(first.system[0].cache_control.type, 'ephemeral');
    assert.match(first.system[0].text, /answer ONLY from what the tools return/);
    assert.match(first.system[1].text, /Asha Rao/);
    assert.match(first.system[1].text, new RegExp(istToday().date));
    // The assistant turn goes back unchanged (thinking block included), then the tool result.
    assert.deepEqual(second.messages[1].content[0], { type: 'thinking', thinking: '', signature: 'sig' });
    const result = second.messages[2].content[0];
    assert.equal(result.type, 'tool_result');
    assert.equal(result.tool_use_id, 'toolu_1');
    assert.equal(result.is_error, undefined);
    const data = JSON.parse(result.content);
    assert.equal(data.balances[0].balance, 8);
    assert.equal(data.requests[0].reviewed_by, 'Ravi');
    assert.equal(data.requests[0].created_at, '2026-09-30 10:00 IST');
    assert.doesNotMatch(result.content, /secret|9999999999|icon_url|https:/, 'no links, documents or phone numbers reach the provider');
  });

  test('OpenAI function calling: tool_calls → role "tool" messages → answer', async () => {
    setEnv('openai');
    const w = world(
      [
        { body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'my_tasks', arguments: '{"filter":"overdue"}' } }] }, finish_reason: 'tool_calls' }] } },
        { body: { choices: [{ message: { role: 'assistant', content: 'Aapke 1 task overdue hain: T-00042.' } }] } },
      ],
      {
        'tasks.test:8000/api/tasks/dashboard/': { body: { tiles: { overdue: 1, pending: 2, in_progress: 0, completed: 5, in_time: 4, delayed: 1, total: 8 } } },
        'tasks.test:8000/api/tasks/': (u) => {
          assert.equal(u.searchParams.get('scope'), 'my');
          assert.equal(u.searchParams.get('overdue'), 'true');
          return { body: { count: 1, results: [{ code: 'T-00042', title: 'Send GST file', status: 'open', is_overdue: true, due_at: '2026-10-27T12:30:00Z', created_by_detail: { name: 'Ravi' } }] } };
        },
      },
    );
    const r = await service(w.fetchImpl).ask({ question: 'Mere overdue tasks?' }, { role: 'member', user: USER });
    assert.equal(r.answer, 'Aapke 1 task overdue hain: T-00042.');
    const [first, second] = w.bodies();
    assert.equal(first.tools[0].type, 'function');
    assert.ok(first.tools.some((t: { function: { name: string } }) => t.function.name === 'my_tasks'));
    assert.equal(first.tool_choice, 'auto');
    assert.equal(second.messages.at(-2).tool_calls[0].id, 'call_1');
    const tool = second.messages.at(-1);
    assert.equal(tool.role, 'tool');
    assert.equal(tool.tool_call_id, 'call_1');
    const data = JSON.parse(tool.content);
    assert.equal(data.counts.overdue, 1);
    assert.equal(data.rows[0].due_at, '2026-10-27 18:00 IST');
  });

  test('Gemini function calling: functionCall → functionResponse in a user turn (signature kept) → answer', async () => {
    setEnv('gemini');
    const w = world(
      [
        {
          body: {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    { functionCall: { id: 'fc_1', name: 'my_leave', args: {} }, thoughtSignature: 'sig-abc' },
                    { functionCall: { name: 'team_today', args: { status: 'late' } } },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        },
        { body: { candidates: [{ content: { role: 'model', parts: [{ text: 'You have **8** casual leaves left.' }] }, finishReason: 'STOP' }] } },
      ],
      {
        'tasks.test:8000/api/leaves/balances/': LEAVE_BALANCES,
        'tasks.test:8000/api/leaves/': LEAVE_REQUESTS,
        'tasks.test:8000/api/attendance/team_day/': { status: 403, body: { detail: 'You do not have permission to perform this action.' } },
      },
    );
    const r = await service(w.fetchImpl).ask({ question: 'How many leaves do I have left?' }, { role: 'member', user: USER });
    assert.equal(r.answer, 'You have **8** casual leaves left.');
    // Look-ups run in parallel: the log is in finishing order, the responses below in the order of the calls.
    assert.deepEqual(r.tools.map((t) => [t.name, t.status]).sort(), [['my_leave', 'ok'], ['team_today', 'not_allowed']]);
    for (const c of w.provider) {
      assert.equal((c.init.headers as Record<string, string>)['x-goog-api-key'], KEY);
      assert.ok(!c.url.includes(KEY), 'the key is never in the URL');
      assert.match(c.url, /^https:\/\/gemini\.ai\.test\/v1beta\/models\/[^/]+:generateContent$/);
    }
    for (const c of w.app) assert.equal((c.init.headers as Record<string, string>).authorization, `Bearer ${USER_TOKEN}`);

    const [first, second] = w.bodies();
    const decl = first.tools[0].functionDeclarations as Array<{ name: string; parameters?: { type: string; properties: Record<string, { type: string }> } }>;
    assert.ok(decl.some((d) => d.name === 'team_today'));
    assert.equal(decl.find((d) => d.name === 'my_leave')?.parameters, undefined, 'a tool without input has no parameters');
    const team = decl.find((d) => d.name === 'team_today')?.parameters;
    assert.equal(team?.type, 'OBJECT');
    assert.equal(team?.properties.status.type, 'STRING');
    assert.doesNotMatch(JSON.stringify(first.tools), /additionalProperties|pattern/);
    assert.deepEqual(first.toolConfig, { functionCallingConfig: { mode: 'AUTO' } });
    assert.match(first.systemInstruction.parts[0].text, /answer ONLY from what the tools return/);

    // The model turn goes back unchanged (thoughtSignature included), then one user turn with the function responses.
    assert.equal(second.contents.length, 3);
    assert.deepEqual(second.contents[1], { role: 'model', parts: [{ functionCall: { id: 'fc_1', name: 'my_leave', args: {} }, thoughtSignature: 'sig-abc' }, { functionCall: { name: 'team_today', args: { status: 'late' } } }] });
    const turn = second.contents[2];
    assert.equal(turn.role, 'user');
    const [leave, denied] = turn.parts.map((p: { functionResponse: { id?: string; name: string; response: Record<string, unknown> } }) => p.functionResponse);
    assert.equal(leave.id, 'fc_1');
    assert.equal(leave.name, 'my_leave');
    assert.equal((leave.response as { balances: Array<{ balance: number }> }).balances[0].balance, 8);
    assert.doesNotMatch(JSON.stringify(leave.response), /secret|9999999999|https:/);
    assert.equal(denied.id, undefined, 'no id is invented for a call that had none');
    assert.equal(denied.name, 'team_today');
    assert.equal((denied.response.error as { error: string }).error, 'not_allowed');
  });

  test('Gemini: after 4 rounds the last call has function calling NONE', async () => {
    setEnv('gemini');
    const call = { body: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'my_profile', args: {} } }] }, finishReason: 'STOP' }] } };
    const w = world([call, call, call, call, { body: { candidates: [{ content: { parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }] } }], {
      'tasks.test:8000/api/auth/me': { body: { username: 'asha' } },
    });
    const r = await service(w.fetchImpl).ask({ question: 'Who am I?' }, { user: USER });
    assert.equal(r.answer, 'Done.');
    assert.equal(w.provider.length, MAX_TOOL_ROUNDS + 1);
    assert.deepEqual(w.bodies().at(-1).toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  });

  test('a 403 from an app becomes "not allowed" for the model (is_error), never data', async () => {
    setEnv('anthropic');
    const w = world(
      [
        { body: { content: [{ type: 'tool_use', id: 'toolu_9', name: 'team_today', input: {} }], stop_reason: 'tool_use' } },
        ANSWER("You don't have access to your team's attendance."),
      ],
      { 'tasks.test:8000/api/attendance/team_day/': { status: 403, body: { detail: 'You do not have permission to perform this action.' } } },
    );
    const r = await service(w.fetchImpl).ask({ question: 'Who is late today?' }, { role: 'member', user: USER });
    assert.match(r.answer, /don't have access/);
    assert.deepEqual(r.tools.map((t) => t.status), ['not_allowed']);
    const result = w.bodies()[1].messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.equal(JSON.parse(result.content).error, 'not_allowed');
  });

  test('signed out: no tools offered and no app is ever called', async () => {
    setEnv('anthropic');
    const w = world([ANSWER('Kaampilot starts at ₹99 per user per month.')]);
    const r = await service(w.fetchImpl).ask({ question: 'Price?' });
    assert.equal(r.answer, 'Kaampilot starts at ₹99 per user per month.');
    const [body] = w.bodies();
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.match(body.system[0].text, /You cannot see or change anyone's data/);
    assert.equal(w.app.length, 0);
    // Even a stray tool request is not run without a signed-in person.
    const w2 = world([{ body: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 'x', name: 'my_leave', input: {} }], stop_reason: 'tool_use' } }]);
    assert.equal((await service(w2.fetchImpl).ask({ question: 'x' })).answer, 'Hi');
    assert.equal(w2.app.length, 0);
    assert.equal(w2.provider.length, 1);
  });

  test('at most 4 tool rounds (then tool_choice none) and 8 look-ups per question', async () => {
    setEnv('anthropic');
    const many = (n: number) => ({ body: { content: Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: 'my_profile', input: {} })), stop_reason: 'tool_use' } });
    const w = world([many(3), many(3), many(3), many(3), ANSWER('Done.')], { 'tasks.test:8000/api/auth/me': { body: { username: 'asha', department_display: 'Sales' } } });
    const r = await service(w.fetchImpl).ask({ question: 'Who am I?' }, { user: USER });
    assert.equal(r.answer, 'Done.');
    assert.equal(w.provider.length, MAX_TOOL_ROUNDS + 1);
    assert.deepEqual(w.bodies().at(-1).tool_choice, { type: 'none' });
    assert.equal(r.tools.filter((t) => t.status === 'ok').length, MAX_TOOL_CALLS);
    assert.equal(w.app.length, MAX_TOOL_CALLS, 'look-ups past the cap are not made');
    assert.match(toolSummary(r), /4 rounds, tools: my_profile ok/);
  });

  test('every tool is read-only: GET with the user token only, for any input', async () => {
    setEnv('anthropic');
    const w = world([], {});
    const fetchAll = (async (url: string, init: RequestInit) => {
      w.app.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const reader = makeReader(USER, fetchAll, Date.now() + 10_000);
    for (const t of DATA_TOOLS) {
      const r = await runTool(reader, DATA_TOOLS, t.name, { person_id: 7, month: '2026-10', range: 'this_month', filter: 'open', name: 'ravi' });
      assert.equal(r.status, 'ok', t.name);
    }
    assert.ok(w.app.length >= DATA_TOOLS.length);
    for (const c of w.app) {
      assert.equal(c.init.method, 'GET');
      assert.equal(c.init.body, undefined);
      assert.equal((c.init.headers as Record<string, string>).authorization, `Bearer ${USER_TOKEN}`);
    }
    assert.ok(w.app.some((c) => c.url === 'http://platform.test:4000/api/platform/billing'), 'billing is read from the Platform API itself (its guard checks access)');
    // Roster (PLAN.md §28): the person's own shifts and the team roster, read with their own token.
    assert.ok(w.app.some((c) => c.url.includes('/hr/roster/mine/?days=14')), 'my_roster');
    assert.ok(w.app.some((c) => /\/hr\/roster\/(\?|$)/.test(c.url)), 'team_roster');
    // Bad input and unknown tools are refused without a request.
    const before = w.app.length;
    assert.equal((await runTool(reader, DATA_TOOLS, 'person_report', { person_id: 'drop table' })).status, 'bad_input');
    assert.equal((await runTool(reader, DATA_TOOLS, 'delete_everything', {})).status, 'bad_input');
    assert.equal(w.app.length, before);
  });

  test('tools offered per app; none without a token', () => {
    assert.deepEqual(toolsFor(null), []);
    assert.deepEqual(toolsFor({ ...USER, token: '' }), []);
    const tasksOnly = toolsFor({ ...USER, apps: { tasks: 'u1' } }).map((t) => t.name);
    assert.ok(tasksOnly.includes('team_today') && !tasksOnly.includes('assets_overview'));
    const assetsOnly = toolsFor({ ...USER, apps: { assets: 'u2' } }).map((t) => t.name);
    assert.ok(assetsOnly.includes('assets_overview') && !assetsOnly.includes('my_leave') && assetsOnly.includes('billing_plan'));
    assert.equal(appBaseUrl('tasks', { TASKS_INTERNAL_URL: 'http://tasks:8000/api/internal/' }), 'http://tasks:8000/api');
    assert.equal(appBaseUrl('assets', {}), undefined);
    assert.equal(appBaseUrl('platform', { PORT: '4100' }), 'http://127.0.0.1:4100/api/platform');
  });

  test('trimming: private fields dropped, 50 rows, long text cut, IST times, size cap', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `P${i}`, phone: '98', email: 'a@b.c', photo_url: 'x', latitude: 1, check_in: '2026-10-28T03:35:00Z', note: '' }));
    const s = slim({ rows, long: 'x'.repeat(1000), nothing: null }) as { rows: unknown[]; long: string };
    assert.equal(s.rows.length, 51);
    assert.equal(s.rows[50], '… and 30 more not shown');
    assert.deepEqual(s.rows[0], { name: 'P0', check_in: '2026-10-28 09:05 IST' });
    assert.ok(s.long.length <= 301);
    assert.ok(!('nothing' in s));
    assert.equal(toIst('2026-10-28T18:40:00+00:00'), '2026-10-29 00:10 IST');
    const big = { rows: Array.from({ length: 50 }, (_, i) => ({ i, text: 'y'.repeat(290) })) };
    assert.ok(toolJson(big).length <= MAX_RESULT_CHARS);
  });
});
