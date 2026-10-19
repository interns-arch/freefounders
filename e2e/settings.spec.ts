// Phase 4 behaviour tests (PLAN.md §16): the Settings Center in the portal, module switches followed by Tasks,
// branding, and the photo taken at check-in. Like single-login.spec.ts, they find things by role/label/text only.
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

async function signIn(page: Page, login = OWNER.login, password = OWNER.password) {
  await page.getByLabel('Email, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

test('admins brand the company and switch modules; Tasks follows', async ({ page, request }) => {
  const owner = await token(request);
  const before = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
  try {
    await page.goto('/?choose');
    await signIn(page);
    await page.getByRole('button', { name: /^Settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    await page.getByLabel('Short name (menus and titles)').fill('Demo Co');
    await page.getByLabel('Brand colour code').fill('#0f7b5f');
    await page.getByRole('button', { name: 'Save company' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');

    const leads = page.getByRole('switch', { name: 'Tasks: Leads & quotations' });
    if (!(await leads.isChecked())) await leads.click();
    await expect(leads).toBeChecked();
    await shot(page, '9-settings');

    // Tasks shows the company's name and the Leads menu.
    await page.goto('/tasks');
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByText('Demo Co')).toBeVisible();
    // Leads is not moved to the new app yet: its menu item opens the classic screen.
    await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: /^Leads/ })).toBeVisible();

    // Switched off: gone from the menu, and the API refuses it.
    await page.goto('/settings');
    // The switch follows the saved value, so click and wait for the server's answer.
    await page.getByRole('switch', { name: 'Tasks: Leads & quotations' }).click();
    await expect(page.getByRole('switch', { name: 'Tasks: Leads & quotations' })).not.toBeChecked();
    await page.goto('/tasks');
    const menu = page.getByRole('navigation', { name: 'Tasks menu' });
    await expect(menu.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: /^Leads/ })).toHaveCount(0);
    const res = await request.get('/tasks/api/leads/', { headers: auth(await token(request)) });
    expect(res.status()).toBe(404);
    await shot(page, '10-tasks-without-leads');
  } finally {
    // Leave the demo company as it was.
    await request.patch('/api/platform/company', { headers: auth(owner), data: { shortName: before.shortName, colour: before.colour } });
    const tasks = before.modules.find((m: { app: string }) => m.app === 'tasks');
    const leadsOn = tasks?.modules.find((m: { key: string }) => m.key === 'leads')?.on ?? true;
    await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { leads: leadsOn } } });
  }
});

test('a photo is taken at check-in and HR sees it', async ({ browser, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const login = `e2e-photo-${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';

  // HR rule: a photo at every punch.
  const hrBefore = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'required', geofence_enabled: false} })).ok()).toBeTruthy();

  // A new person with a Tasks role; they set their own password.
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Photo ${stamp}`, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; level: number; system: boolean; grants: Array<{ app: string }> }>;
  const member = roles.find((r) => (r as { code?: string }).code === 'ff_member')!; // the built-in Member (PLAN.md §19.28)
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();

  try {
    // Fake camera (see launch args) and a granted camera permission.
    const context = await browser.newContext({ permissions: ['camera'] });
    const page = await context.newPage();
    await page.goto('/');
    await signIn(page, login, password);
    // Tasks only: sign-in opens Home with the attendance card first (PLAN.md §19.14).
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
    await page.goto('/tasks/hr');
    await page.getByRole('button', { name: /Check in/ }).click();
    const camera = page.getByRole('dialog', { name: 'Check in' });
    await expect(camera).toBeVisible();
    await expect(page.getByText(/A photo is saved with your attendance/)).toBeVisible();
    await shot(page, '11-check-in-camera');
    await camera.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText('Checked in ✅')).toBeVisible();
    await context.close();

    // HR (the owner) sees the photo in Team today.
    const hr = await browser.newContext();
    const hrPage = await hr.newPage();
    await hrPage.goto('/');
    await signIn(hrPage);
    await expect(hrPage.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
    await hrPage.goto('/tasks/hr');
    await hrPage.getByRole('button', { name: 'Team' }).click();
    // The list draws 50 staff at a time (PLAN.md §19.18): find the new person by the unique part of their name.
    await hrPage.getByLabel('Search staff').fill(stamp);
    const thumb = hrPage.getByRole('button', { name: `E2E Photo ${stamp} check-in photo` });
    await expect(thumb).toBeVisible();
    await thumb.click();
    await expect(hrPage.getByRole('img', { name: `E2E Photo ${stamp} check-in photo` })).toBeVisible();
    await shot(hrPage, '12-team-photo');
    await hr.close();
  } finally {
    const restore = Object.fromEntries(['photo', 'geofence_enabled'].map((k) => [k, hrBefore[k].custom ? hrBefore[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
    await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});
