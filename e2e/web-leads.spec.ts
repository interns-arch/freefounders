// Phase 6 parity tests (PLAN.md §18.2): Leads & quotations and the AI inbox in the new web app.
// Found by role/label/text only; the Leads module is switched on for the demo company for the run and put back after.
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

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
  if (new URL(page.url()).pathname !== path) await page.goto(path);
}

/** The Leads module is off for the demo company by default: switch it on, remember what it was. */
async function leadsModuleOn(request: APIRequestContext, owner: string): Promise<boolean> {
  const company = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
  const tasks = company.modules.find((m: { app: string }) => m.app === 'tasks');
  const was = tasks?.modules.find((m: { key: string }) => m.key === 'leads')?.on ?? true;
  if (!was) expect((await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { leads: true } } })).ok()).toBeTruthy();
  // The switch is pushed to Tasks; wait until the API answers.
  await expect.poll(async () => (await request.get('/tasks/api/leads/summary/', { headers: auth(owner) })).status(), { timeout: 15_000 }).toBe(200);
  return was;
}

async function restoreLeadsModule(request: APIRequestContext, owner: string, was: boolean) {
  if (!was) await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { leads: false } } });
}

test('a lead is created, edited, moved along the pipeline and gets a quotation', async ({ page, request }) => {
  const owner = await token(request);
  const was = await leadsModuleOn(request, owner);
  const stamp = Date.now().toString(36);
  const name = `E2E Lead ${stamp}`;
  let leadId: number | undefined;
  try {
    await signIn(page, '/tasks/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: /^Leads/ })).toHaveAttribute('href', '/tasks/leads');
    await expect(page.getByText('Total leads')).toBeVisible();
    await expect(page.getByLabel('Search leads')).toBeVisible();

    // Create.
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const form = page.getByRole('dialog', { name: 'Add lead' });
    await form.getByLabel('Customer name *').fill(name);
    await form.getByLabel('Phone').fill('9876500000');
    await form.getByLabel('Company').fill('E2E Motors');
    await form.getByLabel('Requirement').fill('Brake pads for Tata 407');
    await form.getByLabel('Priority').selectOption('high');
    await form.getByLabel('Estimated value (₹)').fill('250000');
    await form.getByRole('button', { name: 'Create lead' }).click();
    await expect(form).toBeHidden();

    // The new lead opens in its drawer and sits in "New".
    const drawer = page.getByRole('dialog', { name: name });
    await expect(drawer).toBeVisible();
    leadId = Number(new URL(page.url()).searchParams.get('lead'));
    expect(leadId).toBeGreaterThan(0);
    await expect(drawer.getByText('E2E Motors · Manual')).toBeVisible();
    await expect(drawer.getByText('₹2.5 L')).toBeVisible();
    await expect(drawer.getByRole('tab', { name: /^Timeline \(1\)/ })).toBeVisible();

    // Edit details.
    await drawer.getByRole('button', { name: 'Edit details' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit lead' });
    await edit.getByLabel('Company').fill('E2E Motors Ltd');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden();
    await expect(drawer.getByText('E2E Motors Ltd · Manual')).toBeVisible();

    // Move along the pipeline.
    await drawer.getByLabel('Status', { exact: true }).selectOption('contacted');
    await expect(drawer.getByLabel('Status', { exact: true })).toHaveValue('contacted');
    await expect(drawer.getByRole('tab', { name: /^Timeline \(2\)/ })).toBeVisible();

    // A note on the timeline.
    await drawer.getByRole('textbox', { name: 'Add a note' }).fill('Called, sending a quote tomorrow');
    await drawer.getByRole('button', { name: 'Save note' }).click();
    await expect(drawer.getByText('Called, sending a quote tomorrow')).toBeVisible();

    // A quotation.
    await drawer.getByRole('tab', { name: /^Quotations/ }).click();
    await drawer.getByLabel('Amount (₹) *').fill('240000');
    await drawer.getByLabel('Notes (optional)').fill('Incl. fitting');
    await drawer.getByRole('button', { name: 'Add quotation' }).click();
    await expect(drawer.getByText('₹2.4 L')).toBeVisible();
    await expect(drawer.getByText('Incl. fitting')).toBeVisible();
    const qStatus = drawer.getByLabel(/^Status of quotation /);
    await qStatus.selectOption('sent');
    await expect(qStatus).toHaveValue('sent');
    await shot(page, 'web-leads-drawer');

    // Back on the board: the card is in "Contacted".
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    const contacted = page.getByRole('region', { name: /^Contacted \(/ });
    await expect(contacted.getByRole('button', { name: `Open lead ${name}` })).toBeVisible();
    await page.getByLabel('Search leads').fill(name);
    await expect(page.getByRole('button', { name: `Open lead ${name}` })).toHaveCount(1);
    await shot(page, 'web-leads-board');
  } finally {
    if (!leadId) {
      const list = await (await request.get(`/tasks/api/leads/?search=${encodeURIComponent(name)}`, { headers: auth(owner) })).json();
      leadId = (list.results ?? list).find((l: { customer_name: string }) => l.customer_name === name)?.id;
    }
    if (leadId) await request.delete(`/tasks/api/leads/${leadId}/`, { headers: auth(owner) });
    await restoreLeadsModule(request, owner, was);
  }
});

test('the leads board fits a phone', async ({ page, request }) => {
  const owner = await token(request);
  const was = await leadsModuleOn(request, owner);
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, '/tasks/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
    await expect(page.getByText('Total leads')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, 'web-leads-phone');
  } finally {
    await restoreLeadsModule(request, owner, was);
  }
});

test('the AI inbox renders with its simulator and filters', async ({ page }) => {
  await signIn(page, '/tasks/intake');
  await expect(page.getByRole('heading', { name: 'AI inbox' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link', { name: /^AI inbox/ })).toHaveAttribute('href', '/tasks/intake');
  await expect(page.getByRole('heading', { name: 'Simulator' })).toBeVisible();
  await expect(page.getByLabel('Message *')).toBeVisible();
  await page.getByLabel('Channel', { exact: true }).selectOption('gmail');
  await expect(page.getByLabel('Subject')).toBeVisible();
  await page.getByRole('group', { name: 'Channel filter' }).getByRole('button', { name: 'WhatsApp' }).click();
  const rows = page.getByRole('main').getByRole('listitem');
  if ((await rows.count()) === 0) await expect(page.getByText('No inbound messages yet')).toBeVisible();
  await shot(page, 'web-intake');
});
