// Phase 6 parity tests (PLAN.md §18.2) for the mistake register (with SOPs), moved out of the classic app.
// Found by role/label/text only; data is cleaned up. The module is switched off for a new company by default, so the
// suite switches it on and restores it after.
import { expect, request as playwrightRequest, type APIRequestContext, type Page, test } from '@playwright/test';

const BASE = process.env.FF_URL ?? 'http://localhost:8080';
const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

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
  if (new URL(page.url()).pathname + new URL(page.url()).search !== path) await page.goto(path);
}

type ModuleRow = { app: string; modules: Array<{ key: string; on: boolean }> };

// The demo company's switch as it was, restored at the end.
let before: { mistakes: boolean } = { mistakes: true };

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const owner = await token(api);
  const company = await (await api.get('/api/platform/company', { headers: auth(owner) })).json();
  const tasks = (company.modules as ModuleRow[]).find((m) => m.app === 'tasks');
  before = {
    mistakes: tasks?.modules.find((m) => m.key === 'mistakes')?.on ?? true,
  };
  const res = await api.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { mistakes: true } } });
  expect(res.ok(), await res.text()).toBeTruthy();
  await api.dispose();
});

test.afterAll(async () => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const owner = await token(api);
  await api.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: before } });
  await api.dispose();
});

test('a mistake is logged, shown in the register and explained by the employee', async ({ page, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const description = `E2E mistake ${stamp}: wrong part number typed on the invoice`;
  const cats = (await (await request.get('/tasks/api/mistake-categories/', { headers: auth(owner) })).json()) as Array<{ name: string }>;
  test.skip(cats.length === 0, 'needs at least one mistake category');
  let mistakeId: number | undefined;
  try {
    await signIn(page, '/tasks/mistakes');
    await expect(page.getByRole('heading', { name: 'Mistakes' })).toBeVisible();
    // The owner is an admin: the founder view and its filter are there.
    await expect(page.getByRole('button', { name: 'Action required', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Action required \(founder view\)/ })).toBeVisible();

    await page.getByRole('button', { name: 'Log mistake' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log a mistake' });
    await dialog.getByLabel('Category *').selectOption(cats[0].name);
    await dialog.getByLabel('Severity *').selectOption('high');
    await dialog.getByRole('textbox', { name: 'What happened? *' }).fill(description);
    await dialog.getByLabel('Impact').fill('Customer waited a day');
    await dialog.getByLabel('Financial loss (₹)').fill('1500');
    await dialog.getByRole('button', { name: 'Log mistake' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText(/M-\d+ logged/);

    const row = page.getByRole('listitem').filter({ hasText: description });
    await expect(row).toBeVisible();
    await expect(row.getByText('High', { exact: true })).toBeVisible();
    await expect(row.getByText('₹1,500 loss')).toBeVisible();
    await row.getByRole('button', { name: /^M-\d+ / }).click();
    const list = (await (await request.get('/tasks/api/mistakes/?page_size=100', { headers: auth(owner) })).json()) as { results: Array<{ id: number; description: string }> };
    mistakeId = list.results.find((m) => m.description === description)?.id;
    expect(mistakeId).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`open=${mistakeId}`));

    // Logged for myself: the employee's response is asked (the owner reviews via the API later).
    const response = page.getByRole('form', { name: 'Your response' });
    await expect(response).toBeVisible();
    await response.getByRole('textbox', { name: 'What happened? *' }).fill('I read the part code from the wrong line of the order.');
    await response.getByLabel('Root cause *').selectOption('lack_of_attention');
    await response.getByRole('button', { name: 'Submit response' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your response is saved' })).toBeVisible();
    await expect(row.getByText('Explained', { exact: true })).toBeVisible();
    await expect(row.getByText(/Root cause: Lack of attention/)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Update your response' })).toBeVisible();
    await shot(page, 'web-mistakes-register');
  } finally {
    // Mistakes cannot be deleted: resolve it, and remove the corrective task it created.
    if (mistakeId) {
      const m = await (await request.get(`/tasks/api/mistakes/${mistakeId}/`, { headers: auth(owner) })).json();
      await request.post(`/tasks/api/mistakes/${mistakeId}/review/`, { headers: auth(owner), data: { classification: 'human', manager_remarks: 'E2E clean-up', resolve: true } });
      if (m.corrective_task) await request.delete(`/tasks/api/tasks/${m.corrective_task}/`, { headers: auth(owner) });
    }
  }
});

test('a process (SOP) is written and read back', async ({ page, request }) => {
  const owner = await token(request);
  const title = `E2E process ${Date.now().toString(36)}`;
  try {
    await signIn(page, '/tasks/mistakes?tab=sops');
    await expect(page.getByRole('group', { name: 'Mistakes view' }).getByRole('button', { name: 'Processes (SOP)' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Write a process' }).click();
    const dialog = page.getByRole('dialog', { name: 'Write a process' });
    await dialog.getByLabel('What job is this? *').fill(title);
    await dialog.getByLabel('Mistake category it maps to').fill('Data Entry Error');
    await dialog.getByLabel('Version *').fill('v1');
    await dialog.getByRole('textbox', { name: 'Steps — one per line, in order *' }).fill('Open the purchase order\nMatch every line against the invoice\nPost the voucher');
    await dialog.getByRole('textbox', { name: 'Check before calling it done' }).fill('Voucher total equals the invoice total');
    await dialog.getByRole('button', { name: 'Save process' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText(`${title} v1 saved`);
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row.getByText('3 steps')).toBeVisible();
    await row.getByRole('button', { name: `${title} v1` }).click();
    await expect(row.getByText('Match every line against the invoice')).toBeVisible();
    await expect(row.getByText('Voucher total equals the invoice total')).toBeVisible();

    // Search finds it by category.
    await page.getByLabel('Search a process').fill('Data Entry');
    await expect(row).toBeVisible();
    await shot(page, 'web-mistakes-sops');
  } finally {
    const all = (await (await request.get('/tasks/api/sops/?all=true', { headers: auth(owner) })).json()) as Array<{ id: number; title: string }>;
    for (const s of all.filter((x) => x.title === title)) await request.delete(`/tasks/api/sops/${s.id}/`, { headers: auth(owner) }); // retires it
  }
});
