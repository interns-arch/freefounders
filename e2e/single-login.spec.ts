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
  await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tasks/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Assets/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /People & access/ })).toBeVisible();
  await shot(page, '2-choose-workspace');

  await page.getByRole('button', { name: /^Tasks/ }).click();
  await expect(page).toHaveURL(/\/tasks\/$/);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  const switcher = page.getByRole('navigation', { name: 'Switch app' });
  await expect(switcher.getByRole('link', { name: 'Assets' })).toBeVisible();
  await shot(page, '3-tasks');

  await switcher.getByRole('link', { name: 'Assets' }).click();
  await expect(page).toHaveURL(/\/assets\/$/);
  const assetsSwitch = page.getByRole('navigation', { name: 'Switch app' });
  await expect(assetsSwitch.getByRole('link', { name: 'Tasks' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await shot(page, '4-assets');

  await assetsSwitch.getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/localhost:8080\/(\?.*)?$/);
});

test('opening an app while signed out goes to sign-in, then back to that app', async ({ page }) => {
  await page.goto('/assets/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe('/assets/');
  await signIn(page);
  await expect(page).toHaveURL(/\/assets\/$/);
  await expect(page.getByRole('navigation', { name: 'Switch app' })).toBeVisible({ timeout: 20_000 });
});

test('admins manage people from the portal', async ({ page }) => {
  await page.goto('/?choose');
  await signIn(page);
  await page.getByRole('button', { name: /People & access/ }).click();
  await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Demo Owner/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Tasks access for Demo Owner' })).toBeChecked();
  await shot(page, '5-people');
  await page.getByRole('button', { name: '+ Add person' }).click();
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
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(secret)).toHaveCount(0);
  await shot(page, '5-second-company-tasks');
});
