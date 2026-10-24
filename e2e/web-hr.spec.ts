// Phase 6 parity tests (PLAN.md §18.2): HR in the new web app — check-in with a photo, leave apply + approve,
// HR settings, approvals. Found by role/label/text only; every person and setting made here is cleaned up.
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

/** The company may ask "Are you wearing the uniform?" before a check-in (HR setting, PLAN.md uniform check): answer Yes. */
async function answerUniform(page: Page) {
  const yes = page.getByRole('button', { name: /Yes, I.m wearing it/ });
  await yes.waitFor({ timeout: 2000 }).then(() => yes.click()).catch(() => {});
}


const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

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

/** A new person with a Tasks member role who has set their own password. */
async function newPerson(request: APIRequestContext, owner: string, label: string) {
  const stamp = Date.now().toString(36);
  const login = `e2e-hr-${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const name = `E2E ${label} ${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; level: number; system: boolean; grants: Array<{ app: string }> }>;
  const member = roles.find((r) => (r as { code?: string }).code === 'ff_member')!; // the built-in Member (PLAN.md §19.28)
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();
  return {
    login,
    password,
    name,
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

async function ownerPage(browser: Browser, path: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await signIn(page, OWNER.login, OWNER.password);
  await page.goto(path);
  return { ctx, page };
}

test('check-in with a photo; HR sees the thumbnail in Team', async ({ browser, request }) => {
  const owner = await token(request);
  const hrBefore = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'required', geofence_enabled: false} })).ok()).toBeTruthy();
  const person = await newPerson(request, owner, 'Punch');
  try {
    const context = await browser.newContext({ permissions: ['camera'] });
    const page = await context.newPage();
    await page.goto('/');
    await signIn(page, person.login, person.password);
    await page.goto('/tasks/hr');
    await expect(page.getByRole('heading', { name: 'Leave & Attendance' })).toBeVisible();
    await expect(page.getByText('A photo is taken at every check-in and check-out.')).toBeVisible();
    await page.getByRole('button', { name: 'Check in' }).click(); await answerUniform(page);
    const camera = page.getByRole('dialog', { name: 'Check in' });
    await expect(camera).toBeVisible();
    await expect(camera.getByText(/A photo is saved with your attendance/)).toBeVisible();
    await shot(page, 'web-hr-camera');
    await camera.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText('Checked in ✅')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check out' })).toBeEnabled();
    await context.close();

    const { ctx, page: hr } = await ownerPage(browser, '/tasks/hr?tab=team');
    // The list draws 50 staff at a time (PLAN.md §19.18): find the new person by their login (unique; a name search
    // matches any of its words, i.e. every "E2E …" person).
    await hr.getByLabel('Search staff').fill(person.login);
    const thumb = hr.getByRole('button', { name: `${person.name} check-in photo` });
    await expect(thumb).toBeVisible();
    await thumb.click();
    await expect(hr.getByRole('img', { name: `${person.name} check-in photo` })).toBeVisible();
    await shot(hr, 'web-hr-team-photo');
    await ctx.close();
  } finally {
    const restore = Object.fromEntries(['photo', 'geofence_enabled'].map((k) => [k, hrBefore[k].custom ? hrBefore[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await person.remove();
  }
});

test('punch in and out from Home (PLAN.md §19.3, §19.14); old /tasks/hr links open Attendance', async ({ browser, request }) => {
  const owner = await token(request);
  const hrBefore = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'off', geofence_enabled: false} })).ok()).toBeTruthy();
  const person = await newPerson(request, owner, 'Portal');
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await signIn(page, person.login, person.password);
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
    const card = page.getByRole('region', { name: 'Attendance & Shifts' });
    await expect(card.getByText('Not checked in')).toBeVisible();
    await card.getByRole('button', { name: 'Punch in' }).click(); await answerUniform(page);
    await expect(card.getByText('Checked in ✅')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Punch out' })).toBeVisible();
    await shot(page, 'web-portal-punched-in');
    await card.getByRole('button', { name: 'Punch out' }).click();
    await expect(card.getByText('Checked out ✅')).toBeVisible();
    await expect(card.getByRole('button', { name: /Done for today/ })).toBeVisible();

    await page.goto('/tasks/hr?tab=leave');
    await expect(page).toHaveURL(/\/attendance\/leave$/);
    await expect(page.getByRole('navigation', { name: 'Attendance menu' }).getByRole('link', { name: 'My leave' })).toHaveAttribute('aria-current', 'page');
    await context.close();
  } finally {
    const restore = Object.fromEntries(['photo', 'geofence_enabled'].map((k) => [k, hrBefore[k].custom ? hrBefore[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await person.remove();
  }
});

test('leave is applied for and approved in Approvals', async ({ browser, request }) => {
  const owner = await token(request);
  const typeName = `E2E Leave ${Date.now().toString(36)}`;
  const type = await (await request.post('/tasks/api/leave-types/', { headers: auth(owner), data: { name: typeName, annual_quota: 10, paid: true, requires_document: false } })).json();
  const person = await newPerson(request, owner, 'Leave');
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await signIn(page, person.login, person.password);
    await page.goto('/tasks/hr?tab=leave');
    await page.getByRole('button', { name: 'Apply for leave' }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply for leave' });
    // The remaining balance is shown next to the type (PLAN.md §19.33).
    await dialog.getByLabel('Leave type *').selectOption({ label: `${typeName} (10 days left)` });
    await expect(dialog.getByText('10 days left this year.')).toBeVisible();
    await dialog.getByLabel('From *').fill('2026-12-14');
    await dialog.getByLabel('To *').fill('2026-12-15');
    await dialog.getByLabel('Reason *').fill('Family function');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row', { name: new RegExp(typeName) });
    await expect(row.getByText('Pending')).toBeVisible();
    await context.close();

    const { ctx, page: hr } = await ownerPage(browser, '/tasks/hr');
    await hr.getByRole('button', { name: 'Approvals' }).click();
    const title = new RegExp(`${person.name} — ${typeName}`);
    await expect(hr.getByText(title)).toBeVisible();
    await hr.getByRole('textbox', { name: title }).fill('Enjoy');
    await shot(hr, 'web-hr-approvals');
    await hr.getByRole('button', { name: new RegExp(`^Approve ${person.name}`) }).click();
    await expect(hr.getByText(title)).toHaveCount(0);
    await ctx.close();

    const pt = await token(request, person.login, person.password);
    const mine = await (await request.get('/tasks/api/leaves/', { headers: auth(pt) })).json();
    const l = (mine.results ?? mine)[0];
    expect(l.status).toBe('approved');
    expect(l.remarks).toBe('Enjoy');
  } finally {
    await person.remove();
    await request.delete(`/tasks/api/leave-types/${type.id}/`, { headers: auth(owner) });
  }
});

test('HR settings: attendance rules are saved', async ({ browser, request }) => {
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const grace = before.grace_minutes.value === 17 ? 18 : 17;
  try {
    const { ctx, page } = await ownerPage(browser, '/tasks/hr?tab=settings');
    const form = page.getByRole('form', { name: 'Attendance rules' });
    await expect(form.getByLabel('Photo at check-in / check-out')).toBeVisible();
    await expect(form.getByLabel('Leave and corrections are approved by')).toBeVisible();
    await form.getByLabel('Late after (minutes of grace)').fill(String(grace));
    await form.getByRole('button', { name: 'Save rules' }).click();
    await expect(form.getByRole('status')).toHaveText('Saved');
    const after = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
    expect(after.grace_minutes.value).toBe(grace);
    await expect(page.getByRole('heading', { name: 'Office locations (geo-fence)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Leave types' })).toBeVisible();
    await shot(page, 'web-hr-settings');
    await ctx.close();
  } finally {
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { grace_minutes: before.grace_minutes.custom ? before.grace_minutes.value : '' } });
  }
});

