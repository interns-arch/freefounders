// Account flows as a real person goes through them (PLAN.md §21, quality pass 2026-10-19): sign-up by mobile number
// with a wrong code, Back and the resend countdown; the same mobile again (password only → a 2nd company); sign-in
// with the mobile → choose a company → switch from the account menu → reload keeps it; forgot password (code checked
// on its own step, then signed in straight away; unknown email; a username); the email of an admin-made login;
// invite links that are switched off or used up; billing with FakePay (fail, cancel, yearly, seats, cancel/resume,
// GST details); the owner console; phone widths without sideways scroll.
// Needs `npm run dev` (OTP_DEV_ECHO=1, BILLING_DEV_TOOLS=1). Companies here are new (unique numbers / emails).
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

const stamp = Date.now().toString(36);
const PASSWORD = `Kite-River-${stamp}-77`;
const NEW_PASSWORD = `Moon-Lake-${stamp}-31`;
/** A fresh Indian mobile number per run (starts with 9; 10 digits). */
const mobile = `9${String(Date.now()).slice(-9)}`;
const H = { 'x-requested-with': 'XMLHttpRequest' };

async function devCode(page: Page): Promise<string> {
  const note = page.getByRole('note').filter({ hasText: 'Test mode' });
  await expect(note).toBeVisible();
  const m = /(\d{6})/.exec((await note.textContent()) ?? '');
  expect(m, 'dev code shown').toBeTruthy();
  return m![1];
}

/** Presses the button; if the "new code in N s" wait shows (a code went to this identifier < 30 s ago), waits and presses again. */
async function askCode(page: Page, button: string) {
  await page.getByRole('button', { name: button }).click();
  const wait = page.getByRole('status').filter({ hasText: /You can ask for a new code in \d+ s/ });
  const next = page.getByRole('heading', { name: 'Check your code' });
  await expect(wait.or(next).first()).toBeVisible();
  if (await wait.isVisible()) {
    await expect(wait).toHaveCount(0, { timeout: 40_000 });
    await page.getByRole('button', { name: button }).click();
  }
  await expect(next).toBeVisible();
}

async function companyStep(page: Page, name: string, apps: 'tasks' | 'both') {
  await page.getByLabel('Company name').fill(name);
  await page.getByLabel('Industry').selectOption('Retail');
  await page.getByLabel('State', { exact: true }).selectOption('Karnataka');
  if (apps === 'tasks') {
    const assets = page.getByRole('checkbox', { name: /Assets/ });
    if (await assets.isChecked()) await assets.click();
  }
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Setting up ${name}`) })).toBeVisible();
  await page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('home'), { timeout: 90_000 });
}

/** Signs in through the API in this browser context (the refresh cookie), then opens a page. */
async function apiToken(request: APIRequestContext, login: string, password: string, companyName?: string): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { headers: H, data: { login, password } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  if (body.chooseCompany) {
    const c = body.chooseCompany.find((x: { name: string }) => !companyName || x.name === companyName);
    const pick = await request.post('/api/platform/auth/login', { headers: H, data: { ticket: body.ticket, companyId: c.companyId } });
    return (await pick.json()).accessToken;
  }
  return body.accessToken;
}

async function noSideScroll(page: Page, what: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${what}: no sideways scroll`).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: 'serial' });

const companyA = `E2E Mobile Co ${stamp}`;
const companyB = `E2E Second Co ${stamp}`;

