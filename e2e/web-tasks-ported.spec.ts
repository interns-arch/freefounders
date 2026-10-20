// Tasks changes ported from the original app on 2026-10-20 (PLAN.md §19.30), in the new web app: red counts on the task
// tabs, a task given to you is changed and deleted only through the giver (admins too), only the Owner gives work to the
// Owner, Team performance (given & received, who asks most to move a due date), WhatsApp hours in Task settings.
// Run against `npm run dev`.
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

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
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
}

const views = (page: Page) => page.getByRole('navigation', { name: 'Task views' }).first();

/** A company Admin (Make Admin), signed in once so they exist in Tasks with admin powers. */
async function makeAdmin(request: APIRequestContext, owner: string, stamp: string) {
  const name = `E2E Admin ${stamp}`;
  const login = `e2e-admin-${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: 'E2e@123456' } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const level = await request.put(`/api/platform/people/${personId}/level`, { headers: auth(owner), data: { level: 'admin' } });
  expect(level.ok(), await level.text()).toBeTruthy();
  const mine = await token(request, login, 'E2e@123456');
  let tasksId = 0;
  // Tasks knows them, and as an admin (sees every change request)
  await expect
    .poll(
      async () => {
        const me = await request.get('/tasks/api/auth/me', { headers: auth(mine) });
        if (!me.ok()) return 0;
        tasksId = (await me.json()).id;
        const all = await request.get('/tasks/api/task-change-requests/?scope=all', { headers: auth(mine) });
        return all.ok() ? tasksId : 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return { personId, name, login, password: 'E2e@123456', tasksId, token: mine };
}

async function category(request: APIRequestContext, owner: string): Promise<string> {
  const res = await request.get('/tasks/api/task-categories/?department=', { headers: auth(owner) });
  const data = await res.json();
  return ((data.results ?? data) as Array<{ name: string }>)[0]?.name ?? 'General';
}

test('an admin who received a task changes and deletes it only through the giver; tab counts; the Owner takes work only from an Owner', async ({ browser, page, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const stamp = Date.now().toString(36);
  const ids: number[] = [];
  let admin: Awaited<ReturnType<typeof makeAdmin>> | null = null;
  try {
    admin = await makeAdmin(request, owner, stamp);
    const cat = await category(request, owner);
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const made: Array<{ id: number; code: string }> = [];
    for (const n of [1, 2]) {
      const res = await request.post('/tasks/api/tasks/', {
        headers: auth(owner),
        data: { title: `E2E given ${n} ${stamp}`, description: 'Given by the owner', category: cat, due_at: due, effort_minutes: 20, assigned_to: admin.tasksId },
      });
      expect(res.status(), await res.text()).toBe(201);
      const t = await res.json();
      ids.push(t.id);
      made.push({ id: t.id, code: t.code });
    }

    // The Owner takes work only from an Owner (original app 3fbf6e7).
    const ownerMe = await (await request.get('/tasks/api/auth/me', { headers: auth(owner) })).json();
    const toOwner = await request.post('/tasks/api/tasks/', {
      headers: auth(admin.token),
      data: { title: `E2E to owner ${stamp}`, description: 'x', category: cat, due_at: due, effort_minutes: 20, assigned_to: ownerMe.id },
    });
    expect(toOwner.status()).toBe(403);
    expect(await toOwner.text()).toContain('Only the Owner');
    // A direct edit of a task given to them is refused, admin or not (3ff22ba).
    const direct = await request.patch(`/tasks/api/tasks/${made[0].id}/`, { headers: auth(admin.token), data: { priority: 'urgent' } });
    expect(direct.status()).toBe(403);

    const context = await browser.newContext();
    const theirs = await context.newPage();
    try {
      await signIn(theirs, admin.login, admin.password);
      // Red count on My Tasks (d0a1bdf): their two open tasks.
      await theirs.goto('/tasks/tasks');
      await expect(views(theirs).getByRole('link', { name: /^My Tasks/ }).getByLabel('2 waiting')).toBeVisible();

      // A change goes to the giver as a request, even for an admin.
      await theirs.goto(`/tasks/tasks/${made[0].id}`);
      const detail = theirs.getByRole('dialog', { name: `E2E given 1 ${stamp}` });
      await expect(detail.getByRole('button', { name: 'Delete' })).toHaveCount(0);
      await detail.getByRole('button', { name: 'Request change' }).click();
      const req = theirs.getByRole('dialog', { name: `Request a change — ${made[0].code}` });
      await expect(req.getByText('given to you by')).toBeVisible();
      await req.getByLabel('New priority').selectOption('urgent');
      await req.getByRole('textbox', { name: /^Reason/ }).fill('The customer needs it sooner');
      await req.getByRole('button', { name: 'Send request' }).click();
      await expect(req).toBeHidden();

      // Deleting it is a request to the giver too (6ec1bc6).
      await theirs.goto('/tasks/tasks?tab=my');
      await theirs.getByRole('button', { name: `Change ${made[1].code}` }).click();
      const del = theirs.getByRole('dialog', { name: `Request a change — ${made[1].code}` });
      await del.getByLabel('Cancel this task entirely').click();
      await del.getByRole('textbox', { name: /^Reason/ }).fill('Not needed any more');
      await del.getByRole('button', { name: 'Send delete request' }).click();
      await expect(del).toBeHidden();
    } finally {
      await context.close();
    }

    // The giver approves both from Requests (with its red count); the second moves to Deleted.
    await signIn(page);
    await page.goto('/tasks/tasks?tab=requests');
    await expect(views(page).getByRole('link', { name: /^Requests/ }).getByLabel(/\d+ waiting/)).toBeVisible();
    for (const t of made) {
      await page.getByRole('button', { name: `Approve ${t.code}` }).click();
      await expect(page.getByRole('button', { name: `Approve ${t.code}` })).toBeHidden();
    }
    await expect.poll(async () => (await (await request.get(`/tasks/api/tasks/${made[0].id}/`, { headers: auth(owner) })).json()).priority).toBe('urgent');
    await expect
      .poll(async () => {
        const bin = await (await request.get('/tasks/api/tasks/?scope=deleted&page_size=100', { headers: auth(owner) })).json();
        return ((bin.results ?? bin) as Array<{ id: number }>).some((t) => t.id === made[1].id);
      })
      .toBe(true);
  } finally {
    for (const id of ids) await request.delete(`/tasks/api/tasks/${id}/`, { headers: auth(owner) });
    if (admin) {
      await request.put(`/api/platform/people/${admin.personId}/level`, { headers: auth(owner), data: { level: 'member' } });
      await request.patch(`/api/platform/people/${admin.personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    }
  }
});

test('Team performance shows tasks given & received and who asks most to move a due date; Task settings has WhatsApp hours', async ({ page }) => {
  await signIn(page);
  await page.goto('/tasks/team');
  await expect(page.getByText('Tasks given & received', { exact: true })).toBeVisible();
  await expect(page.getByText('Who asks most to change a due date', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Approval rate' }).or(page.getByText('Nobody asked to move a due date in this range.'))).toBeVisible();

  await page.goto('/tasks/settings');
  await expect(page.getByText('WhatsApp hours', { exact: true })).toBeVisible();
  await expect(page.getByLabel('From')).toBeVisible();
  await expect(page.getByLabel('Until')).toBeVisible();
});
