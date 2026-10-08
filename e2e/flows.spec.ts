// Phase 5 behaviour tests (PLAN.md §17): the People directory, "Start exit" across both apps, and an Assets ticket
// turning into a Tasks task. Run against `npm run dev` (the Platform reads the apps' events every 5 s there).
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

async function signIn(page: Page) {
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible();
}

/** A person with Tasks and Assets (through a role made for the test), reporting to the owner. */
async function makePerson(request: APIRequestContext, owner: string, stamp: string) {
  const me = await (await request.get('/api/platform/auth/me', { headers: auth(owner) })).json();
  const role = await request.post('/api/platform/roles', {
    headers: auth(owner),
    data: { name: `E2E Both ${stamp}`, grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }, { app: 'assets', permission: 'ticket:create', scope: '' }] },
  });
  expect(role.status(), await role.text()).toBe(201);
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Leaver ${stamp}`, email: `e2e-leaver-${stamp}@freefounders.test`, reportsTo: me.person.id, login: { username: `e2e-leaver-${stamp}`, password: 'E2e@123456' } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const given = await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [(await role.json()).id] } });
  expect(given.ok(), await given.text()).toBeTruthy();
  return { personId, roleId: (await role.json()).id as string, name: `E2E Leaver ${stamp}` };
}

async function cleanUp(request: APIRequestContext, owner: string, p: { personId: string; roleId: string }) {
  await request.put(`/api/platform/people/${p.personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
  await request.patch(`/api/platform/people/${p.personId}`, { headers: auth(owner), data: { status: 'inactive', reportsTo: null } });
  await request.delete(`/api/platform/roles/${p.roleId}`, { headers: auth(owner) });
}

test('start an exit in the portal: Assets opens the exit case, Tasks gives the manager the checklist', async ({ page, request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const person = await makePerson(request, owner, stamp);
  try {
    await page.goto('/?choose');
    await signIn(page);
    await page.goto('/people');
    await page.getByLabel('Search people').fill(person.name);
    const row = page.getByRole('row', { name: new RegExp(person.name) });
    await row.getByRole('button', { name: `More actions for ${person.name}` }).click();
    await page.getByRole('menuitem', { name: 'Start exit' }).click();
    const dialog = page.getByRole('dialog', { name: `Exit: ${person.name}` });
    await dialog.getByLabel(/^Last working day/).fill('2026-12-31');
    await dialog.getByLabel('Reason (optional)').fill('Moving cities');
    await dialog.getByRole('button', { name: 'Start exit' }).click();
    await expect(dialog.getByText('Exit started.')).toBeVisible();
    await expect(dialog.getByText(/exit case/)).toBeVisible();
    await expect(dialog.getByText(/exit checklist T-\d+/)).toBeVisible();
    await shot(page, '13-start-exit');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(row.getByText(/Leaving 2026-12-31/)).toBeVisible();

    // Assets: the exit case is there.
    await page.goto('/assets/exits');
    await expect(page.getByText(person.name).first()).toBeVisible();
    // Tasks: the manager (the owner) has the checklist.
    const tasks = await (await request.get('/tasks/api/tasks/?scope=my&page_size=200', { headers: auth(owner) })).json();
    const list = (tasks.results ?? tasks) as Array<{ title: string }>;
    expect(list.some((t) => t.title.startsWith(`Exit checklist: ${person.name}`))).toBeTruthy();
  } finally {
    await cleanUp(request, owner, person);
  }
});

test('an Assets ticket becomes a Tasks task for the IT owner, linked back to the ticket', async ({ request }) => {
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const person = await makePerson(request, owner, stamp);
  try {
    // The person raises a ticket in Assets with their FreeFounders sign-in.
    const first = await token(request, `e2e-leaver-${stamp}`, 'E2e@123456');
    await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: 'E2e@123456', newPassword: 'E2e@654321' } });
    const mine = await token(request, `e2e-leaver-${stamp}`, 'E2e@654321');
    const title = `E2E printer jam ${stamp}`;
    const created = await request.post('/assets/api/tickets', { headers: auth(mine), data: { title, type: 'ISSUE', priority: 'HIGH' } });
    expect(created.status(), await created.text()).toBe(201);
    const ticket = await created.json();

    // Within a few seconds the Platform has made the task and linked it.
    await expect
      .poll(async () => {
        const t = await (await request.get(`/assets/api/tickets/${ticket.id}`, { headers: auth(owner) })).json();
        return t.linkedTask?.ref ?? null;
      }, { timeout: 30_000 })
      .toMatch(/^T-\d+$/);
    const tasks = await (await request.get('/tasks/api/tasks/?scope=all&page_size=200', { headers: auth(owner) })).json();
    const task = ((tasks.results ?? tasks) as Array<{ title: string; external_url: string }>).find((t) => t.title === `${ticket.number}: ${title}`);
    expect(task, 'the task is in Tasks').toBeTruthy();
    expect(task!.external_url).toBe(`/assets/tickets?open=${ticket.id}`);
  } finally {
    await cleanUp(request, owner, person);
  }
});
