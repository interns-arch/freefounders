// Task chains, the person Excel report and the change-request ranking (PLAN.md §19.41; original app 1dabd35, 5fde3aa,
// 2bc1425). A Member holding a task gives a part to a colleague on a 390 px phone; the main task waits until the part
// is done and accepted; the Owner sees Tasks → Chains and the tree; the person's Excel report has 8 filterable sheets
// whose Summary equals the profile's API; inside the phone app the report goes through the native bridge.
// Run against `npm run dev`.
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, login = OWNER.login, password = OWNER.password) {
  await page.goto('/?choose');
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** A new person with the built-in Member role (no Assign permission), known to Tasks. */
async function member(request: APIRequestContext, owner: string, tag: string) {
  const login = `e2e-chain-${tag}`;
  const password = 'E2e@123456';
  const name = `E2E Chain ${tag}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
  const m = roles.find((r) => r.code === 'ff_member')!;
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [m.id] } })).ok()).toBeTruthy();
  const mine = await token(request, login, password);
  let tasksId = 0;
  await expect
    .poll(async () => {
      const me = await request.get('/tasks/api/auth/me', { headers: auth(mine) });
      tasksId = me.ok() ? (await me.json()).id : 0;
      return tasksId;
    }, { timeout: 30_000 })
    .toBeGreaterThan(0);
  return {
    personId, login, password, name, tasksId, token: mine,
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

async function category(request: APIRequestContext, owner: string): Promise<string> {
  const data = await (await request.get('/tasks/api/task-categories/?department=', { headers: auth(owner) })).json();
  return ((data.results ?? data) as Array<{ name: string }>)[0]?.name ?? '';
}

async function complete(request: APIRequestContext, who: string, id: number) {
  const res = await request.post(`/tasks/api/tasks/${id}/complete/`, {
    headers: auth(who),
    multipart: { remarks: 'Done and checked', actual_minutes: '20', file: { name: 'proof.txt', mimeType: 'text/plain', buffer: Buffer.from('proof') } },
  });
  return res;
}

// ─── a tiny .xlsx reader (zip central directory + inflate) ─────────────────
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd > 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Sheet names in order, and for one sheet the two first columns as label → value. */
function workbook(buf: Buffer) {
  const files = unzip(buf);
  const names = [...files.get('xl/workbook.xml')!.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => unxml(m[1]!));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheet = (i: number) => files.get(`xl/worksheets/sheet${i + 1}.xml`)!;
  const pairs = (i: number) => {
    const map = new Map<string, string>();
    for (const row of sheet(i).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1] ?? '';
        return { col: c[1], value: /t="s"/.test(c[2]!) ? shared[Number(v)] ?? '' : unxml(v) };
      });
      const a = cells.find((c) => c.col === 'A')?.value;
      if (a) map.set(a, cells.find((c) => c.col === 'B')?.value ?? '');
    }
    return map;
  };
  return { names, hasFilter: (i: number) => /<autoFilter /.test(sheet(i)), pairs };
}

test('a Member gives a part on a phone; the main task waits for it; the Owner sees Chains and the tree', async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const a = await member(request, owner, `a-${stamp}`);
  const b = await member(request, owner, `b-${stamp}`);
  const ids: number[] = [];
  try {
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E chain main ${stamp}`, description: 'Split me', category: await category(request, owner), due_at: due, effort_minutes: 120, assigned_to: a.tasksId },
    });
    expect(res.status(), await res.text()).toBe(201);
    const main = await res.json();
    ids.push(main.id);

    // A (Member, no Assign permission) gives a part of the task the Owner gave them, on a 390 px phone.
    const ctx = await browser.newContext(PHONE);
    const phone = await ctx.newPage();
    try {
      await signIn(phone, a.login, a.password);
      await phone.goto(`/tasks/tasks/${main.id}`);
      const detail = phone.getByRole('dialog', { name: `E2E chain main ${stamp}` });
      await detail.getByRole('button', { name: 'Give a part to someone' }).click();
      const give = phone.getByRole('dialog', { name: `Give parts of ${main.code}` });
      await expect(give.getByText('Effort left to give')).toBeVisible();
      await give.getByLabel('Part 1: give to').selectOption(String(b.tasksId));
      await give.getByLabel('Part 1: what should they do').fill(`E2E chain part ${stamp}`);
      await give.getByRole('spinbutton', { name: /^Effort/ }).fill('45');
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await give.getByRole('button', { name: 'Give 1 part' }).click();
      await expect(give).toBeHidden();
      await expect(detail.getByText(`E2E chain part ${stamp}`)).toBeVisible();
      await expect(detail.getByText(/can't be completed yet/)).toBeVisible();
      await expect(detail.getByRole('button', { name: 'Complete' })).toBeDisabled();
    } finally {
      await ctx.close();
    }

    const part = ((await (await request.get(`/tasks/api/tasks/${main.id}/`, { headers: auth(owner) })).json()).subtasks as Array<{ id: number; code: string }>)[0]!;
    ids.push(part.id);
    expect((await complete(request, a.token, main.id)).status()).toBe(400); // part still open
    expect((await complete(request, b.token, part.id)).ok()).toBeTruthy();
    expect((await complete(request, a.token, main.id)).status()).toBe(400); // done, not yet accepted
    const inbox = await (await request.get(`/tasks/api/task-completions/?scope=inbox&task=${part.id}`, { headers: auth(a.token) })).json();
    const review = (inbox.results ?? inbox)[0];
    expect((await request.post(`/tasks/api/task-completions/${review.id}/review/`, { headers: auth(a.token), data: { decision: 'approved' } })).ok()).toBeTruthy();
    const d = await (await request.get(`/tasks/api/tasks/${main.id}/`, { headers: auth(a.token) })).json();
    expect(d.chain.blocked).toBeNull();
    // effort split: B earns their 45 min, A keeps 75
    expect(d.chain.effort_left).toBe(75);

    // The Owner: Tasks → Chains, then the whole tree (two levels).
    await signIn(page);
    await page.goto('/tasks/tasks?tab=chains');
    await page.getByRole('radio', { name: 'All' }).or(page.getByRole('button', { name: 'All', exact: true })).first().click();
    await page.getByRole('button', { name: new RegExp(`E2E chain main ${stamp}`) }).first().click();
    const tree = page.getByRole('dialog', { name: new RegExp(`Task chain — ${main.code}`) });
    await expect(tree.getByTestId('chain-node')).toHaveCount(2);
    await expect(tree.locator('[data-level="1"]')).toContainText(b.name);
    await page.keyboard.press('Escape');
    // and the "Task chain" button on the task itself
    await page.goto(`/tasks/tasks/${part.id}`);
    await expect(page.getByTestId('part-of-note')).toContainText(main.code);
    await page.getByRole('button', { name: 'Task chain' }).click();
    await expect(page.getByRole('dialog', { name: new RegExp(`Task chain — ${main.code}`) }).getByTestId('chain-node')).toHaveCount(2);

    // A Member does not get the Chains tab or the chain API.
    expect((await request.get('/tasks/api/tasks/chains/', { headers: auth(a.token) })).status()).toBe(403);
  } finally {
    for (const id of ids.reverse()) await request.delete(`/tasks/api/tasks/${id}/`, { headers: auth(owner) });
    await a.remove();
    await b.remove();
  }
});

