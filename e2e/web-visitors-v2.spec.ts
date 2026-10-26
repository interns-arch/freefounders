// Visitors V2 (PLAN.md §22.9): the owner invites a visitor; the visitor opens their pass with no sign-in; the gate checks
// them in from "Expected today" and the pass shows Inside; a watchlisted number warns at the gate; a parcel is received,
// shown to the person it is for, and handed over. Run against the live suite (`npm run dev`); reset DEMO afterwards
// (`npm --prefix services/platform run company -- reset --code DEMO --keep-owner`).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwB1FFFesecFFFFABRRRQAUUUUAf/9k=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Email, mobile, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A fresh 10-digit mobile number per run (starts with 9). */
const mobile = (s: string, d: string) => `9${d}${(parseInt(s, 36) % 1e8).toString().padStart(8, '0')}`.slice(0, 10);

test('Visitors V2: invite → pass page without sign-in → gate check-in; watchlist warning; parcel in and handed over', async ({ browser, page, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const s = Date.now().toString(36);

  // 0. Visitors is on (Admin → Settings → Modules).
  await signIn(page, '/settings');
  const sw = page.getByRole('switch', { name: 'Tasks: Visitors' });
  await expect(sw).toBeVisible();
  if (!(await sw.isChecked())) await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(async () => (await request.get('/tasks/api/visitors/config/', { headers: auth(owner) })).status(), { timeout: 40_000 }).toBe(200);

  // 1. The owner invites a visitor (My visitors → Invite visitor).
  const name = `Priya Invite ${s}`;
  await page.goto('/visitors/my');
  await page.getByRole('button', { name: 'Invite visitor' }).click();
  const sheet = page.getByRole('dialog', { name: 'Invite a visitor' });
  await sheet.getByLabel('Visitor 1 name').fill(name);
  await sheet.getByLabel('Visitor 1 mobile').fill(mobile(s, '1'));
  await sheet.getByLabel('Purpose').selectOption('Meeting');
  await sheet.getByRole('button', { name: 'Invite', exact: true }).click();
  const invited = page.getByRole('dialog', { name: `${name} is invited` });
  await expect(invited).toBeVisible();
  await invited.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-testid^="expected-"]', { hasText: name })).toBeVisible();
  type V = { id: number; name: string; pass_no: string; pass_path: string; status: string };
  const upcoming = (await (await request.get('/tasks/api/visitors/visits/', { headers: auth(owner), params: { scope: 'upcoming' } })).json()) as { results: V[] };
  const v = upcoming.results.find((r) => r.name === name)!;
  expect(v.pass_path).toMatch(/^\/v\/[a-z0-9_]+\/p\/[A-Za-z0-9_-]+$/);

  // 2. The visitor opens the pass from WhatsApp: no sign-in, a QR and the pass number.
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto(v.pass_path);
  const passCard = visitor.getByTestId('visitor-pass');
  await expect(passCard.getByRole('heading', { name })).toBeVisible();
  await expect(passCard.getByTestId('pass-no')).toHaveText(v.pass_no);
  await expect(passCard.getByText('Expected', { exact: true })).toBeVisible();
  await visitor.goto(v.pass_path.replace(/[^/]+$/, 'bad-token-0000000000'));
  await expect(visitor.getByRole('heading', { name: 'This pass is not valid' })).toBeVisible();

  // 3. The gate: "Expected today" → Check in (photo) → the pass shows Inside.
  await page.goto('/visitors/today');
  const card = page.locator('[data-testid^="visit-"]', { hasText: name });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText('Expected', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Check in' }).click();
  const checkIn = page.getByRole('dialog', { name: `Check in ${name}` });
  await checkIn.getByTestId('visitor-photo').setInputFiles(photo('visitor.jpg'));
  await expect(checkIn.getByText('New photo ready.')).toBeVisible();
  await checkIn.getByRole('button', { name: 'Check in', exact: true }).click();
  const pass = page.getByRole('dialog', { name: `Visitor pass ${v.pass_no}` });
  await expect(pass).toBeVisible();
  await expect(pass.getByRole('button', { name: 'Print badge' })).toBeVisible();
  await pass.getByRole('button', { name: 'Done' }).click();
  await visitor.goto(v.pass_path);
  await expect(visitor.getByTestId('visitor-pass').getByText('Inside', { exact: true })).toBeVisible();
  await visitorCtx.close();

  // 4. Watchlist: the owner lists a number; at the gate it shows at once, and letting them in needs a confirmation.
  const listed = mobile(s, '2');
  await page.goto('/visitors/watchlist');
  await page.getByRole('button', { name: 'Add to watchlist' }).click();
  const add = page.getByRole('dialog', { name: 'Add to watchlist' });
  await add.getByLabel('Mobile number').fill(listed);
  await add.getByLabel('Why').fill(`E2E ${s}: misbehaved`);
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('cell', { name: `E2E ${s}: misbehaved` })).toBeVisible();
  await page.goto('/visitors/today');
  await page.getByRole('button', { name: 'Check in visitor' }).click();
  const walk = page.getByRole('dialog', { name: 'Check in visitor' });
  await walk.getByLabel('Mobile number').fill(listed);
  await expect(walk.getByTestId('watch-warning')).toContainText('misbehaved');
  await walk.getByLabel('Name').fill(`Listed ${s}`);
  await walk.getByRole('button', { name: 'Reception' }).click();
  await walk.getByTestId('visitor-photo').setInputFiles(photo('listed.jpg'));
  await expect(walk.getByText('New photo ready.')).toBeVisible();
  await walk.getByRole('button', { name: 'Check in', exact: true }).click();
  await page.getByRole('dialog', { name: 'Watchlist' }).getByRole('button', { name: 'Let them in' }).click();
  await expect(page.getByRole('dialog', { name: /^Visitor pass V\d+/ })).toBeVisible();
  await page.getByRole('dialog', { name: /^Visitor pass V\d+/ }).getByRole('button', { name: 'Done' }).click();
  const watch = (await (await request.get('/tasks/api/visitors/watchlist/', { headers: auth(owner) })).json()) as Array<{ id: number; mobile: string }>;
  const entry = watch.find((w) => w.mobile === listed)!;
  expect((await request.delete(`/tasks/api/visitors/watchlist/${entry.id}/`, { headers: auth(owner) })).ok()).toBeTruthy();

  // 5. A parcel for the owner: received at the gate, shown under My visitors, handed over.
  const me = (await (await request.get('/tasks/api/auth/me', { headers: auth(owner) })).json()) as { id: number };
  const courier = `E2E Courier ${s}`;
  const parcel = await request.post('/tasks/api/visitors/deliveries/', { headers: auth(owner), data: { courier, recipient: me.id, parcels: 2 } });
  expect(parcel.status(), await parcel.text()).toBe(201);
  await page.goto('/visitors/my');
  await expect(page.locator('[data-testid^="my-parcel-"]', { hasText: courier })).toBeVisible();
  await page.goto('/visitors/deliveries');
  const pc = page.locator('[data-testid^="parcel-"]', { hasText: courier });
  await expect(pc).toBeVisible();
  await pc.getByRole('button', { name: 'Hand over' }).click();
  const hand = page.getByRole('dialog', { name: 'Hand over the parcel' });
  await hand.getByLabel('Collected by').fill(`Colleague ${s}`);
  await hand.getByRole('button', { name: 'Handed over' }).click();
  await expect(page.getByText(`Handed to Colleague ${s}`)).toBeVisible();
  // The guard UI received one too (Receive parcel → Reception).
  await page.getByRole('button', { name: 'Receive parcel' }).click();
  const rec = page.getByRole('dialog', { name: 'Receive parcel' });
  await rec.getByRole('button', { name: 'Reception' }).click();
  await rec.getByLabel('Courier').fill(`${courier} B`);
  await rec.getByRole('button', { name: 'Received', exact: true }).click();
  await expect(page.locator('[data-testid^="parcel-"]', { hasText: `${courier} B` })).toBeVisible();

  // 6. Everything is in the guard activity.
  const log = (await (await request.get('/tasks/api/visitors/activity/', { headers: auth(owner), params: { page_size: 100 } })).json()) as { results: Array<{ action: string; summary: string }> };
  const actions = log.results.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(['invite', 'visit_in', 'watch_add', 'watch_alert', 'watch_remove', 'delivery_in', 'delivery_out']));
});