test('sign up with a mobile number: wrong code, Back keeps the code, resend countdown, Tasks only', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/signup');
  // Not a mobile or email: told what to type.
  await page.getByLabel('Work email or mobile number').fill('12345');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter a work email (name@company.com) or a 10-digit mobile number.')).toBeVisible();
  await page.getByLabel('Work email or mobile number').fill(`+91 ${mobile}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your code' })).toBeVisible();
  await expect(page.getByText(/by SMS/)).toBeVisible();
  await expect(page.getByText(/You can ask for a new code in \d+ s/)).toBeVisible();
  const code = await devCode(page);
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong code. 4 tries left.' })).toBeVisible();
  // Back and Continue with the same number: the same code still works (no new code, no "wait").
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your code' })).toBeVisible();
  expect(await devCode(page)).toBe(code);
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your full name').fill(`Mona ${stamp}`);
  // A username is suggested from the name (PLAN.md §21.5) and checked live.
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(`mona.${stamp}`);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByLabel('Choose a password').fill('123456');
  await expect(page.getByText(/easy to guess|common|weak/i).first()).toBeVisible();
  await page.getByLabel('Choose a password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await companyStep(page, companyA, 'tasks');
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  // Tasks only: no Assets in the menu.
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Assets', exact: true })).toHaveCount(0);
});

test('the same mobile again: password only (a wrong one sends you back), then a 2nd company', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/signup');
  await page.getByLabel('Work email or mobile number').fill(`0${mobile}`);
  await askCode(page, 'Continue');
  await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Your full name')).toHaveCount(0);
  await page.getByLabel('Password', { exact: true }).fill('not-my-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Company name').fill(companyB);
  await page.getByLabel('Industry').selectOption('Retail');
  await page.getByLabel('State', { exact: true }).selectOption('Maharashtra');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'password is not right' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back and try again' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('home'), { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
});

test('username: "already taken" for an existing one, Continue waits; sign up with a free one, then sign in with it', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const email = `ria-${stamp}@e2e.test`;
  const mine = `Ria_${stamp}`;
  await page.goto('/signup');
  await page.getByLabel('Work email or mobile number').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your full name').fill(`Ria ${stamp}`);
  const field = page.getByLabel('Username', { exact: true });
  await expect(field).toHaveValue(`ria.${stamp}`);
  // Mona's username (first test) is taken, in any case; reserved and malformed names are told too.
  await field.fill(`MONA.${stamp}`);
  await expect(page.getByText('This username is already taken. Try another.')).toBeVisible();
  const go = page.getByRole('button', { name: 'Continue' });
  await expect(go).toBeDisabled();
  await field.fill('admin');
  await expect(page.getByText('This username is reserved.')).toBeVisible();
  await field.fill('12');
  await expect(page.getByText('Use 3–30 letters, numbers, dots, - or _, starting with a letter.')).toBeVisible();
  await expect(go).toBeDisabled();
  await field.fill(mine);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByLabel('Choose a password').fill(PASSWORD);
  await go.click();
  // Company names are unique (PLAN.md §21.6): Mona's company, in another case and spacing, is refused while typing.
  const companyName = page.getByLabel('Company name');
  const variant = `  ${companyA.toUpperCase().replace(/ /g, '   ')} `;
  await companyName.fill(variant);
  await expect(page.getByText(`A company called "${companyA.toUpperCase()}" already exists. If you work there, ask its owner for an invite link.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create company' })).toBeDisabled();
  await companyName.fill('x');
  await expect(page.getByText('Use 2–80 characters for the company name.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create company' })).toBeDisabled();
  await companyName.fill(`E2E Username Co ${stamp}`);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await companyStep(page, `E2E Username Co ${stamp}`, 'tasks');

  // Another browser: a wrong password keeps the general message plus the hint; the username (any case) signs in.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  try {
    await p2.goto('/login');
    await p2.getByLabel('Email, mobile, username or employee ID').fill(mine.toLowerCase());
    await p2.getByLabel('Password', { exact: true }).fill('wrong-password');
    await p2.getByRole('button', { name: 'Sign in' }).click();
    const alert = p2.getByRole('alert').filter({ hasText: 'The email, mobile number, username or password is not right.' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Signed up yourself? Use the email, mobile number or username you chose.');
    await p2.getByLabel('Email, mobile, username or employee ID').fill(mine.toUpperCase());
    await p2.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await p2.waitForURL((u) => u.pathname === '/' || u.pathname.startsWith('/attendance'));
    // The account page shows it and can change it.
    await p2.goto('/account');
    await expect(p2.getByText(`You sign in with ${mine.toLowerCase()}`)).toBeVisible();
    await p2.getByLabel('New username', { exact: true }).fill(`mona.${stamp}`);
    await expect(p2.getByText('This username is already taken. Try another.')).toBeVisible();
    await expect(p2.getByRole('button', { name: 'Change username' })).toBeDisabled();
  } finally {
    await ctx.close();
  }
});

test('sign in with the mobile: choose a company, switch from the account menu and back; a reload keeps it; sign out', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByLabel('Email, mobile, username or employee ID').fill(mobile);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The email, mobile number, username or password is not right.' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(companyA) }).click();
  await page.waitForURL((u) => u.pathname !== '/login');

  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: new RegExp(companyB) }).click();
  await page.waitForURL((u) => u.searchParams.has('home'));
  await page.reload();
  await page.getByRole('button', { name: 'Your account' }).click();
  await expect(page.getByRole('menuitem', { name: new RegExp(companyB) })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('menuitem', { name: new RegExp(companyA) }).click();
  await page.waitForURL((u) => u.searchParams.has('home'));
  await page.getByRole('button', { name: 'Your account' }).click();
  await expect(page.getByRole('menuitem', { name: new RegExp(companyA) })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/);
});

