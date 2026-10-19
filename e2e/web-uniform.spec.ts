// Uniform check at punch-in (PLAN.md §19.27): HR turns on "Ask and record" on the HR settings screen, an employee
// answers the question before checking in (Cancel stops the punch), and the answer shows on Daily attendance.
// The setting and the person made here are put back / switched off at the end.
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png` });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, login: string, password: string) {
  await page.getByLabel('Email, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('uniform question at check-in: Cancel stops the punch, "No" is saved and shown on Daily', async ({ browser, request }) => {
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const keys = ['photo', 'geofence_enabled', 'uniform_check', 'uniform_message'];
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'off', geofence_enabled: false } })).ok()).toBeTruthy();

  const stamp = Date.now().toString(36);
  const login = `e2e-uni-${stamp}`;
  const name = `E2E Uniform ${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  let personId = '';
  try {
    // HR turns it on from the settings screen.
    const ownerCtx = await browser.newContext();
    const hr = await ownerCtx.newPage();
    await hr.goto('/');
    await signIn(hr, OWNER.login, OWNER.password);
    await hr.goto('/attendance/settings');
    const card = hr.getByRole('form', { name: 'Uniform at punch-in' });
    await expect(card.getByText('Reminder only shows the message before check-in.', { exact: false })).toBeVisible();
    await card.getByText('Ask and record', { exact: true }).click();
    await expect(card.getByRole('radio', { name: 'Ask and record' })).toBeChecked();
    await card.getByLabel('Message').fill('Are you wearing the company jersey today?');
    await card.getByRole('button', { name: 'Save uniform check' }).click();
    await expect(card.getByRole('status')).toHaveText('Saved');
    await card.scrollIntoViewIfNeeded();
    await shot(hr, 'web-uniform-settings');
    const saved = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
    expect(saved.uniform_check.value).toBe('ask');

    // A new employee.
    const created = await request.post('/api/platform/people', {
      headers: auth(owner),
      data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
    });
    expect(created.status()).toBe(201);
    personId = (await created.json()).person.id as string;
    const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; level: number; system: boolean; grants: Array<{ app: string }> }>;
    const member = roles.find((r) => (r as { code?: string }).code === 'ff_member')!; // the built-in Member (PLAN.md §19.28)
    expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
    const first = await token(request, login, temp);
    expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();

    // Desktop: the question comes before the punch; Cancel closes it and nothing is punched.
    const desk = await browser.newContext();
    const page = await desk.newPage();
    await page.goto('/');
    await signIn(page, login, password);
    await page.goto('/attendance');
    await page.getByRole('button', { name: 'Check in' }).click();
    let dialog = page.getByRole('dialog', { name: 'Company uniform' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Are you wearing the company jersey today?')).toBeVisible();
    await page.waitForTimeout(400); // the open animation, for the screenshot
    await shot(page, 'web-uniform-dialog-desktop');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Check in' })).toBeEnabled();
    await desk.close();

    // Phone (390 px): answer "No"; the check-in goes through with the answer.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const mp = await phone.newPage();
    await mp.goto('/');
    await signIn(mp, login, password);
    await mp.goto('/attendance');
    await mp.getByRole('button', { name: 'Check in' }).click();
    dialog = mp.getByRole('dialog', { name: 'Company uniform' });
    await expect(dialog.getByRole('button', { name: "Yes, I'm wearing it" })).toBeVisible();
    await mp.waitForTimeout(400);
    await shot(mp, 'web-uniform-dialog-phone');
    await dialog.getByRole('button', { name: 'No', exact: true }).click();
    await expect(mp.getByText('Checked in ✅')).toBeVisible();
    await expect(dialog).toBeHidden();
    await phone.close();

    const pt = await token(request, login, password);
    const today = await (await request.get('/tasks/api/attendance/today/', { headers: auth(pt) })).json();
    expect(today.attendance.uniform_ok).toBe(false);

    // HR sees it on Daily attendance.
    await hr.goto('/attendance/daily');
    await hr.getByLabel('Search staff').fill(login);
    await expect(hr.getByRole('columnheader', { name: 'Uniform' })).toBeVisible();
    const row = hr.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: 'No', exact: true })).toBeVisible();
    await shot(hr, 'web-uniform-daily');
    await ownerCtx.close();
  } finally {
    const restore = Object.fromEntries(keys.map((k) => [k, before[k]?.custom ? before[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    if (personId) {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    }
  }
});