test('HR settings: punch-in reminders (PLAN.md §19.39): defaults, preview, save, range checked', async ({ browser, request }) => {
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const keys = ['punch_reminders', 'punch_reminder_count', 'punch_reminder_gap', 'punch_reminder_first', 'work_start'];
  const restore = Object.fromEntries(keys.map((k) => [k, before[k].custom ? before[k].value : '']));
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { punch_reminders: '', punch_reminder_count: '', punch_reminder_gap: '', punch_reminder_first: '', work_start: '09:30' } })).ok()).toBeTruthy();
  try {
    const { ctx, page } = await ownerPage(browser, '/attendance/settings');
    const card = page.getByRole('form', { name: 'Punch-in reminders' });
    await expect(card).toBeVisible({ timeout: 30_000 }); // the settings screen is loaded on first open
    await expect(card.getByLabel('Number of reminders')).toHaveValue('3');
    await expect(card.getByLabel('Minutes between reminders')).toHaveValue('30');
    await expect(card.getByLabel('First reminder after reporting time (min)')).toHaveValue('30');
    await expect(card.getByText('Reporting time 09:30: reminders at 10:00, 10:30, 11:00.')).toBeVisible();
    await card.getByLabel('Number of reminders').fill('11');
    // 1–10 only: the browser refuses 11 before sending (the server says "Between 1 and 10" too).
    expect(await card.getByLabel('Number of reminders').evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);
    await card.getByLabel('Number of reminders').fill('4');
    await card.getByLabel('Minutes between reminders').fill('15');
    await expect(card.getByText('Reporting time 09:30: reminders at 10:00, 10:15, 10:30, 10:45.')).toBeVisible();
    await card.getByRole('button', { name: 'Save reminders' }).click();
    await expect(card.getByRole('status')).toHaveText('Saved');
    const after = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
    expect([after.punch_reminders.value, after.punch_reminder_count.value, after.punch_reminder_gap.value]).toEqual([true, 4, 15]);
    // The person's punch screen gets the rule (the phone app plans its own reminders from it).
    const today = await (await request.get('/tasks/api/attendance/today/', { headers: auth(owner) })).json();
    expect(today.punch_reminders).toEqual(expect.objectContaining({ enabled: true, count: 4, gap_minutes: 15, first_after_minutes: 30 }));
    await ctx.close();
  } finally {
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
  }
});

test('approvers see Approvals; payroll tabs are in-app Attendance sections', async ({ browser }) => {
  const { ctx, page } = await ownerPage(browser, '/tasks/hr?tab=approvals');
  await expect(page.getByRole('heading', { name: /^Leave requests \(/ })).toBeVisible();
  // Leave and Regularization are two tabs (PLAN.md §19.38).
  await page.getByRole('group', { name: 'Approvals' }).getByRole('button', { name: /^Regularization/ }).click();
  await expect(page.getByRole('heading', { name: /^Regularization requests \(/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Attendance and leave sections' });
  await expect(nav.getByRole('button', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page');
  // Payroll (module `payroll`, hr.manage) is a real tab now: it opens /attendance/payroll, not the classic screen.
  const payroll = nav.getByRole('button', { name: 'Payroll' });
  if (await payroll.count()) {
    await payroll.click();
    await expect(page).toHaveURL(/\/attendance\/payroll$/);
    await expect(page.getByRole('group', { name: 'Payroll sections' })).toBeVisible();
  }
  await expect(nav.getByRole('link')).toHaveCount(0);
  await ctx.close();
});
