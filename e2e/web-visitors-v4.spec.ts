// Visitors V4 + V4.1 (PLAN.md §22.11): a visitor checks in from the QR (whom to meet picked from a dropdown of names +
// departments) and gets a 4-digit code; the guard types it and approves; the host says where to wait, the guard sees it
// and the visitor's phone shows it; the visitor checks out from the check-out QR on the same phone (another phone is
// refused) with no code: "Please wait", the guard approves from "Waiting to leave", the phone says "checked out".
// The owner works the gate here (the Owner role has every permission).
// Run against the live suite (`npm run dev`); reset DEMO afterwards
// (`npm --prefix services/platform run company -- reset --code DEMO --keep-owner`).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwB1FFFesecFFFFABRRRQAUUUUAf/9k=',
  'base64',
);

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('Visitors V4.1: check-in code, whom-to-meet dropdown, where to wait on the phone, check-out without a code', async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  const owner = await token(request);
  const s = Date.now().toString(36);

  // The module is on (switch it on like the V1 test when it is not).
  if ((await request.get('/tasks/api/visitors/config/', { headers: auth(owner) })).status() !== 200) {
    await signIn(page, '/settings');
    const sw = page.getByRole('switch', { name: 'Tasks: Visitors' });
    if (!(await sw.isChecked())) await sw.click();
    await expect.poll(async () => (await request.get('/tasks/api/visitors/config/', { headers: auth(owner) })).status(), { timeout: 40_000 }).toBe(200);
  } else {
    await signIn(page, '/visitors/today');
  }
  const me = (await (await request.get('/tasks/api/auth/me', { headers: auth(owner) })).json()) as { first_name: string; last_name: string };
  // V4.1: whom to meet is a company setting (off for a new company): on, optional.
  const put = await request.put('/tasks/api/visitors/settings/', { headers: auth(owner), data: { whom_to_meet: true, whom_required: false } });
  expect(put.ok(), await put.text()).toBeTruthy();
  const link = (await (await request.get('/tasks/api/visitors/link/', { headers: auth(owner) })).json()) as { path: string; checkout_path: string };
  expect(link.checkout_path).toMatch(/^\/v\/[a-z0-9_]+\/[A-Za-z0-9_-]+\/out$/);

  // 1. The visitor's phone: the check-in form, whom to meet from names + departments only.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(link.path);
  await expect(phone.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
  const name = `Priya V4 ${s}`;
  await phone.getByLabel('Your name').fill(name);
  await phone.getByLabel('Mobile number').fill('9876509876');
  await phone.getByLabel('Purpose of visit').selectOption('Meeting');
  // The dropdown: tap → the list opens ("Not sure" first, then people) → type to filter → pick.
  await phone.getByTestId('whom-to-meet').click();
  await expect(phone.getByRole('option', { name: 'Not sure' })).toBeVisible();
  await expect(phone.getByRole('listbox')).not.toContainText('@');
  await phone.getByPlaceholder('Type to filter names').fill(`${me.first_name} ${me.last_name}`.trim());
  const option = phone.getByRole('option', { name: new RegExp(me.first_name) }).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(phone.getByTestId('whom-to-meet')).toContainText(me.first_name);
  const selfie = phone.getByTestId('public-photo');
  if (await selfie.count()) await selfie.setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await phone.getByRole('checkbox', { name: 'I agree' }).click();
  await phone.getByRole('button', { name: 'Get my check-in code' }).click();
  const code = (await phone.getByTestId('visitor-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^\d{4}$/);

  // 2. The guard types the code, sees the visitor, approves (taking the photo if the company needs one).
  await page.goto('/visitors/today');
  await page.getByLabel('Visitor code').fill(code);
  const dlg = page.getByTestId('code-dialog');
  await expect(dlg).toContainText(name);
  const shot = dlg.getByTestId('code-photo');
  if (await shot.count()) {
    await shot.setInputFiles({ name: 'v.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(dlg.getByText('New photo ready.')).toBeVisible();
  }
  await dlg.getByRole('button', { name: 'Approve check-in' }).click();
  await expect(page.getByText(new RegExp(`${name} checked in`))).toBeVisible();
  await expect(phone.getByTestId('visitor-checked-in')).toBeVisible({ timeout: 20_000 });
  // A used code finds nothing.
  await page.getByLabel('Visitor code').fill(code);
  await expect(page.getByText('No visitor is waiting with this code.')).toBeVisible();

  // 3. The host (the owner here) says where to wait; the guard sees it and sends them there; the phone shows it.
  const visits = (await (await request.get('/tasks/api/visitors/visits/', { headers: auth(owner), params: { q: name } })).json()) as { results: Array<{ id: number }> };
  const id = visits.results[0].id;
  await page.goto(`/visitors/answer?visit=${id}`);
  await page.getByTestId('answer-place:Reception').click();
  await page.getByLabel('Note for the guard (optional)').fill('2 minutes');
  await page.getByRole('button', { name: 'Send to the guard' }).click();
  await expect(page.getByText('The guard has your answer')).toBeVisible();
  await page.goto('/visitors/today');
  const answer = page.getByTestId(`host-answer-${id}`);
  await expect(answer).toContainText('wait at Reception');
  await answer.getByRole('button', { name: 'Sent to Reception' }).click();
  await expect(answer).toContainText('Sent');
  await expect(phone.getByTestId('visitor-where')).toContainText('Please wait at Reception.', { timeout: 20_000 });

  // 4. Another phone cannot check them out.
  const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await otherCtx.newPage();
  await other.goto(link.checkout_path);
  await expect(other.getByTestId('checkout-other-device')).toBeVisible();
  await otherCtx.close();

  // 5. The same phone: feedback + Check out → "Please wait" (no code); the guard approves from "Waiting to leave".
  await phone.goto(link.checkout_path);
  await expect(phone.getByText('Please wait at Reception.')).toBeVisible();
  await phone.getByTestId('rating-5').click();
  await phone.getByLabel('Anything to tell us? (optional)').fill('Very smooth');
  await phone.getByRole('button', { name: 'Check out' }).click();
  await expect(phone.getByTestId('checkout-pending')).toContainText('Please wait — the guard will let you out');
  await expect(phone.getByTestId('checkout-code')).toHaveCount(0);
  await expect(page.getByText(/Waiting to leave \(\d+\)/)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`approve-checkout-${id}`).click();
  await expect(page.getByText(new RegExp(`${name} checked out`))).toBeVisible();
  await expect(phone.getByTestId('checkout-done')).toContainText('You are checked out. Thank you for visiting!', { timeout: 20_000 });

  await phoneCtx.close();

  // 6. The register keeps it all; the settings show both QR posters with their captions.
  const row = (await (await request.get(`/tasks/api/visitors/visits/${id}/`, { headers: auth(owner) })).json()) as Record<string, unknown>;
  expect(row).toMatchObject({ status: 'out', check_in_via: 'code', checkout_via: 'qr', host_answer: 'place', host_place: 'Reception', feedback_rating: 5 });
  await page.goto('/visitors/settings');
  await expect(page.getByTestId('qr-caption-in')).toHaveText('Visitors check-in');
  await expect(page.getByTestId('qr-caption-out')).toHaveText('Visitors check-out');
});
