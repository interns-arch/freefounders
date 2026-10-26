// Open items closed (PLAN.md §19.40): HR marks leave for someone, bulk import of people, the Integrations keys screen.
// Found by role / label / text; people made here are switched off afterwards (reset DEMO after a run that adds many).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email, mobile, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Switch off and strip the roles of the people with these emails / employee IDs. */
async function switchOff(request: APIRequestContext, owner: string, searches: string[]) {
  for (const q of searches) {
    const list = (await (await request.get(`/api/platform/people?search=${encodeURIComponent(q)}`, { headers: auth(owner) })).json()) as Array<{ id: string }>;
    for (const p of list) {
      await request.put(`/api/platform/people/${p.id}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${p.id}`, { headers: auth(owner), data: { status: 'inactive' } });
    }
  }
}

function nextYearMonday(): string {
  const d = new Date(new Date().getFullYear() + 1, 4, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (Date.now() % 20) * 7); // a different week each run
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('import people from a CSV: preview with per-row errors, then import; HR marks a half-day leave for one of them', async ({ page, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const lead = { name: `E2E Lead ${stamp}`, email: `e2e-imp-lead-${stamp}@kaampilot.test`, code: `E2E-L-${stamp}` };
  const exec = { name: `E2E Exec ${stamp}`, email: `e2e-imp-exec-${stamp}@kaampilot.test`, code: `E2E-X-${stamp}` };
  const csv = [
    'Name,Email,Mobile,Employee ID,Department,Designation,Reports to,Join date,Role',
    `${lead.name},${lead.email},,${lead.code},,Team lead,,01-10-2026,Member`,
    `${exec.name},${exec.email},98111 22333,${exec.code},,Executive,${lead.code},2026-10-02,`,
    `,nobody-${stamp}@kaampilot.test,,,,,,,`,
  ].join('\n');
  try {
    await signIn(page);
    await page.goto('/people');
    await page.getByRole('button', { name: 'Import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import people' });
    await expect(dialog.getByRole('button', { name: 'Download the people template (XLSX)' })).toBeVisible();
    await dialog.getByLabel('People file (.xlsx or .csv)').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await dialog.getByRole('button', { name: 'Check file' }).click();
    await expect(dialog.getByText(/2\s*ready · 1\s*with errors/)).toBeVisible();
    await expect(dialog.getByText('Name: Name is required.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 2 people' }).click();
    await expect(dialog.getByText('Import finished')).toBeVisible({ timeout: 60_000 }); // each person is set up in every app
    await expect(dialog.getByRole('button', { name: 'Sign-in sheet (CSV)' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The manager inside the file is set.
    const people = (await (await request.get(`/api/platform/people?search=${stamp}`, { headers: auth(owner) })).json()) as Array<{ id: string; fullName: string; reportsTo: string | null }>;
    const leadRow = people.find((p) => p.fullName === lead.name)!;
    expect(people.find((p) => p.fullName === exec.name)?.reportsTo).toBe(leadRow.id);

    // HR (the owner) marks a half-day leave for the new person from My leave.
    await page.goto('/attendance/leave');
    await page.getByRole('button', { name: 'Mark leave' }).click();
    const form = page.getByRole('dialog', { name: 'Mark leave' });
    await expect(form.getByLabel('Employee *').locator('option', { hasText: exec.name })).toHaveCount(1, { timeout: 15_000 });
    const option = await form.getByLabel('Employee *').locator('option', { hasText: exec.name }).getAttribute('value');
    await form.getByLabel('Employee *').selectOption(option!);
    const day = nextYearMonday();
    await form.getByLabel('From *').fill(day);
    await form.getByLabel('To *').fill(day);
    await form.getByLabel('Half day (counts 0.5)').check();
    await form.getByLabel('Reason *').fill('Doctor visit (e2e)');
    await form.getByRole('button', { name: 'Mark leave' }).click();
    await expect(form).toBeHidden();
  } finally {
    await switchOff(request, owner, [lead.email, exec.email]);
  }
});

test('Settings → Integrations: a key is write-only (masked), Replace and Remove', async ({ page, request }) => {
  const owner = await token(request);
  const secret = `sk-e2e-${Date.now().toString(36)}-wxyz`;
  await signIn(page);
  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Integrations' });
  await expect(card.getByRole('heading', { name: 'WhatsApp' })).toBeVisible();
  const add = card.getByRole('button', { name: /^(Add|Replace) NVIDIA API key$/ });
  await add.click();
  await card.getByLabel('NVIDIA API key', { exact: true }).fill(secret);
  await card.getByLabel('NVIDIA API key', { exact: true }).press('Enter');
  await expect(card.getByText('••••wxyz')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Replace NVIDIA API key' })).toBeVisible();
  const api = await (await request.get('/tasks/api/integrations/', { headers: auth(owner) })).text();
  expect(api).not.toContain(secret);
  await card.getByRole('button', { name: 'Remove NVIDIA API key' }).click();
  await expect(card.getByRole('button', { name: 'Add NVIDIA API key' })).toBeVisible();
});
