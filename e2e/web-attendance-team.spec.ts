// Attendance for managers (PLAN.md §19.15): Live team, Daily attendance, the Attendance dashboard, Reports (XLSX + CSV) and
// Import attendance. Found by role/label/text only. The person made here is switched off at the end (their imported day
// stays with them, hidden with the inactive staff).
import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function ownerPage(browser: Browser, path: string) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(path);
  return { ctx, page };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The last day before today that is not a Sunday (the default week-off). */
function lastWorkingDay(): string {
  const d = new Date();
  do d.setDate(d.getDate() - 1);
  while (d.getDay() === 0);
  return iso(d);
}

test('Live team, Daily attendance and the Attendance dashboard', async ({ browser }) => {
  const { ctx, page } = await ownerPage(browser, '/attendance/team');
  // Live: tiles that filter, the list, the menu entry.
  await expect(page.getByRole('navigation', { name: 'Attendance and leave sections' }).getByRole('button', { name: 'Live team' })).toHaveAttribute('aria-current', 'page');
  const tiles = page.getByRole('group', { name: 'Filter by status' });
  for (const name of ['Present', 'Late', 'Not checked in', 'On leave', 'Off / holiday', 'Checked out']) await expect(tiles.getByRole('button', { name })).toBeVisible();
  await expect(page.getByText(/^Live · /)).toBeVisible();
  await expect(page.getByRole('cell', { name: /Demo Owner/ }).first()).toBeVisible();
  await page.getByLabel('Search staff').fill('Demo Owner');
  await expect(page.getByText(/^Showing 1 of 1 staff/)).toBeVisible();
  const notIn = tiles.getByRole('button', { name: 'Not checked in' });
  await notIn.click();
  await expect(notIn).toHaveAttribute('aria-pressed', 'true');
  await notIn.click();
  await shot(page, 'att-live');

  // Daily: one day back.
  await page.goto('/attendance/daily');
  const date = page.getByLabel('Date', { exact: true });
  const today = await date.inputValue();
  await page.getByRole('button', { name: 'Previous day' }).click();
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  await expect(date).toHaveValue(iso(yesterday));
  await expect(page).toHaveURL(new RegExp(`date=${iso(yesterday)}`));
  await expect(page.getByRole('cell', { name: /Demo Owner/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next day' })).toBeEnabled();
  await shot(page, 'att-daily');

  // Dashboard: the month table; a person opens their calendar.
  await page.goto('/attendance/dashboard');
  await expect(page.getByRole('heading', { name: new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) })).toBeVisible();
  await page.getByLabel('Search staff').fill('Demo Owner');
  await expect(page.getByText(/^Showing 1 staff/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Present/ })).toBeVisible();
  await page.getByRole('button', { name: /Absent/ }).click(); // sort
  await shot(page, 'att-dashboard');
  await page.getByRole('row', { name: /Demo Owner/ }).click();
  await expect(page).toHaveURL(/\/attendance\/history\?user=\d+/);
  await expect(page.getByText('· Demo Owner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to attendance dashboard' }).click();
  await expect(page).toHaveURL(/\/attendance\/dashboard$/);
  await ctx.close();
});

test('Reports download as XLSX and CSV; recent downloads stay on this device', async ({ browser }) => {
  const { ctx, page } = await ownerPage(browser, '/attendance/reports');
  await page.getByLabel('Report type').selectOption('daily');
  const date = await page.getByLabel('Date', { exact: true }).inputValue();
  let wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  let file = await wait;
  expect(file.suggestedFilename()).toBe(`attendance-daily-${date}.xlsx`);
  let bytes = readFileSync(await file.path());
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a real XLSX (zip)

  await page.getByLabel('Report type').selectOption('monthly_register');
  await page.getByRole('button', { name: 'CSV' }).click();
  const month = await page.getByLabel('Month').inputValue();
  wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  file = await wait;
  expect(file.suggestedFilename()).toBe(`attendance-register-${month}.csv`);
  bytes = readFileSync(await file.path());
  expect(bytes.toString('utf8')).toContain('Employee ID,Name,Department,01 ');
  await expect(page.getByText(`Downloaded attendance-register-${month}.csv`)).toBeVisible();

  const recent = page.getByRole('list', { name: 'Recent downloads' });
  await expect(recent.getByRole('listitem')).toHaveCount(2);
  wait = page.waitForEvent('download');
  await recent.getByRole('button', { name: /^Download again: Daily attendance/ }).first().click();
  expect((await wait).suggestedFilename()).toMatch(/^attendance-daily-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await shot(page, 'att-reports');
  await ctx.close();
});

test('Import attendance: preview with one bad row, import one, it shows on Daily', async ({ browser, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const login = `e2e-att-${stamp}`;
  const name = `E2E Import ${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: 'E2e@123456' } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; level: number; system: boolean; grants: Array<{ app: string }> }>;
  const member = roles.find((r) => (r as { code?: string }).code === 'ff_member')!; // the built-in Member (PLAN.md §19.28)
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const day = lastWorkingDay();
  try {
    const { ctx, page } = await ownerPage(browser, '/attendance/dashboard');
    await page.getByRole('button', { name: 'Import attendance' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import attendance' });
    await expect(dialog).toBeVisible();
    const csv = ['Employee ID,Date (YYYY-MM-DD),Check in (HH:MM),Check out (HH:MM),Status,Note', `${login},${day},09:05,18:40,,e2e`, `NOPE-${stamp},${day},09:00,18:00,,`].join('\n');
    await dialog.getByLabel('Attendance file (.xlsx or .csv)').setInputFiles({ name: 'attendance.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await dialog.getByRole('button', { name: 'Check file' }).click();
    await expect(dialog.getByText(/1\s*ready \(1 new, 0 updates\)/)).toBeVisible();
    await expect(dialog.getByText(/1\s*with errors/)).toBeVisible();
    await expect(dialog.getByText(`No employee with ID 'NOPE-${stamp}'.`)).toBeVisible();
    await shot(page, 'att-import-preview');
    await dialog.getByRole('button', { name: 'Import 1 row' }).click();
    await expect(dialog.getByText('Import finished')).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('Created 1 · Updated 0 · Skipped 1');
    await dialog.getByRole('button', { name: 'Done' }).click();

    await page.goto(`/attendance/daily?date=${day}`);
    await page.getByLabel('Search staff').fill(name);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Present');
    await expect(row).toContainText('09:05');
    await expect(row).toContainText('9h 35m');
    await ctx.close();
  } finally {
    await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
    await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});
