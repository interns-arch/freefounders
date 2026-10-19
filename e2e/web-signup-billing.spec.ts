// Self-serve sign-up, invites and billing with the fake gateway (PLAN.md §21): a stranger signs up a company, sees the
// Getting started checklist, invites a second person who joins with a new account, buys Suite monthly for 5 users
// through FakePay, gets a GST invoice, then a failed renewal (past due) and 8 more days (read-only: a create is refused
// with 402) and pays again. Needs `npm run dev` with BILLING_DEV_TOOLS=1 and OTP_DEV_ECHO=1 (both on in dev).
// Every company here is new (unique email), so nothing of the demo company changes.
import { type Browser, expect, type Page, test } from '@playwright/test';

const stamp = () => Date.now().toString(36);

/** The 6-digit code from the "Test mode: your code is …" note (OTP_DEV_ECHO=1). */
async function devCode(page: Page): Promise<string> {
  const note = page.getByRole('note').filter({ hasText: 'Test mode' });
  await expect(note).toBeVisible();
  const m = /(\d{6})/.exec((await note.textContent()) ?? '');
  expect(m, 'dev code shown').toBeTruthy();
  return m![1];
}

async function signUp(page: Page, email: string, name: string, password: string, company: string) {
  await page.goto('/signup');
  await page.getByLabel('Work email or mobile number').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your full name').fill(name);
  await page.getByLabel('Choose a password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Company name').fill(company);
  await page.getByLabel('Industry').selectOption('Retail');
  await page.getByLabel('State', { exact: true }).selectOption('Maharashtra');
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('home'), { timeout: 60_000 });
}

async function joinWithNewAccount(browser: Browser, url: string, email: string, name: string, password: string, company: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: `Join ${company} on FreeFounders` })).toBeVisible();
    await page.getByRole('button', { name: 'Create my account' }).click();
    await page.getByLabel('Email or mobile number').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Your full name').fill(name);
    await page.getByLabel('Choose a password').fill(password);
    await page.getByRole('button', { name: `Join ${company}` }).click();
    await page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('home'), { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]);
  } finally {
    await ctx.close();
  }
}

/** Plan, interval, users → FakePay → Pay → back on Billing. */
async function buySuite(page: Page) {
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await page.getByRole('radio', { name: /^Suite/ }).click();
  await page.locator('#checkout-seats').fill('5');
  await page.locator('#checkout-seats').blur();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.waitForURL(/\/billing\/pay\//);
  await expect(page.getByText('Test mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment successful' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to FreeFounders' }).click();
  await page.waitForURL(/\/billing$/);
  await expect(page.getByRole('region', { name: 'Current plan' }).getByText('Active', { exact: true })).toBeVisible();
}

test('sign-in page links to sign-up and forgot password', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email, mobile, username or employee ID')).toBeVisible();
  await page.getByRole('link', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { name: 'Start free' })).toBeVisible();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
});

test('sign up → checklist → invite + join → Suite via FakePay → GST invoice → past due → read-only (402) → pay again', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = stamp();
  const company = `E2E Signup Co ${s}`;
  const ownerName = `Owner ${s}`;
  const password = `Kite-River-${s}-77`;

  // 1. Sign up: Home opens with the Getting started checklist and the trial banner.
  await signUp(page, `e2e-owner-${s}@freefounders.test`, ownerName, password, company);
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(page.getByText(/\d+ of \d+ done/)).toBeVisible();
  await expect(page.getByText(/^Trial: /)).toBeVisible();

  // 2. Invite link (Admin → People & access), joined by a second, new account.
  await page.goto('/people');
  await page.getByRole('button', { name: 'Invite link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite people' });
  await dialog.getByRole('checkbox').first().click();
  await dialog.getByRole('button', { name: 'Create invite link' }).click();
  const url = await dialog.getByLabel('Invite link').inputValue();
  expect(url).toContain('/join/');
  await page.keyboard.press('Escape');
  await joinWithNewAccount(browser, url, `e2e-joiner-${s}@freefounders.test`, `Joiner ${s}`, `Lamp-Stone-${s}-42`, company);

  // 3. Buy Suite monthly, 5 users: active, and a GST invoice (company in the seller's state → CGST + SGST, else IGST).
  await buySuite(page);
  await page.getByRole('region', { name: 'Invoices' }).getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Tax invoice' })).toBeVisible();
  await expect(page.getByText(/CGST 9%|IGST 18%/).first()).toBeVisible();
  await expect(page.getByText(/^Rupees .* Only$/)).toBeVisible();

  // 4. A failed renewal: past due, banner for everyone.
  await page.goto('/billing');
  await page.getByRole('button', { name: 'Fail now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Payment failed' })).toBeVisible({ timeout: 15_000 });

  // 5. Eight more days: read-only. Creating is refused with 402, shown as a toast; the main create buttons are off.
  await page.getByRole('button', { name: '+7 days' }).click();
  await expect(page.getByText('Clock moved 7 days')).toBeVisible();
  await page.getByRole('button', { name: '+1 day' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Read-only: the subscription has ended' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/people');
  await expect(page.getByRole('button', { name: 'Add person' })).toBeDisabled();
  await page.getByRole('button', { name: 'Invite link' }).click();
  const d2 = page.getByRole('dialog', { name: 'Invite people' });
  await d2.getByRole('checkbox').first().click();
  await d2.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // 6. Pay again: active, banner gone.
  await buySuite(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Read-only' })).toHaveCount(0);
});
