// Sign in with a code instead of a password (PLAN.md §21.8): /login → "Sign in with a code instead" → the account's
// email → the code (test mode shows it on screen) → Home. A username gets "sign in with your password" guidance; a
// wrong code counts down. Needs `npm run dev` (OTP_DEV_ECHO=1). The account here is new (a unique email).
import { expect, type Page, test } from '@playwright/test';

const stamp = Date.now().toString(36);
const EMAIL = `code-${stamp}@kaampilot.test`;
const PASSWORD = `Code-Hill-${stamp}-42`;
const H = { 'x-requested-with': 'XMLHttpRequest' };

async function devCode(page: Page): Promise<string> {
  const note = page.getByRole('note').filter({ hasText: 'Test mode' });
  await expect(note).toBeVisible();
  const m = /(\d{6})/.exec((await note.textContent()) ?? '');
  expect(m, 'test-mode code shown').toBeTruthy();
  return m![1];
}

test.beforeAll(async ({ request }) => {
  // A new account with one company, made through the API (the sign-up screens have their own tests).
  const start = await request.post('/api/platform/signup/start', { headers: H, data: { identifier: EMAIL } });
  expect(start.status(), await start.text()).toBe(200);
  const { otpId, devCode: code } = await start.json();
  const verify = await request.post('/api/platform/signup/verify', { headers: H, data: { otpId, code } });
  expect(verify.status(), await verify.text()).toBe(200);
  const { signupToken } = await verify.json();
  const done = await request.post('/api/platform/signup/complete', {
    headers: H,
    data: { signupToken, fullName: 'Code Tester', password: PASSWORD, username: `code${stamp}`, company: { name: `Code Co ${stamp}`, apps: ['tasks'], state: 'Karnataka' } },
    timeout: 90_000,
  });
  expect(done.status(), await done.text()).toBe(200);
});

test('sign in with a code: username guidance, wrong code, then signed in; back to the password form', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with a code instead' }).click();
  await expect(page).toHaveURL(/code=1/);
  await expect(page.getByRole('heading', { name: 'Sign in with a code' })).toBeVisible();

  // A username has no email / mobile to send a code to.
  await page.getByLabel('Email or mobile number').fill('ravi.kumar');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(/With a username or employee ID, sign in with your password/)).toBeVisible();

  // Back to the password form and here again.
  await page.getByRole('link', { name: 'Use your password instead' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in with a code instead' }).click();

  // The sign-up code went to this email a moment ago: wait out the 30 s gap if it shows.
  await page.getByLabel('Email or mobile number').fill(EMAIL);
  await page.getByRole('button', { name: 'Send code' }).click();
  const wait = page.getByRole('status').filter({ hasText: /You can ask for a new code in \d+ s/ });
  const next = page.getByRole('heading', { name: 'Enter your code' });
  await expect(wait.or(next).first()).toBeVisible();
  if (await wait.isVisible()) {
    await expect(wait).toHaveCount(0, { timeout: 40_000 });
    await page.getByRole('button', { name: 'Send code' }).click();
  }
  await expect(next).toBeVisible();
  await expect(page.getByText(`We sent a 6-digit code to ${EMAIL}.`)).toBeVisible();
  await expect(page.getByText(/You can ask for a new code in \d+ s/)).toBeVisible();

  const code = await devCode(page);
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong code. 4 tries left.' })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Your account' })).toBeVisible();
});

test('codes by SMS not set up (email-only MSG91): sign-up, forgot and code sign-in say so on the field', async ({ page }) => {
  // Production with only the MSG91 email template answers 503 for a mobile number (PLAN.md §21.8); the dev suite
  // runs the fake sender, so the answer is stood in here.
  const SMS_OFF = "Codes by SMS aren't set up yet. Use your email address instead.";
  for (const path of ['signup/start', 'auth/forgot', 'auth/login/code/start']) {
    await page.route(`**/api/platform/${path}`, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: SMS_OFF }) }),
    );
  }
  const screens = [
    { url: '/signup', label: 'Work email or mobile number', button: 'Continue' },
    { url: '/forgot', label: 'Email or mobile number', button: 'Send code' },
    { url: '/login?code=1', label: 'Email or mobile number', button: 'Send code' },
  ];
  for (const s of screens) {
    await page.goto(s.url);
    const field = page.getByLabel(s.label);
    await field.fill('9876543210');
    await page.getByRole('button', { name: s.button }).click();
    await expect(page.getByRole('alert').filter({ hasText: SMS_OFF }), s.url).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: SMS_OFF }), `${s.url}: shown once`).toHaveCount(1);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    // Typing again clears it.
    await field.fill('someone@example.com');
    await expect(page.getByRole('alert').filter({ hasText: SMS_OFF })).toHaveCount(0);
  }
});
