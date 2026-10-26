// Visitors (PLAN.md §22): the owner switches the module on and adds the Guard role; a visitor signs in from the open QR
// link with no login; the guard sees them, checks them in and out; a vehicle goes in and out with a photo; the owner
// sees the guard's activity. Run against the live suite (`npm run dev`); reset DEMO afterwards
// (`npm --prefix services/platform run company -- reset --code DEMO --keep-owner`).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
// A real 32×24 JPEG (the browser shrinks it and the server re-encodes it, like a camera photo).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwB1FFFesecFFFFABRRRQAUUUUAf/9k=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, path: string, login = OWNER.login, password = OWNER.password) {
  await page.goto(path);
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('Visitors: module on, Guard role, QR sign-in without login, gate check-in / out, vehicle in / out, guard activity', async ({ browser, page, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const s = Date.now().toString(36);

  // 1. The owner switches Visitors on (Admin → Settings → Modules).
  await signIn(page, '/settings');
  const sw = page.getByRole('switch', { name: 'Tasks: Visitors' });
  await expect(sw).toBeVisible();
  if (!(await sw.isChecked())) await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(async () => (await request.get('/tasks/api/visitors/config/', { headers: auth(owner) })).status(), { timeout: 40_000 }).toBe(200);

  // 2. One click: the Guard role (Admin → Roles).
  type RoleRow = { id: string; name: string; grants: Array<{ permission: string }> };
  const listRoles = async () => (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as RoleRow[];
  await page.goto('/roles');
  await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible();
  if (!(await listRoles()).some((r) => r.name === 'Guard')) {
    await page.getByRole('button', { name: 'Add Guard role' }).click();
    await expect(page.getByText('Guard role added')).toBeVisible();
  }
  const guardRole = (await listRoles()).find((r) => r.name === 'Guard')!;
  expect(guardRole.grants.map((g) => g.permission).sort()).toEqual(['attendance.punch', 'attendance.self', 'notifications.view', 'visitors.gate']);

  // 3. A guard with a normal login (username).
  const login = `e2e-guard-${s}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Guard ${s}`, login: { username: login, password: temp } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const guardId = (await created.json()).person.id;
  expect((await request.put(`/api/platform/people/${guardId}/roles`, { headers: auth(owner), data: { roleIds: [guardRole.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();

  // 4. A visitor scans the QR: a new browser, no sign-in.
  const link = (await (await request.get('/tasks/api/visitors/link/', { headers: auth(owner) })).json()) as { path: string };
  expect(link.path).toMatch(/^\/v\/[a-z0-9_]+\/[A-Za-z0-9_-]+$/);
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto(link.path);
  await visitor.getByLabel('Your name').fill(`Ravi Visitor ${s}`);
  await visitor.getByLabel('Mobile number').fill('9876501234');
  await visitor.getByLabel('Company / coming from').fill('ABC Ltd');
  await visitor.getByLabel('Purpose of visit').selectOption('Meeting');
  await visitor.getByLabel('Whom have you come to meet?').fill('Accounts team');
  await visitor.getByRole('checkbox', { name: 'I agree' }).click();
  await visitor.getByRole('button', { name: 'Send to the guard' }).click();
  const code = (await visitor.getByTestId('visitor-code').textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  // A bad token is a clean "not valid" (page) and 404 (API).
  await visitor.goto(link.path.replace(/[^/]+$/, 'bad-token-0000000000'));
  await expect(visitor.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
  expect((await request.get(`/tasks/api${link.path.replace(/^\/v\//, '/visitors/public/').replace(/[^/]+$/, 'bad-token-0000000000')}/`)).status()).toBe(404);
  await visitorCtx.close();

  // 5. The guard sees them waiting at the gate, checks them in (photo), then out.
  const guardCtx = await browser.newContext();
  const gp = await guardCtx.newPage();
  await signIn(gp, '/visitors/today', login, password);
  await expect(gp.getByRole('heading', { name: 'Gate', exact: true })).toBeVisible();
  // A guard has no Tasks or Assets menu: Attendance and Visitors only.
  await expect(gp.getByRole('link', { name: 'Tasks', exact: true })).toHaveCount(0);
  const card = gp.locator('[data-testid^="visit-"]', { hasText: `Ravi Visitor ${s}` });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(code!)).toBeVisible();
  await card.getByRole('button', { name: 'Check in' }).click();
  const sheet = gp.getByRole('dialog', { name: `Check in Ravi Visitor ${s}` });
  await sheet.getByTestId('visitor-photo').setInputFiles(photo('visitor.jpg'));
  await expect(sheet.getByText('New photo ready.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Check in', exact: true }).click();
  const pass = gp.getByRole('dialog', { name: /^Visitor pass V\d+/ });
  await expect(pass).toBeVisible();
  await pass.getByRole('button', { name: 'Done' }).click();
  const inside = gp.locator('[data-testid^="visit-"]', { hasText: `Ravi Visitor ${s}` });
  await inside.getByRole('button', { name: 'Check out' }).click();
  await expect(gp.getByText(`Ravi Visitor ${s} checked out`)).toBeVisible();

  // 6. A vehicle in (photo required) and out.
  await gp.goto('/visitors/vehicles');
  await gp.getByRole('button', { name: 'Vehicle in' }).click();
  const vin = gp.getByRole('dialog', { name: 'Vehicle in' });
  const number = `MH12E${s.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, '0')}`;
  await vin.getByLabel('Vehicle number').fill(number);
  await vin.getByLabel('Type').selectOption('truck');
  await vin.getByTestId('vehicle-photo').setInputFiles(photo('plate.jpg'));
  await expect(vin.getByText('New photo ready.')).toBeVisible();
  await vin.getByLabel('Driver name').fill('Sunil');
  await vin.getByRole('button', { name: 'Vehicle in', exact: true }).click();
  await expect(vin).toBeHidden();
  const row = gp.getByRole('row', { name: new RegExp(number) });
  await row.getByRole('button', { name: 'Out' }).click();
  await gp.getByRole('dialog').getByRole('button', { name: 'Vehicle out' }).click();
  await expect(gp.getByText(new RegExp(`${number} out`))).toBeVisible();
  await guardCtx.close();

  // 7. The owner sees everything the guard did.
  await page.goto('/visitors/activity');
  await expect(page.getByRole('heading', { name: 'Guard activity' })).toBeVisible();
  await page.getByLabel('Guard').selectOption({ label: `E2E Guard ${s}` });
  for (const what of ['QR sign-in accepted', 'Visitor checked out', 'Vehicle in', 'Vehicle out'])
    await expect(page.getByRole('cell', { name: what, exact: true }).first()).toBeVisible();
  const log = (await (await request.get('/tasks/api/visitors/activity/', { headers: auth(owner), params: { page_size: 50 } })).json()) as { results: Array<{ action: string; actor: { name: string } | null }> };
  const mine = log.results.filter((r) => r.actor?.name === `E2E Guard ${s}`).map((r) => r.action);
  expect(mine).toEqual(expect.arrayContaining(['open_accept', 'visit_out', 'vehicle_in', 'vehicle_out']));
});
