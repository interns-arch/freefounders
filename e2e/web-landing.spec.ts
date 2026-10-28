import { expect, test } from '@playwright/test';

// The public landing page (PLAN.md §24.2): `/` signed out on the web; Home stays at `/` once signed in.
const OWNER = { login: 'owner', password: 'Demo@1234' };

test('landing page renders for a signed-out visitor, with the feature tour and links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on autopilot');
  await expect(page).toHaveTitle(/Kaampilot/);
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: /Start free trial/ }).first()).toHaveAttribute('href', '/signup');
  // Feature tour: one tab per module.
  await page.getByRole('tab', { name: 'Visitors' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Guard login');
  for (const to of ['/contact', '/terms', '/privacy', '/refunds']) await expect(page.locator(`footer a[href="${to}"]`)).toBeVisible();
});

test('pricing calculator: modules, AI and Complete for 10 users', async ({ page }) => {
  await page.goto('/pricing');
  const total = page.getByTestId('pricing-total');
  const users = page.getByRole('spinbutton');
  await users.fill('10');
  // Starts with Tasks + Attendance.
  await expect(page.getByRole('checkbox', { name: /^Tasks/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /^Attendance/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /^Assets/ })).toHaveAttribute('aria-checked', 'false');
  await expect(total).toHaveText('₹1,980');
  await page.getByRole('switch', { name: 'Add AI' }).click();
  await expect(total).toHaveText('₹2,580');
  await page.getByRole('switch', { name: 'Add AI' }).click();
  await page.getByRole('checkbox', { name: /^Complete/ }).click();
  await expect(total).toHaveText('₹3,490');
});

test('Buy now (PLAN.md §24.4): the calculator carries the plan into sign-up, which ends with the plan and "Continue to payment"', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('spinbutton').fill('10');
  const buy = page.getByTestId('pricing-buy-now');
  await expect(buy).toHaveAttribute('href', '/signup?buy=modules&m=tasks,attendance&ai=0&users=10');
  await page.getByRole('switch', { name: 'Add AI' }).click();
  await page.getByRole('checkbox', { name: /^Complete/ }).click();
  await expect(buy).toHaveAttribute('href', '/signup?buy=complete&ai=1&users=10');
  // Nothing picked: no Buy now link.
  await page.getByRole('checkbox', { name: /^Complete/ }).click();
  await page.getByRole('checkbox', { name: /^Tasks/ }).click();
  await page.getByRole('checkbox', { name: /^Attendance/ }).click();
  await expect(page.getByTestId('pricing-buy-now')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buy now' })).toBeDisabled();
  // Sign-up knows it is a purchase from the first step.
  await page.goto('/signup?buy=complete&ai=0&users=10');
  await expect(page.getByRole('heading', { name: 'Buy Kaampilot' })).toBeVisible();
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Start free' })).toBeVisible();
});

test('signed in, `/` is still Home', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/?home=1');
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
  await expect(page.getByRole('heading', { name: /on autopilot/ })).toHaveCount(0);
});

test('inside the phone app, signed out `/` goes straight to sign-in (never the landing page)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.ReactNativeWebView = { postMessage: () => undefined };
    w.KaampilotApp = { version: '1.3.0', platform: 'android', capabilities: [] };
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await ctx.close();
});

test('landing v3: day story (sticky on desktop, click-through on phones), Team 360, comparison and security', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'From the first punch to the month-end payroll' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Every employee, one tile/ })).toBeVisible();
  await expect(page.getByRole('table', { name: /compared with a paper register/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your company’s data stays yours' })).toBeVisible();
  // Desktop: the step in the middle of the screen becomes the current one.
  await page.getByRole('heading', { name: 'A visitor at the gate, without the paper book' }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await expect(page.locator('li[aria-current="step"]')).toHaveCount(1);
  // Phones: Back / Next through the moments.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'From the first punch to the month-end payroll' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Punch in with a selfie, at the office' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'The manager sees the whole team, live' })).toBeVisible();
  await page.getByRole('button', { name: '18:30' }).click();
  await expect(page.getByRole('heading', { name: 'Every person, one tile' })).toBeVisible();
});
