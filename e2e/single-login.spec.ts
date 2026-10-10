// Behaviour test (PLAN §6 rule 5): finds things by role/label/text, never by CSS, so a redesign
// keeps passing as long as the features still work.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

async function signIn(page: Page) {
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('one sign-in opens Tasks and Assets, switch between them, sign out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, '1-sign-in');

  await signIn(page);
  // Home (PLAN.md §19.14): no workspace chooser; the greeting, the attendance card, then Tasks / Assets / admin shortcuts.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Attendance & Shifts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open Tasks/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open Assets/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /People & access/ })).toBeVisible();
  await shot(page, '2-home');

  // One web app (Phase 6): one menu for the whole product; its group headers move between Tasks and Assets, no second sign-in.
  await page.getByRole('button', { name: /^Open Tasks/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 20_000 });
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByRole('link', { name: 'Assets', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Assets menu' })).toHaveCount(0); // collapsed until opened
  await shot(page, '3-tasks');

  await menu.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole('navigation', { name: 'Assets menu' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await shot(page, '4-assets');

  await menu.getByRole('link', { name: 'Tasks', exact: true }).first().click();
  await expect(page.getByRole('navigation', { name: 'Tasks menu' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('opening an app while signed out goes to sign-in, then back to that app', async ({ page }) => {
  await page.goto('/assets/employees');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe('/assets/employees');
  await signIn(page);
  await expect(page).toHaveURL(/\/assets\/employees$/);
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible({ timeout: 20_000 });
});

// PLAN.md §19.14: on a phone a person with Attendance lands on the Today page (marking attendance first); desktop lands on Home.
test('a phone lands on Attendance after sign-in, a desktop on Home; /?home=1 opens Home on a phone', async ({ browser, page }) => {
  await page.goto('/');
  await signIn(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await phone.newPage();
  await p.goto('/');
  await signIn(p);
  await expect(p).toHaveURL(/\/attendance$/);
  await expect(p.getByRole('navigation', { name: 'Quick menu' }).getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page');
  await p.getByRole('navigation', { name: 'Quick menu' }).getByRole('link', { name: 'Home' }).click();
  await expect(p).toHaveURL(/\/\?home=1$/);
  await expect(p.getByRole('region', { name: 'Attendance & Shifts' })).toBeVisible();
  await p.screenshot({ path: 'screenshots/2-phone-home.png', fullPage: true });
  await phone.close();
});

test('admins manage people', async ({ page }) => {
  await page.goto('/?choose');
  await signIn(page);
  await page.getByRole('button', { name: /People & access/ }).click();
  await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Demo Owner/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Roles of Demo Owner' })).toContainText('Super Admin');
  await expect(page.getByRole('cell', { name: 'Apps of Demo Owner' })).toContainText('Tasks');
  await shot(page, '5-people');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('dialog', { name: 'Add person' })).toBeVisible();
  await shot(page, '6-add-person');
});

// Phase 2: one schema per company. A second company signs in to the same address and sees only its own data.
test('a second company sees none of the first company\'s tasks or people', async ({ page, request }) => {
  const BETA = { code: 'E2EBETA', email: 'owner@e2ebeta.test', password: 'Beta@12345', name: 'E2E Beta Pvt Ltd' };
  const platformDir = path.resolve(__dirname, '../services/platform');
  const internal = { TASKS_INTERNAL_URL: 'http://127.0.0.1:8000/api/internal', ASSETS_INTERNAL_URL: 'http://127.0.0.1:3000/api/internal' };
  const list = execFileSync(process.execPath, ['dist/companies.js', 'list'], { cwd: platformDir, encoding: 'utf8' });
  if (!list.split('\n').some((l) => l.startsWith(BETA.code))) {
    execFileSync(process.execPath, ['dist/companies.js', 'create', '--name', BETA.name, '--code', BETA.code, '--owner-name', 'Beta Owner', '--owner-email', BETA.email, '--owner-password', BETA.password], {
      cwd: platformDir,
      env: { ...process.env, ...internal },
      stdio: 'ignore',
    });
  }

  // Through the API (same gateway): the first company writes a task; the second company gets Tasks.
  const api = async (login: string, password: string) => {
    const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: { 'x-requested-with': 'XMLHttpRequest' } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    return { token: body.accessToken as string, headers: { authorization: `Bearer ${body.accessToken}`, 'x-requested-with': 'XMLHttpRequest' } };
  };
  const secret = `E2E secret ${Date.now()}`;
  const owner = await api(OWNER.login, OWNER.password);
  const ownerTasksMe = await (await request.get('/tasks/api/auth/me', { headers: owner.headers })).json();
  const created = await request.post('/tasks/api/tasks/', {
    headers: owner.headers,
    data: { title: secret, assigned_to: ownerTasksMe.id, priority: 'low', effort_minutes: 15, due_at: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(created.status()).toBe(201);
  const beta = await api(BETA.email, BETA.password);
  const betaMe = await (await request.get('/api/platform/auth/me', { headers: beta.headers })).json();
  expect((await request.put(`/api/platform/people/${betaMe.person.id}/apps/tasks`, { headers: beta.headers, data: { appRole: 'super_admin' } })).ok()).toBeTruthy();

  // In the browser, as the second company.
  await page.goto('/?choose');
  await page.getByLabel('Email, username or employee ID').fill(BETA.email);
  await page.getByLabel('Password').fill(BETA.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /People & access/ }).click();
  await expect(page.getByText('Beta Owner').first()).toBeVisible();
  await expect(page.getByText('Demo Owner')).toHaveCount(0);

  await page.goto('/tasks/tasks');
  await expect(page.getByRole('navigation', { name: 'Tasks menu' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(secret)).toHaveCount(0);
  await shot(page, '5-second-company-tasks');
});

// Phase 3: one role builder for every app.
test('admins build a role and give it to someone; it reaches Tasks', async ({ page, request }) => {
  const stamp = Date.now().toString(36);
  const roleName = `E2E Floor Lead ${stamp}`;
  await page.goto('/?choose');
  await signIn(page);
  await page.getByRole('button', { name: /^Roles/ }).click();
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Super Admin.*Locked/ })).toBeVisible();

  await page.getByRole('button', { name: 'New role' }).click();
  const editor = page.getByRole('dialog', { name: 'New role' });
  await editor.getByLabel('Name').fill(roleName);
  await editor.getByRole('checkbox', { name: 'Tasks: See tasks' }).check();
  await editor.getByRole('radiogroup', { name: 'Scope for See tasks' }).getByRole('radio', { name: 'Department' }).click();
  await shot(page, '7-role-editor');
  await editor.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('row', { name: new RegExp(roleName) })).toBeVisible();

  // A new person (through the API), then the role through the People screen.
  const headers = { 'x-requested-with': 'XMLHttpRequest' };
  const owner = await (await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers })).json();
  const created = await request.post('/api/platform/people', {
    headers: { ...headers, authorization: `Bearer ${owner.accessToken}` },
    data: { fullName: `E2E Person ${stamp}`, email: `e2e-${stamp}@freefounders.test`, login: { username: `e2e-${stamp}`, password: 'E2e@123456' } },
  });
  expect(created.status()).toBe(201);

  await page.getByRole('navigation', { name: 'Admin menu' }).getByRole('link', { name: 'People & access' }).click();
  await page.getByLabel('Search people').fill(`E2E Person ${stamp}`);
  const row = page.getByRole('row', { name: new RegExp(`E2E Person ${stamp}`) });
  await row.getByRole('button', { name: 'Change roles' }).click();
  const dialog = page.getByRole('dialog', { name: `Roles of E2E Person ${stamp}` });
  await dialog.getByRole('checkbox', { name: new RegExp(roleName) }).check();
  await expect(dialog.getByText(/will be able to open: Tasks/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save roles' }).click();
  await expect(row.getByRole('cell', { name: /Roles of/ })).toContainText(roleName);
  await expect(row.getByRole('cell', { name: /Apps of/ })).toContainText('Tasks');
  await shot(page, '8-people-roles');

  // Their sign-in now opens Tasks with exactly the role's permission.
  const person = await (await request.post('/api/platform/auth/login', { data: { login: `e2e-${stamp}`, password: 'E2e@123456', client: 'mobile' }, headers })).json();
  const me = await (await request.get('/tasks/api/auth/me', { headers: { authorization: `Bearer ${person.accessToken}` } })).json();
  expect(me.capabilities).toEqual(['tasks.view_department']);

  // Leave the demo company as it was: archive this run's role and any left over from earlier runs.
  const auth = { ...headers, authorization: `Bearer ${owner.accessToken}` };
  const roles = (await (await request.get('/api/platform/roles', { headers: auth })).json()) as Array<{ id: string; name: string }>;
  for (const r of roles.filter((x) => x.name.startsWith('E2E Floor Lead '))) {
    expect((await request.delete(`/api/platform/roles/${r.id}`, { headers: auth })).ok()).toBeTruthy();
  }
});
