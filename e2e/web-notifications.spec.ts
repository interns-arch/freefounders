// Notifications by area (PLAN.md §19.37): the bell and the Notifications screen have the tabs All · Attendance · Tasks ·
// Assets · Approvals · Company with unread counts; a notification opens the page of its item and is marked read;
// "Mark all read" marks one tab. Flow: a new member asks for leave (the owner gets an Approvals notification that opens
// Attendance → Approvals on that request), the owner gives them a task (Tasks → opens the task), approves the leave
// (Attendance → opens My leave). Everything made here is removed at the end.
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
  const login = `e2e-notif-${stamp}`;
  const name = `E2E Notif ${stamp}`;
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
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ });

test('notifications grouped by area; a click opens the item and marks it read; mark all read per tab', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const typeName = `E2E NLeave ${stamp}`;
  const type = await (await request.post('/tasks/api/leave-types/', { headers: auth(owner), data: { name: typeName, annual_quota: 10, paid: true, requires_document: false } })).json();
  const person = await newMember(request, owner);
  let taskId = 0;
  try {
    // The member asks for leave → the owner (an approver) gets it under Approvals.
    const leave = await request.post('/tasks/api/leaves/', {
      headers: auth(person.token),
      data: { leave_type: type.id, start_date: '2026-12-21', end_date: '2026-12-22', reason: 'Notifications test' },
    });
    expect(leave.status(), await leave.text()).toBe(201);
    const leaveId = (await leave.json()).id as number;

    const o = await signedIn(browser, OWNER.login, OWNER.password);
    await o.page.goto('/notifications?tab=approvals');
    await expect(o.page.getByRole('tab', { name: /^Approvals/ })).toHaveAttribute('aria-selected', 'true');
    for (const label of ['All', 'Attendance', 'Tasks', 'Assets', 'Approvals', 'Company']) {
      await expect(o.page.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    const request_ = o.page.getByRole('link', { name: new RegExp(`Unread: Leave request from ${person.name}`) });
    await expect(request_).toBeVisible();
    await shot(o.page, 'web-notifications-approvals');
    await request_.click();
    await expect(o.page).toHaveURL(new RegExp(`/attendance/approvals\\?leave=${leaveId}$`));
    await expect(o.page.locator('[data-focused]')).toContainText(person.name);
    // Opened = read.
    const ownerRows = await (await request.get('/tasks/api/notifications/?category=approvals&page_size=50', { headers: auth(owner) })).json();
    const mine = ownerRows.results.find((n: { title: string }) => n.title === `Leave request from ${person.name}`);
    expect(mine.link).toBe(`/hr?tab=approvals&leave=${leaveId}`);
    expect(mine.read_at).not.toBeNull();
    await o.ctx.close();

    // The owner gives a task, then approves the leave.
    const cats = await (await request.get('/tasks/api/task-categories/', { headers: auth(owner) })).json();
    const category = ((cats.results ?? cats) as Array<{ name: string }>)[0]?.name ?? 'General';
    const task = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E notified ${stamp}`, description: 'x', category, due_at: new Date(Date.now() + 86_400_000).toISOString(), effort_minutes: 15, assigned_to: person.tasksId },
    });
    expect(task.status(), await task.text()).toBe(201);
    taskId = (await task.json()).id;
    expect((await request.post(`/tasks/api/leaves/${leaveId}/review/`, { headers: auth(owner), data: { decision: 'approved', remarks: 'ok' } })).ok()).toBeTruthy();

    // The member's bell (phone): 2 unread, one in Tasks and one in Attendance.
    const m = await signedIn(browser, person.login, person.password, true);
    await m.page.goto('/?home=1');
    await expect(bell(m.page)).toHaveAccessibleName('Notifications, 2 unread');
    await bell(m.page).click();
    await expect(m.page.getByRole('tab', { name: 'Tasks, 1 unread' })).toBeVisible();
    await expect(m.page.getByRole('tab', { name: 'Attendance, 1 unread' })).toBeVisible();
    await m.page.getByRole('tab', { name: 'Tasks, 1 unread' }).click();
    const list = m.page.getByRole('tabpanel', { name: 'Latest notifications' });
    await expect(list.getByRole('button', { name: /Unread: Task assigned/ })).toBeVisible();
    await expect(list.getByText(/Leave approved/)).toHaveCount(0);
    await shot(m.page, 'web-notifications-bell-phone');
    await list.getByRole('button', { name: /Unread: Task assigned/ }).click();
    await expect(m.page).toHaveURL(new RegExp(`/tasks/tasks/${taskId}$`));
    await expect(m.page.getByRole('dialog', { name: `E2E notified ${stamp}` })).toBeVisible();
    await m.page.keyboard.press('Escape');
    await expect(bell(m.page)).toHaveAccessibleName('Notifications, 1 unread');

    // Attendance → My leave (the leave decision), from the bell too.
    await bell(m.page).click();
    await m.page.getByRole('tab', { name: 'Attendance, 1 unread' }).click();
    await m.page.getByRole('tabpanel', { name: 'Latest notifications' }).getByRole('button', { name: /Leave approved/ }).click();
    await expect(m.page).toHaveURL(new RegExp(`/attendance/leave\\?leave=${leaveId}$`));
    await expect(bell(m.page)).toHaveAccessibleName('Notifications');
    await m.ctx.close();

    // Mark all read on one tab only (API: a new pair of notifications, then the screen).
    const second = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E notified 2 ${stamp}`, description: 'x', category, due_at: new Date(Date.now() + 86_400_000).toISOString(), effort_minutes: 15, assigned_to: person.tasksId },
    });
    expect(second.status()).toBe(201);
    const third = await request.post('/tasks/api/leaves/', {
      headers: auth(person.token),
      data: { leave_type: type.id, start_date: '2026-12-28', end_date: '2026-12-28', reason: 'Second' },
    });
    const thirdId = (await third.json()).id;
    expect((await request.post(`/tasks/api/leaves/${thirdId}/review/`, { headers: auth(owner), data: { decision: 'rejected', remarks: 'no' } })).ok()).toBeTruthy();
    const d = await signedIn(browser, person.login, person.password);
    await d.page.goto('/notifications?tab=tasks');
    await d.page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(d.page.getByRole('tab', { name: 'Tasks', exact: true })).toBeVisible();
    await expect(d.page.getByRole('tab', { name: 'Attendance, 1 unread' })).toBeVisible();
    await shot(d.page, 'web-notifications-page');
    await d.ctx.close();
    await request.delete(`/tasks/api/tasks/${(await second.json()).id}/`, { headers: auth(owner) });
  } finally {
    if (taskId) await request.delete(`/tasks/api/tasks/${taskId}/`, { headers: auth(owner) });
    await person.remove();
    await request.delete(`/tasks/api/leave-types/${type.id}/`, { headers: auth(owner) });
  }
});
