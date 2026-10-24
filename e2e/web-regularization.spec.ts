// Attendance regularization (PLAN.md §19.38): an employee on a phone asks to regularize a past day from My attendance,
// their reporting manager (no approve permission of their own) approves it from Approvals → Regularization, the day
// shows the corrected times and the "Regularized" tag; over the monthly limit the employee gets the limit message.
// Found by role/label/text only; the people and the setting changed here are cleaned up.
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, login: string, password: string) {
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** A new Member who has set their own password; `reportsTo` = a Platform person id. */
async function newPerson(request: APIRequestContext, owner: string, label: string, reportsTo?: string) {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
  const login = `e2e-reg-${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const name = `E2E ${label} ${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp }, ...(reportsTo ? { reportsTo } : {}) },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
  const member = roles.find((r) => r.code === 'ff_member')!;
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();
  return {
    id: personId,
    login,
    password,
    name,
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The latest past working day (not a weekly off), and the one before it. */
function workingDays(weekOffs: number[]): [string, string] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < 2) {
    d.setDate(d.getDate() - 1);
    if (!weekOffs.includes((d.getDay() + 6) % 7)) out.push(iso(d));
  }
  return [out[0], out[1]];
}

async function phonePage(browser: Browser, login: string, password: string) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await signIn(page, login, password);
  return { ctx, page };
}

test('employee regularizes a day on a phone, the reporting manager approves, the day is corrected; limit message', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { reg_enabled: true, reg_monthly_limit: 1, reg_days_back: 7 } })).ok()).toBeTruthy();
  const manager = await newPerson(request, owner, 'Manager');
  const employee = await newPerson(request, owner, 'Employee', manager.id);
  try {
    const cfg = await (await request.get('/tasks/api/hr/config/', { headers: auth(await token(request, employee.login, employee.password)) })).json();
    const [day, earlier] = workingDays(cfg.week_offs ?? []);

    // 1. The employee: My attendance on that day → Regularize this day → Send (the reason and shift times are filled in).
    const emp = await phonePage(browser, employee.login, employee.password);
    await emp.page.goto(`/attendance/history?date=${day}`);
    await emp.page.getByRole('button', { name: 'Regularize this day' }).click();
    const form = emp.page.getByRole('form', { name: 'Regularize attendance' });
    await expect(form.getByText('1 of 1 request left this month')).toBeVisible();
    await expect(form.getByRole('radio', { name: 'Forgot to punch in' })).toBeChecked();
    await form.getByLabel('Note (optional)').fill('Phone battery died');
    await shot(emp.page, 'web-regularization-form');
    await form.getByRole('button', { name: 'Send request' }).click();
    await expect(emp.page.getByRole('status').filter({ hasText: 'sent for approval' })).toBeVisible();
    await expect(emp.page.getByRole('button', { name: 'Regularization waiting for approval' })).toBeDisabled();
    await emp.ctx.close();

    // 2. The reporting manager: Approvals → Regularization (no leave approvals of their own) → Approve.
    const mgr = await phonePage(browser, manager.login, manager.password);
    await mgr.page.goto('/attendance/approvals');
    await expect(mgr.page.getByRole('heading', { name: /^Regularization requests \(/ })).toBeVisible();
    const approve = mgr.page.getByRole('button', { name: new RegExp(`^Approve ${employee.name} — `) });
    await expect(approve).toBeVisible();
    await expect(mgr.page.getByText('Forgot to punch in').first()).toBeVisible();
    await shot(mgr.page, 'web-regularization-approvals');
    await approve.click();
    await expect(approve).toHaveCount(0);
    await mgr.ctx.close();

    // 3. The day is corrected: shift times, Regularized tag, the decision in My regularization requests.
    const emp2 = await phonePage(browser, employee.login, employee.password);
    await emp2.page.goto(`/attendance/history?date=${day}`);
    await expect(emp2.page.getByRole('heading').getByText('Regularized')).toBeVisible();
    await expect(emp2.page.getByRole('list', { name: 'My regularization requests' }).getByText(`Approved by ${manager.name}`)).toBeVisible();
    const month = await (
      await request.get(`/tasks/api/attendance/monthly/?year=${day.slice(0, 4)}&month=${Number(day.slice(5, 7))}`, { headers: auth(await token(request, employee.login, employee.password)) })
    ).json();
    const rec = month.days.find((d: { date: string }) => d.date === day);
    expect(rec.regularized).toBe(true);
    expect(rec.check_in).toBeTruthy();
    expect(['present', 'late', 'half_day']).toContain(rec.status);
    await shot(emp2.page, 'web-regularization-day');

    // 4. Over the monthly limit (1): the employee is told how many are used / left.
    await emp2.page.goto('/attendance');
    await emp2.page.getByRole('button', { name: 'Regularize a day' }).click();
    const again = emp2.page.getByRole('form', { name: 'Regularize attendance' });
    if (earlier.slice(0, 7) === day.slice(0, 7)) {
      await expect(again.getByText('You have used all 1 regularization requests for this month.')).toBeVisible();
      await expect(again.getByRole('button', { name: 'Send request' })).toBeDisabled();
      // The server says the same if asked anyway.
      const res = await request.post('/tasks/api/attendance-corrections/', {
        headers: auth(await token(request, employee.login, employee.password)),
        data: { date: earlier, reason_type: 'forgot_out', check_in_time: '09:30', check_out_time: '18:30' },
      });
      expect(res.status()).toBe(400);
      expect((await res.json()).detail).toContain('Monthly limit reached');
    }
    await emp2.ctx.close();
  } finally {
    const keys = ['reg_enabled', 'reg_monthly_limit', 'reg_days_back'];
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: Object.fromEntries(keys.map((k) => [k, before[k]?.custom ? before[k].value : ''])) });
    await employee.remove();
    await manager.remove();
  }
});
