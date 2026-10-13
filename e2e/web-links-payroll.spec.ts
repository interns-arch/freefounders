// Phase 6 parity tests (PLAN.md §18.2): Links and Payroll / My Salary in the new web app.
// These modules are off for the demo company by default: each test switches them on through the Platform's
// Settings Center API and restores the switches at the end. Found by role/label/text only; data is cleaned up.
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const MODULES = ['links', 'payroll'] as const;

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (new URL(page.url()).pathname !== path) await page.goto(path);
}

/** Switches the two modules on for the demo company (the Platform pushes the change to Tasks); returns the restore. */
async function modulesOn(request: APIRequestContext, owner: string) {
  const before = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
  const tasks = before.modules.find((m: { app: string }) => m.app === 'tasks');
  const was = Object.fromEntries(MODULES.map((k) => [k, tasks?.modules.find((m: { key: string }) => m.key === k)?.on ?? true]));
  const on = await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: Object.fromEntries(MODULES.map((k) => [k, true])) } });
  expect(on.ok(), await on.text()).toBeTruthy();
  return async () => {
    await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: was } });
  };
}

test('a link is added to a collection, opens in a new tab and can be starred', async ({ page, request }) => {
  const owner = await token(request);
  const restore = await modulesOn(request, owner);
  const stamp = Date.now().toString(36);
  const collName = `E2E Tools ${stamp}`;
  const coll = await (await request.post('/tasks/api/link-collections/', { headers: auth(owner), data: { name: collName } })).json();
  const title = `E2E Drive ${stamp}`;
  try {
    await signIn(page, '/tasks/links');
    await expect(page.getByRole('heading', { name: 'Links' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: 'Links' })).toHaveAttribute('href', '/tasks/links');
    await page.getByRole('button', { name: 'Add link' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add link' });
    await dialog.getByLabel('Title *').fill(title);
    await dialog.getByLabel('URL *').fill('https://drive.google.com/');
    await dialog.getByLabel('Description').fill('Shared files');
    await dialog.getByLabel('Collection *').selectOption({ label: collName });
    await dialog.getByLabel('Visible to').selectOption({ label: 'Everyone' });
    await dialog.getByRole('button', { name: 'Add link' }).click();
    await expect(dialog).toBeHidden();

    const link = page.getByRole('link', { name: title });
    await expect(link).toHaveAttribute('href', 'https://drive.google.com/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByText('Shared files')).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`^${collName} \\(1\\)`) })).toBeVisible();

    // Star it, then the Favourites filter keeps it.
    await page.getByRole('button', { name: `Favourite ${title}` }).click();
    await expect(page.getByRole('button', { name: `Unfavourite ${title}` })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Favourites', exact: true }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await shot(page, 'web-links');

    // Remove it from the screen (confirmed).
    await page.getByRole('button', { name: `Remove ${title}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  } finally {
    const left = (await (await request.get('/tasks/api/links/', { headers: auth(owner), params: { collection: coll.id } })).json()) as Array<{ id: number }>;
    for (const l of left) await request.delete(`/tasks/api/links/${l.id}/`, { headers: auth(owner) });
    await request.delete(`/tasks/api/link-collections/${coll.id}/`, { headers: auth(owner) });
    await restore();
  }
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test('Payroll and My Salary are Attendance tabs for the owner; a draft payroll runs and exports', async ({ page, request }) => {
  const owner = await token(request);
  const restore = await modulesOn(request, owner);
  const runYear = new Date().getFullYear() - 1;
  const runsBefore = new Set(((await (await request.get('/tasks/api/payroll-runs/', { headers: auth(owner) })).json()) as Array<{ id: number }>).map((r) => r.id));
  try {
    await signIn(page, '/attendance/payroll');
    await expect(page.getByRole('heading', { name: 'Leave & Attendance' })).toBeVisible();
    const sections = page.getByRole('navigation', { name: 'Attendance and leave sections' });
    await expect(sections.getByRole('button', { name: 'Payroll' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Attendance menu' }).getByRole('link', { name: 'Payroll' })).toHaveAttribute('href', '/attendance/payroll');
    const parts = page.getByRole('group', { name: 'Payroll sections' });
    await expect(page.getByRole('button', { name: 'Run payroll' })).toBeVisible();

    // A draft run for a month no run exists for yet (removed again at the end; drafts can be deleted).
    const runs = (await (await request.get('/tasks/api/payroll-runs/', { headers: auth(owner) })).json()) as Array<{ year: number; month: number }>;
    const free = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => !runs.some((r) => r.year === runYear && r.month === m));
    if (free) {
      const form = page.getByRole('form', { name: 'Run payroll' });
      await form.getByLabel('Month').selectOption({ index: free - 1 });
      await form.getByLabel('Year').selectOption(String(runYear));
      await form.getByRole('button', { name: 'Run payroll' }).click();
      await expect(page.getByRole('status')).toHaveText(new RegExp(`^Draft payroll created for ${MONTHS[free - 1]} ${runYear}\.`));
      const row = page.getByRole('row', { name: new RegExp(`^${MONTHS[free - 1]} ${runYear} `) });
      await expect(row.getByText('Draft')).toBeVisible();
      await expect(row.getByRole('button', { name: `Finalise ${MONTHS[free - 1]} ${runYear}` })).toBeVisible();
      await expect(page.getByRole('heading', { name: new RegExp(`^${MONTHS[free - 1]} ${runYear} — \\d+ payslip`) })).toBeVisible();
      const download = page.waitForEvent('download');
      await row.getByRole('button', { name: `Download CSV for ${MONTHS[free - 1]} ${runYear}` }).click();
      expect((await download).suggestedFilename()).toBe(`payroll-${runYear}-${String(free).padStart(2, '0')}.csv`);
    }

    await parts.getByRole('button', { name: 'Salaries' }).click();
    await expect(page.getByRole('heading', { name: 'Set a salary' })).toBeVisible();
    await expect(page.getByLabel('Monthly gross (₹) *')).toBeVisible();
    await parts.getByRole('button', { name: 'Advances' }).click();
    await expect(page.getByRole('heading', { name: 'Record an advance' })).toBeVisible();
    await shot(page, 'web-payroll');

    await sections.getByRole('button', { name: 'My Salary' }).click();
    await expect(page).toHaveURL(/\/attendance\/salary$/);
    await expect(page.getByRole('navigation', { name: 'Attendance menu' }).getByRole('link', { name: 'My salary' })).toHaveAttribute('aria-current', 'page');
    // Either a salary and payslips, or the empty states.
    await expect(page.getByText(/My monthly salary|Your salary hasn’t been set yet/)).toBeVisible();
    await expect(page.getByText(/No payslips yet|Net paid/).first()).toBeVisible();
    await shot(page, 'web-my-salary');

    // The old link still lands on the new tab.
    await page.goto('/tasks/hr?tab=salary');
    await expect(page).toHaveURL(/\/attendance\/salary$/);
  } finally {
    const runsAfter = (await (await request.get('/tasks/api/payroll-runs/', { headers: auth(owner) })).json()) as Array<{ id: number; status: string }>;
    for (const r of runsAfter) if (!runsBefore.has(r.id) && r.status === 'draft') await request.delete(`/tasks/api/payroll-runs/${r.id}/`, { headers: auth(owner) });
    await restore();
  }
});
