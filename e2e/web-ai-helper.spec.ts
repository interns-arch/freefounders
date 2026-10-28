// "Ask Kaampilot" UI v2 (PLAN.md §24.3): the "Ask AI" button in the top header (app and website) opens a side panel from
// the right; Esc / close bring focus back to the button; while the helper is off the panel says "coming soon" and a
// question gets "The AI helper isn't set up yet."; on a phone the panel is full screen with Back at the top.
// The /ai/status and /ai/ask answers are stubbed, so this runs with or without an AI key. Run against `npm run dev`.
import { type Browser, expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function stubAi(page: Page, enabled: boolean) {
  await page.route('**/api/platform/ai/status', (r) => r.fulfill({ json: { enabled } }));
  await page.route('**/api/platform/ai/ask', (r) =>
    enabled
      ? r.fulfill({ json: { answer: 'To punch in:\n1. Open **Attendance**\n2. Tap Punch in\n\n- Allow location\n- Take a selfie' } })
      : r.fulfill({ status: 503, json: { message: "The AI helper isn't set up yet." } }),
  );
}

async function signIn(browser: Browser, phone = false) {
  const ctx = await browser.newContext(phone ? PHONE : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

test('app header: Ask AI opens the side panel beside the page, answers render as lists, Esc closes', async ({ browser }) => {
  const { ctx, page } = await signIn(browser);
  await stubAi(page, true);
  await page.goto('/tasks');
  const button = page.locator('header').getByRole('button', { name: 'Ask AI' });
  await expect(button).toBeVisible();
  await expect(button).toContainText('Ask AI');
  await button.click();
  const panel = page.getByRole('dialog', { name: 'Ask Kaampilot' });
  await expect(panel).toBeVisible();
  // Tasks suggestions, and the page moves aside from 1280 px (nothing covered).
  await expect(panel.getByRole('button', { name: 'How do I add a task?' })).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.height).toBeGreaterThan(850);
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe(`${Math.round(box.width)}px`);
  await expect(panel.getByLabel('Your question')).toBeFocused();

  await panel.getByLabel('Your question').fill('How do I punch in?');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('listitem').filter({ hasText: 'Open Attendance' }).first()).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'Attendance' })).toBeVisible();
  await expect(panel.locator('ol ol li')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Copy answer' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  // The chat is kept for the visit; New chat clears it.
  await button.click();
  await expect(panel.getByText('How do I punch in?')).toBeVisible();
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('Namaste! How can I help?')).toBeVisible();
  await panel.getByRole('button', { name: 'Close Ask Kaampilot' }).click();
  await expect(panel).toBeHidden();
  // No floating round button any more.
  await expect(page.locator('button.fixed.rounded-full')).toHaveCount(0);
  await ctx.close();
});

test('helper off: the panel says coming soon and a question gets "isn\'t set up yet"', async ({ browser }) => {
  const { ctx, page } = await signIn(browser);
  await stubAi(page, false);
  await page.goto('/attendance');
  await page.locator('header').getByRole('button', { name: 'Ask AI' }).click();
  const panel = page.getByRole('dialog', { name: 'Ask Kaampilot' });
  await expect(panel.getByTestId('ask-ai-coming-soon')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'How do I punch in?' })).toBeVisible();
  await panel.getByRole('button', { name: 'How do I punch in?' }).click();
  await expect(panel.getByRole('alert')).toHaveText("The AI helper isn't set up yet.");
  await expect(panel.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await ctx.close();
});

test('phone: icon-only button, full-screen panel with Back', async ({ browser }) => {
  const { ctx, page } = await signIn(browser, true);
  await stubAi(page, false);
  await page.goto('/attendance');
  const button = page.locator('header').getByRole('button', { name: 'Ask AI' });
  await expect(button).toBeVisible();
  await expect(button.getByText('Ask AI')).toBeHidden();
  await button.click();
  const panel = page.getByRole('dialog', { name: 'Ask Kaampilot' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(box.height).toBeGreaterThan(800);
  await panel.getByRole('button', { name: 'Close Ask Kaampilot' }).click();
  await expect(panel).toBeHidden();
  await ctx.close();
});

test('website top bar: Ask AI (icon-only on phones) opens the panel with website questions', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await stubAi(page, false);
  await page.goto('/');
  const button = page.locator('header').getByRole('button', { name: 'Ask AI' });
  await button.click();
  const panel = page.getByRole('dialog', { name: 'Ask Kaampilot' });
  await expect(panel.getByRole('button', { name: 'How does the free trial work?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await ctx.close();
});
