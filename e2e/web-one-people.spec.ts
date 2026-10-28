// One place for people (PLAN.md §26): people are added, edited and switched off only in Admin → People. The apps refuse
// their own "add / edit / switch off" (403 "People are managed in Admin → People"), the People push creates and updates
// the person in Assets and Tasks, and the Assets screens show people read-only with a "Manage in People" link.
// Run against `npm run dev`.
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const MANAGED = 'People are managed in Admin → People';
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

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
}

type AssetsEmployee = { id: string; fullName: string; email: string | null; employeeCode: string };
const findInAssets = async (request: APIRequestContext, owner: string, search: string) => {
  const res = await request.get(`/assets/api/employees?search=${encodeURIComponent(search)}&pageSize=5`, { headers: auth(owner) });
  return res.ok() ? ((await res.json()).items as AssetsEmployee[]) : [];
};

test('the apps refuse to add or change people; the People push adds and renames them in Assets and Tasks', async ({ request }) => {
  const owner = await token(request);
  const tag = Date.now().toString(36);

  // Old clients / shortcuts cannot add duplicates anywhere else.
  const assetsAdd = await request.post('/assets/api/employees', { headers: auth(owner), data: { employeeCode: `E2E-${tag}`, firstName: 'Nope' } });
  expect(assetsAdd.status()).toBe(403);
  expect((await assetsAdd.json()).message).toBe(MANAGED);
  const joiner = await request.post('/assets/api/onboarding', { headers: auth(owner), data: { employeeCode: `E2J-${tag}`, firstName: 'Nope', joinDate: '2026-12-01' } });
  expect(joiner.status()).toBe(403);
  const tasksAdd = await request.post('/tasks/api/users/', { headers: auth(owner), data: { username: `e2e-${tag}`, password: 'E2e@123456', role: 'member' } });
  expect(tasksAdd.status()).toBe(403);
  expect((await tasksAdd.json()).detail).toBe(MANAGED);

  // Added once, in People (with the Member role): appears in Assets and Tasks.
  const email = `e2e-one-${tag}@kaampilot.test`;
  const created = await request.post('/api/platform/people', { headers: auth(owner), data: { fullName: `E2E One ${tag}`, email, employeeCode: `E2E${tag}`.toUpperCase().slice(0, 20) } });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  try {
    const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
    const member = roles.find((r) => r.code === 'ff_member')!;
    const given = await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } });
    expect(given.ok(), await given.text()).toBeTruthy();
    await expect.poll(async () => (await findInAssets(request, owner, email)).length, { timeout: 30_000 }).toBe(1);
    const [emp] = await findInAssets(request, owner, email);
    expect(emp.fullName).toBe(`E2E One ${tag}`);

    // Renamed in People: Assets and Tasks follow.
    const renamed = await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { fullName: `E2E Renamed ${tag}` } });
    expect(renamed.ok(), await renamed.text()).toBeTruthy();
    await expect.poll(async () => (await findInAssets(request, owner, email))[0]?.fullName, { timeout: 30_000 }).toBe(`E2E Renamed ${tag}`);
    const users = (await (await request.get('/tasks/api/users/?page_size=500', { headers: auth(owner) })).json()) as { results?: Array<{ email: string; first_name: string; last_name: string; platform_person_id: string | null }> };
    const tasksUser = (users.results ?? (users as unknown as NonNullable<typeof users.results>)).find((u) => u.email === email);
    expect(tasksUser, 'Tasks has the person').toBeTruthy();
    expect(`${tasksUser!.first_name} ${tasksUser!.last_name}`).toBe(`E2E Renamed ${tag}`);
    expect(tasksUser!.platform_person_id).toBe(personId);

    // Editing who they are in Assets is refused; Assets' own notes still save.
    const rename = await request.patch(`/assets/api/employees/${emp.id}`, { headers: auth(owner), data: { firstName: 'Other' } });
    expect(rename.status()).toBe(403);
    const notes = await request.patch(`/assets/api/employees/${emp.id}`, { headers: auth(owner), data: { notes: 'Desk 14' } });
    expect(notes.ok(), await notes.text()).toBeTruthy();
  } finally {
    await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});

test('Assets shows people read-only and sends admins to People; the dashboard counts agree', async ({ page, request }) => {
  const owner = await token(request);
  const dash = await (await request.get('/assets/api/dashboard', { headers: auth(owner) })).json();

  await signIn(page, '/assets');
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add employee' })).toHaveCount(0);
  await expect(page.getByText(`${dash.totals.assets.toLocaleString('en-IN')} in the register (excluding disposed)`)).toBeVisible();

  const menu = page.getByRole('navigation', { name: 'Assets menu' });
  await menu.getByRole('link', { name: 'People & assets' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People & assets' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add employee/ })).toHaveCount(0);
  await page.getByPlaceholder(/Search/).first().fill('Demo Owner');
  await page.getByRole('main').getByRole('row').filter({ hasText: 'Demo Owner' }).first().click();
  await expect(page).toHaveURL(/\/assets\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: /Change login|Give login|Turn off/ })).toHaveCount(0);
  await shot(page, 'one-people-assets-person');
  await page.getByRole('link', { name: 'Manage in People' }).first().click();
  await expect(page).toHaveURL(/\/people/);
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Edit Demo Owner/ })).toBeVisible();
  await shot(page, 'one-people-people-form');

  // The "+ Add" menu has no Employee / New joiner / Department.
  await page.goto('/assets/assets');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Asset( \d)?$/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^(Employee|New joiner|Department)( \d)?$/ })).toHaveCount(0);
});