test('forgot password: the code is checked on its own step, then you are signed in with the new password', async ({ page }) => {
  await page.goto('/forgot');
  // A username: told to ask the admin.
  await page.getByLabel('Email or mobile number').fill('ravi.kumar');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(/reset by your company admin/)).toBeVisible();
  await page.getByLabel('Email or mobile number').fill(mobile);
  await askCode(page, 'Send code');
  await expect(page.getByText(/You can ask for a new code in \d+ s/)).toBeVisible();
  const code = await devCode(page);
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong code. 4 tries left.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your code' })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  // Two companies: the choice, then Home.
  await expect(page.getByText('Password changed.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: new RegExp(companyB) }).click();
  await page.waitForURL((u) => u.pathname === '/' || u.pathname.startsWith('/attendance'));
  await expect(page.getByRole('button', { name: 'Your account' })).toBeVisible();
});

test('forgot password: an unknown email looks the same until the code, then says there is no account; resend wait is shown live', async ({ page }) => {
  const email = `nobody-${stamp}@kaampilot.test`;
  // A sign-up code was just sent to this email: forgot right after must wait, with a live countdown.
  await page.request.post('/api/platform/signup/start', { headers: H, data: { identifier: email } });
  await page.goto('/forgot');
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  const wait = page.getByRole('status').filter({ hasText: /You can ask for a new code in \d+ s/ });
  await expect(wait).toBeVisible();
  const first = Number(/in (\d+) s/.exec((await wait.textContent()) ?? '')![1]);
  await expect.poll(async () => Number(/in (\d+) s/.exec((await wait.textContent()) ?? '0')?.[1] ?? 0), { timeout: 5000 }).toBeLessThan(first);
  await expect.poll(async () => (await wait.count()) === 0, { timeout: 40_000 }).toBe(true);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'There is no Kaampilot account with this email or mobile number.' })).toBeVisible();
});

test('the email of an admin-made login: sign-up says to sign in; forgot says to ask the admin', async ({ page, request }) => {
  const token = await apiToken(request, 'owner', 'Demo@1234');
  const me = await (await request.get('/api/platform/auth/me', { headers: { ...H, authorization: `Bearer ${token}` } })).json();
  const email: string = me.person.email;
  test.skip(!email, 'the demo owner has no email');
  await page.goto('/signup');
  await page.getByLabel('Work email or mobile number').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code', { exact: true }).fill(await devCode(page));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already signs in to a company here' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page).toHaveURL(/\/login/);
  // owner / Demo@1234 still signs in.
  await page.getByLabel('Email, mobile, username or employee ID').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('Demo@1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
});

test('invite links: switched off and used up say so; an existing account joins with its password', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const token = await apiToken(request, mobile, NEW_PASSWORD, companyA);
  const auth = { ...H, authorization: `Bearer ${token}` };
  const mk = async (maxUses: number | null) => (await request.post('/api/platform/invites', { headers: auth, data: { apps: ['tasks'], expiresInDays: 7, maxUses } })).json();
  const off = await mk(null);
  await request.delete(`/api/platform/invites/${off.id}`, { headers: auth });
  const once = await mk(1);

  const open = async (b: Browser, url: string) => {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    await page.goto(new URL(url).pathname);
    return { ctx, page };
  };
  const a = await open(browser, off.url);
  await expect(a.page.getByRole('heading', { name: 'This invite link was switched off' })).toBeVisible();
  await expect(a.page.getByText('Ask the person who sent it for a new link.')).toBeVisible();
  await a.ctx.close();

  // An existing account (the e2e owner of another run is not needed: a fresh account joins, then the link is used up).
  const j = await open(browser, once.url);
  await j.page.getByRole('button', { name: 'Create my account' }).click();
  await j.page.getByLabel('Email or mobile number').fill(`joiner-${stamp}@kaampilot.test`);
  await j.page.getByRole('button', { name: 'Continue' }).click();
  await j.page.getByLabel('Code', { exact: true }).fill(await devCode(j.page));
  await j.page.getByRole('button', { name: 'Continue' }).click();
  await j.page.getByLabel('Your full name').fill(`Jai ${stamp}`);
  await j.page.getByLabel('Choose a password').fill(PASSWORD);
  await j.page.getByRole('button', { name: `Join ${companyA}` }).click();
  await j.page.waitForURL((u) => u.pathname === '/' && u.searchParams.has('home'), { timeout: 30_000 });
  await j.ctx.close();

  const u = await open(browser, once.url);
  await expect(u.page.getByRole('heading', { name: 'This invite link is used up' })).toBeVisible();
  await u.ctx.close();
});