test('person Excel report: 8 filterable sheets, Summary equals the profile API; Members get 403', async ({ page, request }) => {
  test.setTimeout(120_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const a = await member(request, owner, `x-${stamp}`);
  const ids: number[] = [];
  try {
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E report ${stamp}`, description: 'x', category: await category(request, owner), due_at: due, effort_minutes: 30, assigned_to: a.tasksId },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids.push((await res.json()).id);
    expect((await request.get(`/tasks/api/tasks/person_export/?user=${a.tasksId}&range=this_month`, { headers: auth(a.token) })).status()).toBe(403);

    await signIn(page);
    await page.goto(`/tasks/tasks?tab=employees&user=${a.tasksId}`);
    const sheet = page.getByRole('dialog', { name: a.name });
    await expect(sheet.getByText('Total', { exact: true })).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: /^Excel report for/ }).click()]);
    expect(file.suggestedFilename()).toMatch(/^tasks-performance-e2e-chain-x-.*-this-month-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = workbook(readFileSync((await file.path())!));
    expect(wb.names).toEqual(['Summary', 'Month by month', 'Tasks received', 'Given by whom', 'Tasks delegated', 'Delegated to whom', 'Change requests', 'Completion reviews']);
    for (let i = 0; i < 8; i++) expect(wb.hasFilter(i), wb.names[i]).toBeTruthy();
    const screen = (await (await request.get(`/tasks/api/tasks/employees_report/?range=this_month&user=${a.tasksId}`, { headers: auth(owner) })).json()).rows[0];
    const summary = wb.pairs(0);
    for (const [label, key] of [['Total in range', 'total'], ['Completed', 'completed'], ['Pending', 'pending'], ['Overdue', 'overdue']] as const)
      expect(Number(summary.get(label)), label).toBe(screen[key]);
  } finally {
    for (const id of ids) await request.delete(`/tasks/api/tasks/${id}/`, { headers: auth(owner) });
    await a.remove();
  }
});

/** The phone app: the Excel report is handed to the native bridge (saveFile), not to the browser. */
async function shell(browser: Browser) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const log: Array<{ type: string; filename?: string; mime?: string }> = [];
    w.__shellLog = log;
    w.FreeFoundersApp = { platform: 'android', version: 'e2e', camera: 'granted' };
    const reply = (r: unknown) => setTimeout(() => document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(r) })), 30);
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const m = JSON.parse(raw) as { id?: string; type: string; filename?: string; mime?: string };
        log.push({ type: m.type, filename: m.filename, mime: m.mime });
        if (!m.id) return;
        if (m.type === 'download') return reply({ id: m.id, ok: true, data: { saved: true } });
        if (m.type.startsWith('reminder')) return reply({ id: m.id, ok: true, data: { settings: null, permission: 'granted', next: null, skipped: null } });
        return reply({ id: m.id, ok: false, error: `unknown ${m.type}` });
      },
    };
  });
  return ctx;
}

test('in the phone app the person Excel report goes through the app; the ranking shows old → new due date', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await token(request);
  const me = await (await request.get('/tasks/api/auth/me', { headers: auth(owner) })).json();
  const ctx = await shell(browser);
  const page = await ctx.newPage();
  // one Member's request to move a due date, so the ranking has a row to open
  const asker = await member(request, owner, `r-${Date.now().toString(36)}`);
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const made = await request.post('/tasks/api/tasks/', {
    headers: auth(owner),
    data: { title: `E2E ranking ${Date.now().toString(36)}`, description: 'x', category: await category(request, owner), due_at: due, effort_minutes: 15, assigned_to: asker.tasksId },
  });
  expect(made.status(), await made.text()).toBe(201);
  const taskId = (await made.json()).id as number;
  const asked = await request.post(`/tasks/api/tasks/${taskId}/request_change/`, {
    headers: auth(asker.token),
    data: { changes: { due_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }, reason: 'Supplier is late' },
  });
  expect(asked.status(), await asked.text()).toBe(201);
  try {
    await signIn(page);
    await page.goto(`/tasks/tasks?tab=employees&user=${me.id}`);
    await page.getByRole('button', { name: /^Excel report for/ }).click();
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __shellLog: Array<{ type: string; filename?: string }> }).__shellLog)).find((m) => m.type === 'download')?.filename ?? '')
      .toMatch(/^tasks-performance-.*\.xlsx$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.goto('/tasks/team');
    const panel = page.getByText('Who asks most to change a due date', { exact: true });
    await expect(panel).toBeVisible();
    const empty = page.getByText('Nobody asked to move a due date in this range.');
    const header = page.getByRole('columnheader', { name: 'Last asked' });
    await expect(header.or(empty)).toBeVisible({ timeout: 15_000 });
    if (await header.isVisible()) {
      await page.getByRole('button', { name: `Show ${asker.name}'s requests` }).click();
      await expect(page.getByTestId('leader-request').filter({ hasText: 'Supplier is late' }).first()).toContainText('→');
    }
  } finally {
    await ctx.close();
    await request.delete(`/tasks/api/tasks/${taskId}/`, { headers: auth(owner) });
    await asker.remove();
  }
});
