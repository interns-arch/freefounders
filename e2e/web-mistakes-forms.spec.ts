// Phase 6 parity tests (PLAN.md §18.2) for two modules moved out of the classic app: the mistake register (with SOPs)
// and web forms (builder, public share link, submissions). Found by role/label/text only; data is cleaned up.
// Both modules are switched off for a new company by default, so the suite switches them on and restores them after.
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

// The demo company's switches as they were, restored at the end.
let before: { mistakes: boolean; forms: boolean } = { mistakes: true, forms: true };

test.beforeAll(async () => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const owner = await token(api);
  const company = await (await api.get('/api/platform/company', { headers: auth(owner) })).json();
  const tasks = (company.modules as ModuleRow[]).find((m) => m.app === 'tasks');
  before = {
    mistakes: tasks?.modules.find((m) => m.key === 'mistakes')?.on ?? true,
    forms: tasks?.modules.find((m) => m.key === 'forms')?.on ?? true,
  };
  const res = await api.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { mistakes: true, forms: true } } });
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

test('a form is built and published; its public link works without signing in; the submission shows up', async ({ page, browser, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const name = `E2E form ${stamp}`;
  let formId: number | undefined;
  try {
    await signIn(page, '/tasks/forms?view=manage');
    await expect(page.getByRole('heading', { name: 'Forms' })).toBeVisible();
    await page.getByLabel('New form name').fill(name);
    await page.getByRole('button', { name: 'Create form' }).click();
    await page.waitForURL(/\/tasks\/forms\/\d+$/);
    formId = Number(new URL(page.url()).pathname.split('/').pop());
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();

    // Two fields: a required name and a dropdown.
    await page.getByLabel('Field label *').fill('Your name');
    await page.getByRole('checkbox', { name: 'Required' }).click();
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByRole('list', { name: 'Fields' }).getByText('Your name')).toBeVisible();
    await page.getByLabel('Field label *').fill('Interested in');
    await page.getByLabel('Type').selectOption('dropdown');
    await page.getByLabel('Options (comma-separated) *').fill('Service, Spares, Both');
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByRole('list', { name: 'Fields' }).getByText('Service · Spares · Both')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fields (2)' })).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status')).toContainText('The form is live');
    const share = await page.getByLabel('Share link').inputValue();
    expect(share).toMatch(/\/f\/[A-Za-z0-9_-]+(\?c=[\w-]+)?$/); // the link names the company (multi-company mode)
    const publicToken = share.split('/f/')[1]; // token plus ?c=…
    await shot(page, 'web-forms-builder');

    // The share link in a fresh browser: no sign-in, no app shell.
    const visitor = await browser.newContext();
    const pub = await visitor.newPage();
    await pub.goto(`/f/${publicToken}`);
    await expect(pub.getByRole('heading', { name })).toBeVisible();
    await expect(pub.getByRole('navigation')).toHaveCount(0);
    // Required answers are checked by the server and shown on the field.
    await pub.getByRole('button', { name: 'Submit' }).click();
    await expect(pub.getByText('Your name is required.')).toBeVisible();
    await pub.getByLabel('Your name').fill(`Visitor ${stamp}`);
    await pub.getByLabel('Interested in').selectOption('Spares');
    await pub.getByRole('button', { name: 'Submit' }).click();
    await expect(pub.getByText('Thank you!')).toBeVisible();
    await shot(pub, 'web-forms-public');
    // The same page under /tasks/f/… too.
    await pub.goto(`/tasks/f/${publicToken}`);
    await expect(pub.getByRole('heading', { name })).toBeVisible();
    await visitor.close();

    // The submission is in the list.
    await page.goto(`/tasks/forms/${formId}/submissions`);
    await expect(page.getByRole('heading', { name: `${name} — submissions` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await page.getByRole('button', { name: /^View submission/ }).first().click();
    await expect(page.getByText(`Visitor ${stamp}`)).toBeVisible();
    await expect(page.getByText('Spares', { exact: true })).toBeVisible();

    // Signed-in people see it on the Fill list.
    await page.goto('/tasks/forms');
    await expect(page.getByRole('list', { name: 'Forms to fill' }).getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await shot(page, 'web-forms-list');
  } finally {
    // A form with submissions cannot be deleted: close it so the link stops working.
    if (formId) await request.post(`/tasks/api/forms/${formId}/close/`, { headers: auth(owner) });
  }
});
