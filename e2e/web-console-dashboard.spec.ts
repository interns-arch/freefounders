// Kaampilot console dashboard + production log (PLAN.md §21.9). Needs `npm run dev` (dev staff account
// staff@freefounders.test / Demo@1234, OTP_DEV_ECHO=1, PLATFORM_LOG_URL wired to the Platform). A new company owner made
// here gets 403 from the console API and is sent Home by the screen; the staff account sees Overview, Companies (with a
// company's detail), Users, Billing and Logs.
import { expect, type Page, test } from '@playwright/test';

const stamp = Date.now().toString(36);
const EMAIL = `console-${stamp}@freefounders.test`;
const PASSWORD = `Console-Hill-${stamp}-42`;
const COMPANY = `Console Co ${stamp}`;
const H = { 'x-requested-with': 'XMLHttpRequest' };
let ownerToken = '';

async function signIn(page: Page, login: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login');
}

test.beforeAll(async ({ request }) => {
  const start = await request.post('/api/platform/signup/start', { headers: H, data: { identifier: EMAIL } });
  expect(start.status(), await start.text()).toBe(200);
  const { otpId, devCode: code } = await start.json();
  const verify = await request.post('/api/platform/signup/verify', { headers: H, data: { otpId, code } });
  const { signupToken } = await verify.json();
  const done = await request.post('/api/platform/signup/complete', {
    headers: H,
    data: { signupToken, fullName: 'Console Owner', password: PASSWORD, username: `console${stamp}`, company: { name: COMPANY, apps: ['tasks'], state: 'Karnataka' } },
    timeout: 90_000,
  });
  expect(done.status(), await done.text()).toBe(200);
  ownerToken = (await done.json()).accessToken;
});

test('a company owner gets 403 from the console API and never sees the console', async ({ page, request }) => {
  for (const path of ['overview', 'health', 'dashboard/companies', 'users', 'billing', 'logs']) {
    const res = await request.get(`/api/platform/console/${path}`, { headers: { ...H, authorization: `Bearer ${ownerToken}` } });
    expect(res.status(), path).toBe(403);
  }
  await signIn(page, EMAIL, PASSWORD);
  await page.goto('/console/logs');
  await expect(page).not.toHaveURL(/\/console/);
  await expect(page.getByRole('heading', { name: 'Kaampilot console' })).toHaveCount(0);
});

test('staff: overview with health, companies → company detail, users, billing, logs', async ({ page }) => {
  await signIn(page, 'staff@freefounders.test', 'Demo@1234');
  await page.goto('/console');
  await expect(page.getByRole('heading', { name: 'Kaampilot console', level: 1 })).toBeVisible();

  // Overview: totals, sign-ups chart, health of every service.
  await expect(page.getByRole('region', { name: 'Companies' }).getByText('All companies')).toBeVisible();
  await expect(page.getByRole('img', { name: /Sign-ups in the last 30 days/ })).toBeVisible();
  const health = page.getByRole('region', { name: 'Health' });
  await expect(health.getByLabel(/^Platform: Up/)).toBeVisible();
  await expect(health.getByLabel(/^Tasks: Up/)).toBeVisible();
  await expect(health.getByLabel(/^Assets: Up/)).toBeVisible();

  // Companies: search, open the new company, its people and subscription.
  await page.getByRole('tab', { name: 'Companies' }).click();
  await expect(page).toHaveURL(/\/console\/companies$/);
  await page.getByLabel('Search companies').fill(COMPANY);
  await expect(page.getByText('1 of')).toBeVisible();
  await page.getByRole('row', { name: new RegExp(COMPANY) }).first().click();
  await expect(page.getByRole('heading', { name: COMPANY, level: 1 })).toBeVisible();
  const people = page.getByRole('region', { name: /People/ });
  await expect(people.getByRole('row', { name: /Console Owner/ })).toContainText('owner');
  // The view is in the staff audit log on the same page.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Staff actions and views' }).getByText('Viewed company').first()).toBeVisible();

  // Users: emails are partly hidden; the detail lists the company.
  await page.goto('/console/users');
  await page.getByLabel('Search users').fill(`console-${stamp}`);
  const row = page.getByRole('row', { name: /Console Owner/ }).first();
  await expect(row).toContainText('co***@freefounders.test');
  await expect(row).not.toContainText(EMAIL);
  await row.click();
  await expect(page.getByRole('heading', { name: 'Console Owner', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Companies' })).toContainText(COMPANY);

  // Billing: the tables and their downloads.
  await page.goto('/console/billing');
  await expect(page.getByRole('region', { name: 'Revenue by month' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payments' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Subscriptions' }).getByRole('button', { name: /Download/ })).toBeVisible();

  // Logs: filters, auto-refresh, a detail drawer (a FakePay webhook or any entry), Download.
  await page.goto('/console/logs');
  await expect(page.getByRole('heading', { name: 'Production log' })).toBeVisible();
  await page.getByLabel('Time').selectOption('30d');
  await expect(page.getByText(/entries · kept 30 days/)).toBeVisible();
  const first = page.getByRole('region', { name: 'Production log' }).getByRole('row').nth(1);
  if (await first.isVisible().catch(() => false)) {
    await first.click();
    await expect(page.getByRole('dialog', { name: 'Log entry' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.getByLabel('Level').selectOption('error');
  await expect(page.getByRole('region', { name: 'Production log' }).getByRole('button', { name: /Download/ })).toBeVisible();
});

for (const width of [390, 320]) {
  test(`console fits a ${width} px phone (no sideways scroll)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 760 } });
    const page = await ctx.newPage();
    await signIn(page, 'staff@freefounders.test', 'Demo@1234');
    for (const path of ['/console', '/console/companies', '/console/users', '/console/billing', '/console/logs']) {
      await page.goto(path);
      await page.getByRole('heading', { name: 'Kaampilot console', level: 1 }).waitFor();
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} sideways scroll`).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  });
}