test('billing: FakePay failure and cancel change nothing; Suite yearly; more users (pro rata); cancel at period end → resume; GST details', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('Email, mobile, username or employee ID').fill(mobile);
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: new RegExp(companyA) }).click();
  await page.waitForURL((u) => u.pathname !== '/login');

  // GST details: a GSTIN of another state is refused, then Karnataka with its GSTIN.
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  const gst = page.getByRole('region', { name: 'GST details' });
  await expect(gst.getByLabel('State', { exact: true })).toHaveValue('Karnataka');
  await gst.getByLabel('GSTIN (optional)').fill('27AAPFU0939F1ZV');
  await gst.getByRole('button', { name: 'Save GST details' }).click();
  await expect(gst.getByText('The first two digits must be the code of the chosen state.')).toBeVisible();
  await gst.getByLabel('GSTIN (optional)').fill('29AAPFU0939F1ZV');
  await gst.getByRole('button', { name: 'Save GST details' }).click();
  await expect(page.getByText('GST details saved')).toBeVisible();

  const checkout = async (interval: 'Monthly' | 'Yearly', outcome: 'Pay' | 'Fail' | 'Cancel') => {
    await page.goto('/billing');
    await page.getByRole('radio', { name: interval }).click();
    await page.getByRole('radio', { name: /^Suite/ }).click();
    await page.locator('#checkout-seats').fill('5');
    await page.locator('#checkout-seats').blur();
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/\/billing\/pay\//);
    // Seller in Maharashtra, buyer in Karnataka: IGST.
    await expect(page.getByText(/IGST/).first()).toBeVisible();
    if (outcome === 'Pay') await page.getByRole('button', { name: /^Pay ₹/ }).click();
    else await page.getByRole('button', { name: outcome === 'Fail' ? 'Simulate failure' : 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: outcome === 'Pay' ? 'Payment successful' : outcome === 'Fail' ? 'Payment failed' : 'Payment cancelled' })).toBeVisible();
    await page.getByRole('link', { name: /Back to/ }).click();
    await page.waitForURL(/\/billing/);
  };
  await checkout('Monthly', 'Fail');
  await expect(page.getByRole('region', { name: 'Current plan' }).getByText(/Trial/).first()).toBeVisible();
  await checkout('Monthly', 'Cancel');
  await checkout('Yearly', 'Pay');
  const plan = page.getByRole('region', { name: 'Current plan' });
  await expect(plan.getByText('Active', { exact: true })).toBeVisible();
  await expect(plan.getByText('Yearly')).toBeVisible();

  // More users now: pro rata on the next invoice.
  await page.locator('#current-seats').fill('7');
  await plan.getByRole('button', { name: 'Change users' }).click();
  await expect(page.getByText('Users added: the extra days are on the next invoice')).toBeVisible();

  // Cancel at the end of the period, then resume.
  await plan.getByRole('button', { name: 'Cancel at period end' }).click();
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByText('Cancelled at the end of the period')).toBeVisible();
  await plan.getByRole('button', { name: 'Resume subscription' }).click();
  await expect(page.getByText('Subscription resumed')).toBeVisible();

  // The invoice opens and shows IGST.
  await page.getByRole('region', { name: 'Invoices' }).getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Tax invoice' })).toBeVisible();
  await expect(page.getByText(/IGST 18%/).first()).toBeVisible();
});

