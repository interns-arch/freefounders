// Count badges (PLAN.md §19.42): red counters for what waits for you, on tabs, menu items and the phone bottom bar.
// Flow: the owner gives a new member a task → the member sees My Tasks 1 (tab, sidebar Tasks item and group, phone bottom
// bar); the member asks for leave → the owner's Approvals tab counts it and approving it in the screen makes the count
// drop at once (no reload). Everything made here is removed at the end.
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function newMember(request: APIRequestContext, owner: string) {
  const stamp = Date.now().toString(36);
  const login = `e2e-badge-${stamp}`;
  const name = `E2E Badge ${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
  const member = roles.find((r) => r.code === 'ff_member')!;
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();
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
    login,
    password,
    name,
    tasksId,
    token: mine,
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

async function signedIn(browser: Browser, login: string, password: string, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

test('count badges: My Tasks for the member; Approvals for the owner drops right after approving', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const person = await newMember(request, owner);
  const type = await (await request.post('/tasks/api/leave-types/', { headers: auth(owner), data: { name: `E2E BLeave ${stamp}`, annual_quota: 10, paid: true, requires_document: false } })).json();
  let taskId = 0;
  try {
    // Nothing waits for a new member.
    const zero = await (await request.get('/tasks/api/badges/', { headers: auth(person.token) })).json();
    expect(zero.tasks).toEqual({ my_tasks: 0, to_accept: 0, requests: 0, total: 0 });

    const cats = await (await request.get('/tasks/api/task-categories/', { headers: auth(owner) })).json();
    const category = ((cats.results ?? cats) as Array<{ name: string }>)[0]?.name ?? 'General';
    const task = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E badge ${stamp}`, description: 'x', category, due_at: new Date(Date.now() + 86_400_000).toISOString(), effort_minutes: 15, assigned_to: person.tasksId },
    });
    expect(task.status(), await task.text()).toBe(201);
    taskId = (await task.json()).id;
    expect((await (await request.get('/tasks/api/badges/', { headers: auth(person.token) })).json()).tasks.my_tasks).toBe(1);

    // Desktop: the My Tasks tab, the sidebar's Tasks item and the Tasks group all say 1.
    const m = await signedIn(browser, person.login, person.password);
    await m.page.goto('/tasks/tasks');
    const views = m.page.getByRole('navigation', { name: 'Task views' }).first();
    await expect(views.getByRole('link', { name: 'My Tasks, 1 pending' })).toBeVisible();
    await expect(m.page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: 'Tasks, 1 pending' })).toBeVisible();
    await expect(m.page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Tasks, 1 pending' }).first()).toBeVisible();
    await shot(m.page, 'web-badges-my-tasks');
    await m.ctx.close();

    // Phone (360 px): the bottom bar's Tasks says 1 and the task tabs still scroll sideways.
    const p = await signedIn(browser, person.login, person.password, true);
    await p.page.goto('/tasks/tasks');
    await expect(p.page.getByRole('navigation', { name: 'Quick menu' }).getByRole('link', { name: 'Tasks, 1 pending' })).toBeVisible();
    const phoneViews = p.page.getByRole('navigation', { name: 'Task views' }).last();
    await expect(phoneViews.getByRole('link', { name: 'My Tasks, 1 pending' })).toBeVisible();
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(p.page, 'web-badges-phone');
    await p.ctx.close();

    // The member asks for leave → it waits for the owner; approving it in the screen drops the count at once.
    const leave = await request.post('/tasks/api/leaves/', {
      headers: auth(person.token),
      data: { leave_type: type.id, start_date: '2026-12-28', end_date: '2026-12-28', reason: 'Badge test' },
    });
    expect(leave.status(), await leave.text()).toBe(201);
    const before = (await (await request.get('/tasks/api/badges/', { headers: auth(owner) })).json()).hr.approvals as number;
    expect(before).toBeGreaterThanOrEqual(1);
    const o = await signedIn(browser, OWNER.login, OWNER.password);
    await o.page.goto('/attendance/approvals');
    const tabs = o.page.getByRole('navigation', { name: 'Attendance and leave sections' });
    await expect(tabs.getByRole('button', { name: `Approvals, ${before} pending` })).toBeVisible();
    await o.page.getByRole('button', { name: new RegExp(`^Approve ${person.name} — `) }).click();
    const after = before - 1;
    if (after > 0) await expect(tabs.getByRole('button', { name: `Approvals, ${after} pending` })).toBeVisible();
    else await expect(tabs.getByRole('button', { name: 'Approvals', exact: true })).toBeVisible();
    await shot(o.page, 'web-badges-approvals');
    await o.ctx.close();
  } finally {
    if (taskId) await request.delete(`/tasks/api/tasks/${taskId}/`, { headers: auth(owner) });
    await person.remove();
  }
});
