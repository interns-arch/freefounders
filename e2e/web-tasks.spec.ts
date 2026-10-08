// Phase 6 parity tests for the task workspace in the new web app (PLAN.md §18): /tasks/tasks and /tasks/tasks/:id.
// Run against `npm run dev`. Finds everything by role, label and text, never by CSS.
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, login = OWNER.login, password = OWNER.password) {
  await page.goto('/?choose');
  await page.getByLabel('Email, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible();
}

const views = (page: Page) => page.getByRole('navigation', { name: 'Task views' }).first();

interface Doer {
  personId: string;
  roleId: string;
  name: string;
  login: string;
  password: string;
  tasksId: number;
  token: string;
}

/** A person with Tasks (a role made for the test), signed in once so they exist in Tasks. */
async function makeDoer(request: APIRequestContext, owner: string, stamp: string): Promise<Doer> {
  const role = await request.post('/api/platform/roles', {
    headers: auth(owner),
    data: { name: `E2E Tasks ${stamp}`, grants: [{ app: 'tasks', permission: 'tasks.view', scope: 'team' }] },
  });
  expect(role.status(), await role.text()).toBe(201);
  const name = `E2E Doer ${stamp}`;
  const login = `e2e-doer-${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: 'E2e@123456' } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roleId = (await role.json()).id as string;
  const given = await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [roleId] } });
  expect(given.ok(), await given.text()).toBeTruthy();
  const first = await token(request, login, 'E2e@123456');
  await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: 'E2e@123456', newPassword: 'E2e@654321' } });
  const mine = await token(request, login, 'E2e@654321');
  let tasksId = 0;
  await expect
    .poll(
      async () => {
        const me = await request.get('/tasks/api/auth/me', { headers: auth(mine) });
        if (!me.ok()) return 0;
        tasksId = (await me.json()).id;
        const people = (await (await request.get('/tasks/api/tasks/assignees/', { headers: auth(owner) })).json()) as Array<{ id: number }>;
        return people.some((p) => p.id === tasksId) ? tasksId : 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return { personId, roleId, name, login, password: 'E2e@654321', tasksId, token: mine };
}

async function cleanUp(request: APIRequestContext, owner: string, doer: Doer | null, taskIds: number[]) {
  for (const id of taskIds) await request.delete(`/tasks/api/tasks/${id}/`, { headers: auth(owner) });
  if (!doer) return;
  await request.put(`/api/platform/people/${doer.personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
  await request.patch(`/api/platform/people/${doer.personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  await request.delete(`/api/platform/roles/${doer.roleId}`, { headers: auth(owner) });
}

async function findTask(request: APIRequestContext, owner: string, title: string) {
  const res = await request.get(`/tasks/api/tasks/?scope=all&status=&page_size=50&search=${encodeURIComponent(title)}`, { headers: auth(owner) });
  const list = (await res.json()) as { results?: Array<{ id: number; code: string; title: string; status: string; priority: string }> };
  return (list.results ?? (list as unknown as Array<{ id: number; code: string; title: string; status: string; priority: string }>)).find((t) => t.title === title);
}

async function firstCategory(request: APIRequestContext, owner: string): Promise<string | null> {
  const res = await request.get('/tasks/api/task-categories/?department=', { headers: auth(owner) });
  const data = await res.json();
  const list = (data.results ?? data) as Array<{ name: string }>;
  return list[0]?.name ?? null;
}

async function asDoer(browser: Browser, doer: Doer) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, doer.login, doer.password);
  return { context, page };
}

test('task views switch by tab and keep the tab in the address', async ({ page }) => {
  await signIn(page);
  await page.goto('/tasks/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(views(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /Overdue/ }).first()).toBeVisible();

  await views(page).getByRole('link', { name: 'My Tasks' }).click();
  await expect(page).toHaveURL(/tab=my/);
  await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Status' })).toBeVisible();

  await views(page).getByRole('link', { name: 'All Tasks' }).click();
  await expect(page).toHaveURL(/tab=all/);
  await expect(page.getByLabel('Department')).toBeVisible();

  await views(page).getByRole('link', { name: /^To accept/ }).click();
  await expect(page.getByRole('group', { name: 'Which reviews' })).toBeVisible();

  await views(page).getByRole('link', { name: 'Template Directory' }).click();
  await expect(page.getByLabel('Search all templates')).toBeVisible();

  await views(page).getByRole('link', { name: 'Activities' }).click();
  await expect(page.getByRole('group', { name: 'Window' })).toBeVisible();

  // A dashboard tile opens the matching list, with its filters in the address.
  await views(page).getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: /^Overdue/ }).first().click();
  await expect(page).toHaveURL(/tab=my.*overdue=1|overdue=1.*tab=my/);
  await expect(page.getByRole('button', { name: 'Overdue only' })).toHaveAttribute('aria-pressed', 'true');
});

test('reports: every report tab renders, and ?user= opens a profile', async ({ page }) => {
  await signIn(page);
  await page.goto('/tasks/tasks?tab=employees');
  const reports = page.getByRole('navigation', { name: 'Reports' });
  await expect(reports.getByRole('button', { name: 'Employees' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('columnheader', { name: 'Employee' }).or(page.getByText('Nothing in this range.'))).toBeVisible();
  await reports.getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByRole('columnheader', { name: 'Month' }).or(page.getByText('Nothing in this range.'))).toBeVisible();
  await reports.getByRole('button', { name: 'Daily' }).click();
  await expect(page.getByRole('columnheader', { name: 'Date' }).or(page.getByText('Nothing completed in this range.'))).toBeVisible();

  await views(page).getByRole('link', { name: 'Time Report' }).click();
  await expect(page.getByRole('group', { name: 'Period' })).toBeVisible();

  // The contract other screens link to: /tasks/tasks?tab=employees&user=<id>
  const owner = await token(page.request);
  const me = await (await page.request.get('/tasks/api/auth/me', { headers: auth(owner) })).json();
  await page.goto(`/tasks/tasks?tab=employees&user=${me.id}`);
  const profile = page.getByRole('dialog');
  await expect(profile.getByText('Their tasks and how they are doing')).toBeVisible();
  await expect(profile.getByText('Time earned')).toBeVisible();
  await profile.getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/user=/);
});

test('create → steps and comments → complete with remarks → accept from To accept; change request approved', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const taskIds: number[] = [];
  let doer: Doer | null = null;
  try {
    doer = await makeDoer(request, owner, stamp);
    const category = await firstCategory(request, owner);

    // ── Owner creates a task for the doer ──
    await signIn(page);
    await page.goto('/tasks/tasks?tab=my');
    await page.getByRole('button', { name: 'Add task' }).click();
    const form = page.getByRole('dialog', { name: 'Add task' });
    const title = `E2E web task ${stamp}`;
    await form.getByLabel('Title').fill(title);
    await form.getByRole('textbox', { name: /^Description/ }).fill('Check the brake pads and send the quotation.');
    await form.getByLabel('Assign to').click();
    await page.getByLabel('Search name or department').fill(doer.name);
    await page.getByRole('checkbox', { name: doer.name }).click();
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('Assign to')).toContainText(doer.name);
    const due = new Date(Date.now() + 2 * 86_400_000);
    const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await form.getByLabel(/^Due/).fill(local);
    await form.getByRole('spinbutton', { name: /^Effort/ }).fill('45');
    if (category) await form.getByLabel(/^Category/).selectOption(category);
    else {
      await form.getByRole('button', { name: 'New' }).click();
      await form.getByLabel(/^Category/).fill(`E2E cat ${stamp}`);
      await form.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await form.getByRole('button', { name: 'Create task' }).click();
    await expect(form).toBeHidden();
    const made = await findTask(request, owner, title);
    expect(made, 'the task was created').toBeTruthy();
    taskIds.push(made!.id);

    // ── Detail: add a step and a comment, tick the step ──
    await page.goto(`/tasks/tasks/${made!.id}`);
    const detail = page.getByRole('dialog', { name: title });
    await expect(detail).toBeVisible();
    await detail.getByLabel('Add a step').fill('Call the vendor');
    await detail.getByRole('button', { name: 'Add step' }).click();
    await expect(detail.getByRole('checkbox', { name: 'Tick step: Call the vendor' })).toBeVisible();
    await detail.getByLabel('Write a comment').fill(`Please hurry ${stamp}`);
    await detail.getByRole('button', { name: 'Send' }).click();
    await expect(detail.getByRole('list', { name: 'Updates' }).getByText(`Please hurry ${stamp}`)).toBeVisible();
    await detail.getByRole('checkbox', { name: 'Tick step: Call the vendor' }).click();
    const stepDone = page.getByRole('dialog', { name: 'Step done' });
    await stepDone.getByRole('textbox', { name: /What did you do/ }).fill('Called and confirmed the price');
    await stepDone.getByRole('button', { name: 'Mark done' }).click();
    await expect(detail.getByRole('checkbox', { name: 'Re-open step: Call the vendor' })).toBeVisible();
    await detail.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/tasks\/tasks$/);

    // ── The doer completes it with remarks and minutes ──
    const other = await asDoer(browser, doer);
    try {
      await other.page.goto(`/tasks/tasks/${made!.id}`);
      const theirs = other.page.getByRole('dialog', { name: title });
      await theirs.getByRole('button', { name: 'Complete' }).click();
      const complete = other.page.getByRole('dialog', { name: `Complete ${made!.code}` });
      await complete.getByRole('textbox', { name: /What was done/ }).fill('Pads replaced, quotation sent to the customer.');
      await complete.getByRole('spinbutton', { name: /Total effort you spent/ }).fill('30');
      await complete.getByRole('button', { name: 'Complete task' }).click();
      await expect(complete).toBeHidden();

      // ── Change request: the doer asks to raise the priority of a second task ──
      const second = await request.post('/tasks/api/tasks/', {
        headers: auth(owner),
        data: { title: `E2E change ${stamp}`, description: 'For the change request', category: category ?? `E2E cat ${stamp}`, due_at: due.toISOString(), effort_minutes: 20, assigned_to: doer.tasksId },
      });
      expect(second.status(), await second.text()).toBe(201);
      const s = await second.json();
      taskIds.push(s.id);
      await other.page.goto('/tasks/tasks?tab=my');
      await other.page.getByRole('button', { name: `Change ${s.code}` }).click();
      const req = other.page.getByRole('dialog', { name: `Request a change — ${s.code}` });
      await req.getByLabel('New priority').selectOption('urgent');
      await req.getByRole('textbox', { name: /^Reason/ }).fill('The customer moved the deadline earlier');
      await req.getByRole('button', { name: 'Send request' }).click();
      await expect(req).toBeHidden();

      // ── Owner accepts the work and approves the change ──
      await page.goto('/tasks/tasks?tab=reviews');
      await page.getByRole('button', { name: `Accept ${made!.code}` }).click();
      await expect(page.getByRole('button', { name: `Accept ${made!.code}` })).toBeHidden();
      await expect.poll(async () => (await findTask(request, owner, title))?.status).toBe('done');

      await views(page).getByRole('link', { name: /^Requests/ }).click();
      await page.getByRole('button', { name: `Approve ${s.code}` }).click();
      await expect(page.getByRole('button', { name: `Approve ${s.code}` })).toBeHidden();
      await expect.poll(async () => (await findTask(request, owner, `E2E change ${stamp}`))?.priority).toBe('urgent');
    } finally {
      await other.context.close();
    }
  } finally {
    await cleanUp(request, owner, doer, taskIds);
  }
});