test('owner console (staff): totals, extend a trial, suspend → the owner is sent to Billing → reactivate', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByLabel('Email, mobile, username or employee ID').fill('staff@kaampilot.test');
  await page.getByLabel('Password', { exact: true }).fill('Demo@1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname !== '/login');
  await page.goto('/console/companies');
  await expect(page.getByRole('heading', { name: 'Kaampilot console' })).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${companyB}` }).click();
  await page.getByRole('menuitem', { name: /trial by 7 days|Extend trial.*7/i }).first().click();
  await page.getByRole('button', { name: 'Extend trial' }).click();
  // The console's state filter has a hidden "Trial" option, so wait for the confirmation instead of any "trial" text.
  await expect(page.getByText('Done', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${companyB}` }).click();
  await page.getByRole('menuitem', { name: /Suspend/ }).click();
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  // The companies table (the "Recent actions" log below it lists the same company too).
  const companiesTable = page.getByRole('table').first();
  await expect(companiesTable.getByRole('row', { name: new RegExp(companyB) }).getByText(/Suspended/i)).toBeVisible();

  // The owner of the suspended company lands on Billing.
  const token = await apiToken(request, mobile, NEW_PASSWORD, companyB);
  const me = await (await request.get('/api/platform/auth/me', { headers: { ...H, authorization: `Bearer ${token}` } })).json();
  expect(me.billing.state).toBe('suspended');

  await page.getByRole('button', { name: `Actions for ${companyB}` }).click();
  await page.getByRole('menuitem', { name: /Reactivate/ }).click();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await expect(companiesTable.getByRole('row', { name: new RegExp(companyB) }).getByText(/Suspended/i)).toHaveCount(0);

  // Every action is in "Recent actions" (PLAN.md §21.7), newest first; filters by company and action.
  const log = page.getByRole('region', { name: 'Recent actions' });
  const companyValue = await log.getByLabel('Company').locator('option', { hasText: companyB }).first().getAttribute('value');
  await log.getByLabel('Company').selectOption(companyValue!);
  const rows = log.getByRole('row');
  await expect(rows.nth(1)).toContainText('Reactivated');
  await expect(rows.nth(2)).toContainText('Suspended');
  await expect(rows.nth(3)).toContainText('Extended trial');
  await expect(rows.nth(1)).toContainText('staff@kaampilot.test');
  await log.getByLabel('Action').selectOption({ label: 'Suspended' });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(/suspended/);
  // Not for anyone else: the owner of a company gets 403.
  const ownerToken = await apiToken(request, mobile, NEW_PASSWORD, companyB);
  expect((await request.get('/api/platform/console/audit', { headers: { ...H, authorization: `Bearer ${ownerToken}` } })).status()).toBe(403);
});

test('policy pages (PLAN.md §21.11): linked under the sign-in form, open signed out, each links to the others', async ({ page }) => {
  await page.context().clearCookies();
  for (const [link, heading] of [
    ['Contact us', 'Contact us'],
    ['Terms & Conditions', 'Terms & Conditions'],
    ['Privacy Policy', 'Privacy Policy'],
    ['Refund & Cancellation', 'Refund & Cancellation Policy'],
  ]) {
    await page.goto('/login');
    await page.getByRole('navigation', { name: 'Policies' }).getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText('operated by CarTrends').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Policies' }).getByRole('link')).toHaveCount(4);
  }
  await expect(page.getByRole('link', { name: 'support@kaampilot.com' }).first()).toHaveAttribute('href', 'mailto:support@kaampilot.com');
});

for (const width of [390, 320]) {
  test(`account pages fit a ${width} px phone (no sideways scroll)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 760 } });
    const page = await ctx.newPage();
    for (const path of ['/login', '/signup', '/forgot', '/join/not-a-real-invite-token-xxxxxxxxxx', '/contact', '/terms', '/privacy', '/refunds']) {
      await page.goto(path);
      await page.locator('h1').first().waitFor();
      await page.waitForTimeout(300);
      await noSideScroll(page, path);
    }
    await page.goto('/forgot');
    await page.getByLabel('Email or mobile number').fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Check your code' }).or(page.getByRole('status'))).toBeVisible();
    await noSideScroll(page, '/forgot code step');
    // Signed in: Billing and the console list.
    await page.goto('/login');
    await page.getByLabel('Email, mobile, username or employee ID').fill(mobile);
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: new RegExp(companyA) }).click();
    await page.waitForURL((u) => u.pathname !== '/login');
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
    await page.getByRole('region', { name: 'Invoices' }).waitFor();
    await noSideScroll(page, '/billing');
    // The main action is above the phone bottom bar when scrolled to.
    const pay = page.getByRole('button', { name: /Continue to payment|Switch to/ }).first();
    if (await pay.count()) {
      await pay.scrollIntoViewIfNeeded();
      const box = await pay.boundingBox();
      const bar = await page.getByRole('navigation').last().boundingBox();
      if (box && bar && bar.y > 400) expect(box.y + box.height, 'button above the bottom bar').toBeLessThanOrEqual(bar.y + 1);
    }
    await ctx.close();
  });
}
