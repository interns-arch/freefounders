// Phase 6 parity tests (PLAN.md §18.2): the general Tasks screens of the new web app — home, team performance,
// groups, notices, notifications, my team and task settings. Found by role/label/text only; data is cleaned up.
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
  await page.getByLabel('Email, mobile, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The chooser (several apps) or the screen itself: go to the screen.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (new URL(page.url()).pathname !== path) await page.goto(path);
}

test('home dashboard renders my work, deadlines and score', async ({ page }) => {
  await signIn(page, '/tasks');
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Waiting on you' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Work to accept/ })).toHaveAttribute('href', '/tasks/tasks?tab=reviews');
  await expect(page.getByRole('heading', { name: 'My deadlines' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My score' })).toBeVisible();
  await expect(page.getByLabel('Date range')).toHaveValue('this_month');
  // The owner is an admin: everyone's tasks given & received.
  await expect(page.getByRole('heading', { name: 'Tasks given & received' })).toBeVisible();
  await shot(page, 'web-tasks-home');
});

test('team performance shows attendance and leave days per person', async ({ page }) => {
  await signIn(page, '/tasks/team');
  await expect(page.getByRole('heading', { name: 'Team Performance' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Attendance' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Leave days' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Email weekly update' })).toBeVisible();
  // Open one person's breakdown.
  await page.getByRole('button', { name: 'Demo Owner' }).first().click();
  await expect(page.getByText('Pressure & load')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open full profile →' })).toHaveAttribute('href', /\/tasks\/tasks\?tab=employees&user=\d+/);
  await shot(page, 'web-tasks-team');
});

test('a group is created with a member, and members can be added', async ({ page, request }) => {
  const owner = await token(request);
  const people = (await (await request.get('/tasks/api/leads/assignees/', { headers: auth(owner) })).json()) as Array<{ id: number; name: string }>;
  const others = people.filter((p) => p.name !== 'Demo Owner');
  test.skip(others.length < 2, 'needs two colleagues in the demo company');
  const name = `E2E Group ${Date.now().toString(36)}`;
  let groupId: number | undefined;
  try {
    await signIn(page, '/tasks/groups');
    await page.getByRole('button', { name: 'New group' }).click();
    const dialog = page.getByRole('dialog', { name: 'New group' });
    await dialog.getByLabel('Name *').fill(name);
    await dialog.getByLabel('Category').fill('E2E');
    await dialog.getByRole('button', { name: 'Members' }).click();
    await page.getByRole('checkbox', { name: new RegExp(`^${others[0].name}`) }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Create group' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    groupId = Number(new URL(page.url()).searchParams.get('group'));
    await page.getByRole('group', { name: 'Group sections' }).getByRole('button', { name: 'Members' }).click();
    await expect(page.getByRole('cell', { name: others[0].name, exact: true })).toBeVisible();

    // Add a second member.
    await page.getByRole('button', { name: 'People to add' }).click();
    await page.getByRole('checkbox', { name: new RegExp(`^${others[1].name}`) }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add 1' }).click();
    await expect(page.getByRole('cell', { name: others[1].name, exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'Group sections' }).getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByText('Total tasks', { exact: true })).toBeVisible();
    await shot(page, 'web-tasks-group');
  } finally {
    if (!groupId) {
      const groups = (await (await request.get('/tasks/api/groups/', { headers: auth(owner) })).json()) as Array<{ id: number; name: string }>;
      groupId = groups.find((g) => g.name === name)?.id;
    }
    if (groupId) await request.delete(`/tasks/api/groups/${groupId}/`, { headers: auth(owner) }); // archives it
  }
});

test('a notice is written, published and shows on the board', async ({ page, request }) => {
  const owner = await token(request);
  const title = `E2E notice ${Date.now().toString(36)}`;
  try {
    await signIn(page, '/tasks/notices');
    await page.getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('button', { name: 'New notice' }).click();
    const dialog = page.getByRole('dialog', { name: 'New notice' });
    await dialog.getByLabel('Title *').fill(title);
    await dialog.getByLabel('Content').fill('Office closes early today. Details: https://example.com/notice');
    await dialog.getByLabel('Priority').selectOption('important');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row.getByText('Draft')).toBeVisible();
    await row.getByRole('button', { name: `Publish ${title}` }).click();
    await expect(row.getByText('Published')).toBeVisible();
    await expect(row.getByRole('button', { name: `Send ${title} on WhatsApp` })).toBeVisible();

    await page.getByRole('button', { name: 'Board' }).click();
    const item = page.getByRole('button', { name: new RegExp(title) });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole('link', { name: 'https://example.com/notice' })).toBeVisible();
    await shot(page, 'web-tasks-notices');
  } finally {
    const all = (await (await request.get('/tasks/api/notices/?manage=true', { headers: auth(owner) })).json()) as Array<{ id: number; title: string }>;
    for (const n of all.filter((x) => x.title === title)) await request.delete(`/tasks/api/notices/${n.id}/`, { headers: auth(owner) });
  }
});

test('notifications open their task inside the new app', async ({ page }) => {
  await signIn(page, '/tasks/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const links = page.getByRole('main').getByRole('link', { name: /./ });
  if ((await links.count()) > 0) {
    // Tasks links are relative to /tasks: "/tasks/42" opens "/tasks/tasks/42".
    const href = await links.first().getAttribute('href');
    expect(href).toMatch(/^\/tasks\//);
  } else {
    await expect(page.getByText('Nothing yet')).toBeVisible();
  }
  await shot(page, 'web-tasks-notifications');
});

test('my team lists people with workloads; department and reports-to are edited in People & access', async ({ page }) => {
  await signIn(page, '/tasks/users');
  await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add person in People & access' })).toHaveAttribute('href', '/people');
  await page.getByRole('button', { name: 'Workload of Demo Owner' }).click();
  await expect(page.getByText(/Demo Owner’s pipeline:/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit Demo Owner' }).click();
  const dialog = page.getByRole('dialog', { name: /^Edit / });
  await expect(dialog.getByText('Reports to', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Edit in People & access/ })).toHaveAttribute('href', '/people');
  await expect(dialog.getByLabel('Department')).toHaveCount(0); // read-only, not a field
  await shot(page, 'web-tasks-my-team');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('task settings: a notification rule is switched off and on again', async ({ page, request }) => {
  const owner = await token(request);
  const before = (await (await request.get('/tasks/api/notification-rules/', { headers: auth(owner) })).json()) as Array<{ key: string; label: string; email: boolean }>;
  const rule = before.find((r) => r.key === 'hr') ?? before[0];
  try {
    await signIn(page, '/tasks/settings');
    await expect(page.getByRole('heading', { name: 'Task settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage departments in Settings/ })).toHaveAttribute('href', '/settings');
    const box = page.getByRole('checkbox', { name: `Email: ${rule.label}` });
    await expect(box).toHaveAttribute('aria-checked', String(rule.email));
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', String(!rule.email));
    const saved = (await (await request.get('/tasks/api/notification-rules/', { headers: auth(owner) })).json()) as typeof before;
    expect(saved.find((r) => r.key === rule.key)?.email).toBe(!rule.email);
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', String(rule.email));
    await shot(page, 'web-tasks-settings');
  } finally {
    await request.put('/tasks/api/notification-rules/', { headers: auth(owner), data: { [rule.key]: { email: rule.email } } });
  }
});
