// Phase 6 parity tests for the Admin area of the new web app (PLAN.md §18): People & access, Roles (with duties) and
// Settings (company, modules, departments). Elements are found by role / label / text only. Everything a test creates is
// switched off or put back at the end (departments have no delete; people are deleted only by the permanent-delete test, §19.12).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const stamp = () => Date.now().toString(36);

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

/** Opens `path` signed in (the sign-in page sends us back there). */
async function openSignedIn(page: Page, path: string, login = OWNER.login, password = OWNER.password) {
  await page.goto(path);
  await page.getByLabel('Email, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

interface PersonRow {
  id: string;
  fullName: string;
  status: string;
  departmentId: string | null;
  reportsTo: string | null;
  joinDate: string | null;
  designation: string | null;
  roleIds: string[];
}

test('People & access: list, search, add with department / manager / join date, edit, change roles, start exit, deactivate', async ({ page, request }) => {
  const owner = await token(request);
  const me = await (await request.get('/api/platform/auth/me', { headers: auth(owner) })).json();
  const s = stamp();
  const name = `E2E Web Person ${s}`;
  const deptName = `E2E Web Dept ${s}`;
  const dept = await (await request.post('/api/platform/departments', { headers: auth(owner), data: { name: deptName } })).json();
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; name: string; system: boolean; level: number; grants: Array<{ app: string }> }>;
  const memberRole = roles.find((r) => !r.system && r.level === 1 && r.grants.some((g) => g.app === 'tasks'))!;
  let personId: string | undefined;

  try {
    await openSignedIn(page, '/people');
    await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
    // The list shows the owner.
    await expect(page.getByRole('cell', { name: new RegExp(me.person.fullName) }).first()).toBeVisible();

    // Add a person with a login.
    await page.getByRole('button', { name: 'Add person' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add person' });
    await sheet.getByLabel('Full name').fill(name);
    await sheet.getByLabel('Email').fill(`e2e-web-${s}@freefounders.test`);
    await sheet.getByLabel('Department').selectOption({ label: deptName });
    await sheet.getByLabel('Reports to').selectOption({ label: me.person.fullName });
    await sheet.getByLabel('Joining date').fill('2026-09-01');
    await expect(sheet.getByLabel('Create a login now')).toBeChecked();
    await sheet.getByLabel('Username (optional)').fill(`e2e-web-${s}`);
    await sheet.getByRole('button', { name: 'Save' }).click();

    const ready = page.getByRole('dialog', { name: 'Login ready' });
    await expect(ready).toBeVisible();
    await expect(ready.getByText(`e2e-web-${s}`)).toBeVisible();
    await ready.getByRole('button', { name: 'Done' }).click();

    // Search finds them.
    await page.getByLabel('Search people').fill(s);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2); // header + the one person

    const people = (await (await request.get('/api/platform/people', { headers: auth(owner), params: { search: s } })).json()) as PersonRow[];
    const created = people.find((p) => p.fullName === name)!;
    personId = created.id;
    expect(created.departmentId).toBe(dept.id);
    expect(created.reportsTo).toBe(me.person.id);
    expect(created.joinDate).toBe('2026-09-01');

    // Edit: designation and joining date.
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await expect(edit.getByLabel('Department')).toHaveValue(dept.id);
    await expect(edit.getByLabel('Reports to')).toHaveValue(me.person.id);
    await edit.getByLabel('Designation').fill('Test Engineer');
    await edit.getByLabel('Joining date').fill('2026-09-15');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect
      .poll(async () => {
        const p = ((await (await request.get('/api/platform/people', { headers: auth(owner), params: { search: s } })).json()) as PersonRow[])[0];
        return `${p.designation}|${p.joinDate}`;
      })
      .toBe('Test Engineer|2026-09-15');

    // Change roles: give a Tasks member role; the Tasks app appears.
    await row.getByRole('button', { name: 'Change roles' }).click();
    const rolesDialog = page.getByRole('dialog', { name: `Roles of ${name}` });
    await rolesDialog.getByRole('checkbox', { name: memberRole.name, exact: true }).click();
    await expect(rolesDialog.getByText(/will be able to open: .*Tasks/)).toBeVisible();
    await rolesDialog.getByRole('button', { name: 'Save roles' }).click();
    await expect(rolesDialog).toBeHidden();
    await expect(page.getByLabel(`Roles of ${name}`).getByText(memberRole.name)).toBeVisible();

    // Start exit: the dialog asks for the last working day (cancelled here: it would open real exit cases).
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Start exit' }).click();
    const exit = page.getByRole('dialog', { name: `Exit: ${name}` });
    await expect(exit.getByRole('button', { name: 'Start exit' })).toBeDisabled();
    await exit.getByLabel('Last working day').fill('2026-12-31');
    await expect(exit.getByRole('button', { name: 'Start exit' })).toBeEnabled();
    await exit.getByRole('button', { name: 'Cancel' }).click();
    await expect(exit).toBeHidden();

    // Deactivate (with a confirmation).
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByRole('dialog', { name: `Deactivate ${name}?` }).getByRole('button', { name: 'Deactivate' }).click();
    await expect(row.getByText('Inactive')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Change roles' })).toBeDisabled();
  } finally {
    if (personId) await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    await request.patch(`/api/platform/departments/${dept.id}`, { headers: auth(owner), data: { active: false } });
  }
});

test('Roles: new role with a scoped permission and a duty, saved, then archived', async ({ page, request }) => {
  const owner = await token(request);
  const catalogue = (await (await request.get('/api/platform/roles/catalogue', { headers: auth(owner) })).json()) as Array<{
    app: string;
    permissions: Array<{ key: string; label: string; scopes: string[] | null; superAdminOnly?: boolean }>;
  }>;
  const perm = catalogue.find((c) => c.app === 'tasks')!.permissions.find((p) => p.scopes?.includes('team') && !p.superAdminOnly)!;
  const roleName = `E2E Web Role ${stamp()}`;

  try {
    await openSignedIn(page, '/roles');
    await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New role' }).click();
    const editor = page.getByRole('dialog', { name: 'New role' });
    await editor.getByLabel('Name').fill(roleName);
    await editor.getByLabel('Level').selectOption({ label: 'Manager' });

    const box = editor.getByRole('checkbox', { name: `Tasks: ${perm.label}`, exact: true });
    await box.click();
    await expect(box).toBeChecked();
    const scope = editor.getByRole('radiogroup', { name: `Scope for ${perm.label}` });
    await expect(scope.getByRole('radio', { name: 'Own' })).toHaveAttribute('aria-checked', 'true'); // starts narrow
    await scope.getByRole('radio', { name: 'Team' }).click();
    await expect(scope.getByRole('radio', { name: 'Team' })).toHaveAttribute('aria-checked', 'true');

    await editor.getByRole('button', { name: 'Add duty' }).click();
    await editor.getByLabel('Duty 1 title').fill('Check the stock register');
    await editor.getByLabel('Duty 1 frequency').selectOption('weekly');
    await editor.getByLabel('Day', { exact: true }).selectOption({ label: 'Friday' }); // not the Holidays permissions
    await editor.getByLabel('Steps (one per line, optional)').fill('Count\nSign');
    await editor.getByRole('button', { name: 'Save role' }).click();
    await expect(editor).toBeHidden();

    const row = page.getByRole('row', { name: new RegExp(roleName) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Manager')).toBeVisible();

    const saved = ((await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{
      name: string;
      level: number;
      grants: Array<{ app: string; permission: string; scope: string }>;
      duties?: Array<{ title: string; frequency: string; weekday: number | null; steps: string[] }>;
    }>).find((r) => r.name === roleName)!;
    expect(saved.level).toBe(2);
    expect(saved.grants).toEqual([{ app: 'tasks', permission: perm.key, scope: 'team' }]);
    expect(saved.duties?.[0]).toMatchObject({ title: 'Check the stock register', frequency: 'weekly', weekday: 4, steps: ['Count', 'Sign'] });

    // Opening it again shows what was saved.
    await row.getByRole('button', { name: `Edit ${roleName}` }).click();
    const again = page.getByRole('dialog', { name: `Edit ${roleName}` });
    await expect(again.getByRole('checkbox', { name: `Tasks: ${perm.label}`, exact: true })).toBeChecked();
    await expect(again.getByLabel('Duty 1 title')).toHaveValue('Check the stock register');
    await again.getByRole('button', { name: 'Cancel' }).click();

    // Archive (with a confirmation).
    await row.getByRole('button', { name: `Archive ${roleName}` }).click();
    await page.getByRole('dialog', { name: `Archive "${roleName}"?` }).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('row', { name: new RegExp(roleName) })).toHaveCount(0);
  } finally {
    const left = ((await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; name: string }>).find((r) => r.name === roleName);
    if (left) await request.delete(`/api/platform/roles/${left.id}`, { headers: auth(owner) });
  }
});

test('Settings: save the company, flip a module switch, add and rename a department', async ({ page, request }) => {
  const owner = await token(request);
  const before = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
  const leadsBefore: boolean = before.modules.find((m: { app: string }) => m.app === 'tasks')?.modules.find((m: { key: string }) => m.key === 'leads')?.on ?? true;
  const s = stamp();
  const deptName = `E2E Web Settings ${s}`;
  const renamed = `E2E Web Renamed ${s}`;

  try {
    await openSignedIn(page, '/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    // Company.
    const company = page.getByRole('region', { name: 'Company' });
    await company.getByLabel('Short name (menus and titles)').fill(`Demo ${s}`);
    await company.getByLabel('Brand colour code').fill('#0f7b5f');
    await company.getByRole('button', { name: 'Save company' }).click();
    await expect(company.getByRole('status')).toHaveText('Saved');
    const after = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
    expect(after.shortName).toBe(`Demo ${s}`);
    expect(after.colour).toBe('#0f7b5f');
    // The shell shows the new short name.
    await expect(page.getByRole('complementary').getByText(`Demo ${s}`)).toBeVisible();

    // A module switch follows the saved value.
    const leads = page.getByRole('switch', { name: 'Tasks: Leads & quotations' });
    await expect(leads).toHaveAttribute('aria-checked', String(leadsBefore));
    await leads.click();
    await expect(leads).toHaveAttribute('aria-checked', String(!leadsBefore));
    await expect(leads).toBeEnabled();
    await leads.click();
    await expect(leads).toHaveAttribute('aria-checked', String(leadsBefore));

    // Departments: add, then rename.
    const depts = page.getByRole('region', { name: 'Departments' });
    await depts.getByLabel('New department').fill(deptName);
    await depts.getByRole('button', { name: 'Add department' }).click();
    await expect(depts.getByText(deptName, { exact: true })).toBeVisible();
    await depts.getByRole('button', { name: `Rename ${deptName}` }).click();
    await depts.getByLabel(`New name for ${deptName}`).fill(renamed);
    await depts.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(depts.getByText(renamed, { exact: true })).toBeVisible();
    await expect(depts.getByText(deptName, { exact: true })).toHaveCount(0);
    await depts.getByRole('button', { name: `Deactivate ${renamed}` }).click();
    await expect(depts.getByRole('button', { name: `Activate ${renamed}` })).toBeVisible();

    // App settings link into each app.
    await expect(page.getByRole('link', { name: /Task rules/ })).toHaveAttribute('href', '/tasks/settings');
  } finally {
    await request.patch('/api/platform/company', { headers: auth(owner), data: { shortName: before.shortName, colour: before.colour } });
    await request.put('/api/platform/company/modules', { headers: auth(owner), data: { tasks: { leads: leadsBefore } } });
    const list = (await (await request.get('/api/platform/departments', { headers: auth(owner) })).json()) as Array<{ id: string; name: string; active: boolean }>;
    for (const d of list.filter((x) => (x.name === deptName || x.name === renamed) && x.active)) {
      await request.patch(`/api/platform/departments/${d.id}`, { headers: auth(owner), data: { active: false } });
    }
  }
});

test('people who are not admins cannot open the admin screens', async ({ page, request }) => {
  const owner = await token(request);
  const s = stamp();
  const login = `e2e-web-member-${s}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Web Member ${s}`, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id;
  try {
    const first = await token(request, login, temp);
    expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();

    await openSignedIn(page, '/people', login, password);
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect(page.getByRole('heading', { name: 'People & access' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page).toHaveURL((url) => url.pathname === '/');
  } finally {
    await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});

test('People: reset with a typed password (shown once), they sign in with it, then delete them permanently', async ({ page, request, browser }) => {
  const owner = await token(request);
  const s = stamp();
  const name = `E2E Web Delete ${s}`;
  const login = `e2e-web-del-${s}`;
  const chosen = `pw${s}`.slice(0, 10); // 6+ characters, the new minimum
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  let deleted = false;

  try {
    await openSignedIn(page, '/people');
    await page.getByLabel('Search people').fill(s);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();

    // ⋯ → Reset password: type one, untick "Ask them to change it".
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Reset password' }).click();
    const reset = page.getByRole('dialog', { name: `Reset password — ${name}` });
    await expect(reset.getByLabel('Type a password')).toBeChecked();
    await expect(reset.getByRole('button', { name: 'Save password' })).toBeDisabled();
    await reset.getByLabel('New password').fill('abc12');
    await expect(reset.getByText('At least 6 characters')).toBeVisible();
    await expect(reset.getByRole('button', { name: 'Save password' })).toBeDisabled();
    await reset.getByLabel('New password').fill(chosen);
    await expect(reset.getByLabel('New password')).toHaveAttribute('type', 'password');
    await reset.getByRole('button', { name: 'Show password' }).click();
    await expect(reset.getByLabel('New password')).toHaveAttribute('type', 'text');
    const ask = reset.getByLabel('Ask them to change it at next sign-in');
    await expect(ask).toBeChecked();
    await ask.click();
    await expect(ask).not.toBeChecked();
    await reset.getByRole('button', { name: 'Save password' }).click();

    // Shown once: the password, Copy, Share on WhatsApp, the note.
    await expect(reset.getByTestId('new-password')).toHaveText(chosen);
    await expect(reset.getByRole('button', { name: 'Copy' })).toBeVisible();
    const share = await reset.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href');
    expect(share).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(share!.split('text=')[1])).toContain(`username ${login} password ${chosen}`);
    await expect(reset.getByText("Copy it now — it can't be shown again. You can always set a new one.")).toBeVisible();
    await reset.getByRole('button', { name: 'Done' }).click();
    await expect(reset).toBeHidden();
    // Opening it again shows a fresh form, not the password.
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Reset password' }).click();
    await expect(reset.getByText(chosen)).toHaveCount(0);
    await reset.getByRole('button', { name: 'Cancel' }).click();

    // They sign in with it in a fresh browser, and are not asked to change it.
    const ctx = await browser.newContext();
    try {
      const them = await ctx.newPage();
      await openSignedIn(them, '/', login, chosen);
      await expect(them).toHaveURL((url) => url.pathname === '/');
      await expect(them.getByLabel('Email, username or employee ID')).toHaveCount(0);
      await expect(them.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }

    // ⋯ → Delete permanently: enabled only once their full name is typed.
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
    const del = page.getByRole('dialog', { name: `Delete ${name} permanently?` });
    // Defaults: keep and hand over. They have no manager, so nobody is picked for their tasks yet.
    await expect(del.getByText('Their sign-in and personal details are erased; their work is kept or handed over.')).toBeVisible();
    await expect(del.getByRole('group', { name: 'Their history' }).getByRole('radio', { name: "Keep it, shown as ‘Deleted user’" })).toBeChecked();
    await expect(del.getByRole('group', { name: 'Assets they hold' }).getByRole('radio', { name: 'Return to stock' })).toBeChecked();
    await del.getByLabel('Type their full name to confirm').fill(name);
    const go = del.getByRole('button', { name: 'Delete permanently' });
    await expect(go).toBeDisabled(); // their open tasks need someone (or "Delete them")
    await del.getByLabel('Type their full name to confirm').fill('');
    // Erase everything instead.
    await del.getByRole('group', { name: 'Their open tasks' }).getByRole('radio', { name: 'Delete them' }).check();
    const leads = del.getByRole('group', { name: 'Their leads' });
    if (await leads.count()) await leads.getByRole('radio', { name: /^Delete them/ }).check();
    await del.getByRole('group', { name: 'Their history' }).getByRole('radio', { name: 'Delete it all' }).check();
    await expect(del.getByText('This cannot be undone. Reports for past months will change.')).toBeVisible();
    await expect(go).toBeDisabled();
    await del.getByLabel('Type their full name to confirm').fill(name.slice(0, -1));
    await expect(go).toBeDisabled();
    await del.getByLabel('Type their full name to confirm').fill(name.toLowerCase());
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    deleted = true;
    await expect(del).toBeHidden();
    await expect(row).toHaveCount(0);

    // Gone from the Platform, and their sign-in fails.
    const left = (await (await request.get('/api/platform/people', { headers: auth(owner), params: { search: s } })).json()) as PersonRow[];
    expect(left.some((p) => p.id === personId)).toBe(false);
    const signIn = await request.post('/api/platform/auth/login', { data: { login, password: chosen, client: 'mobile' }, headers: XRW });
    expect(signIn.status()).toBe(401);
  } finally {
    if (!deleted) await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});

test('People: delete with the defaults hands their open task to their manager', async ({ page, request }) => {
  const owner = await token(request);
  const me = await (await request.get('/api/platform/auth/me', { headers: auth(owner) })).json();
  const ownerTasks = await (await request.get('/tasks/api/auth/me', { headers: auth(owner) })).json();
  const s = stamp();
  const name = `E2E Web Handover ${s}`;
  const login = `e2e-web-ho-${s}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, reportsTo: me.person.id, login: { username: login, password: 'Hand@123' } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  let taskId: number | undefined;
  let deleted = false;
  try {
    const granted = await request.put(`/api/platform/people/${personId}/apps/tasks`, { headers: auth(owner), data: {} });
    expect(granted.ok(), await granted.text()).toBeTruthy();
    const theirTasksId = Number((await granted.json()).localUserId);
    const task = await request.post('/tasks/api/tasks/', {
      headers: auth(owner),
      data: { title: `E2E handover ${s}`, assigned_to: theirTasksId, priority: 'low', effort_minutes: 15, due_at: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(task.status(), await task.text()).toBe(201);
    taskId = (await task.json()).id;

    await openSignedIn(page, '/people');
    await page.getByLabel('Search people').fill(s);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
    const del = page.getByRole('dialog', { name: `Delete ${name} permanently?` });
    const tasks = del.getByRole('group', { name: 'Their open tasks' });
    await expect(tasks.getByRole('radio', { name: 'Hand over to' })).toBeChecked();
    await expect(tasks.getByRole('button', { name: 'Hand over to' })).toContainText(me.person.fullName); // their manager
    await expect(del.getByText('Their sign-in and personal details are erased; their work is kept or handed over.')).toBeVisible();
    await del.getByLabel('Type their full name to confirm').fill(name);
    await del.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByText(`${name} deleted`)).toBeVisible({ timeout: 30_000 });
    deleted = true;
    await expect(row).toHaveCount(0);

    // The open task now belongs to the manager.
    const after = await (await request.get(`/tasks/api/tasks/${taskId}/`, { headers: auth(owner) })).json();
    const assignee = typeof after.assigned_to === 'object' && after.assigned_to ? after.assigned_to.id : after.assigned_to;
    expect(assignee).toBe(ownerTasks.id);
    const signIn = await request.post('/api/platform/auth/login', { data: { login, password: 'Hand@123', client: 'mobile' }, headers: XRW });
    expect(signIn.status()).toBe(401);
  } finally {
    if (taskId) await request.delete(`/tasks/api/tasks/${taskId}/`, { headers: auth(owner) });
    if (!deleted) await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
  }
});

test('People: the owner and yourself cannot be deleted', async ({ page, request }) => {
  const owner = await token(request);
  const me = await (await request.get('/api/platform/auth/me', { headers: auth(owner) })).json();
  await openSignedIn(page, '/people');
  await page.getByLabel('Search people').fill(me.person.fullName);
  const row = page.getByRole('row', { name: new RegExp(me.person.fullName) }).first();
  await row.getByRole('button', { name: `More actions for ${me.person.fullName}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Reset password' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete permanently' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const res = await request.delete(`/api/platform/people/${me.person.id}`, { headers: auth(owner), data: { confirm: me.person.fullName } });
  expect(res.status()).toBe(400);
});

// ─── §19.19: every feature is a permission ─────────────────────────────────────────────────────────────────────────

/** A person with a login (password already changed) holding exactly these roles. */
async function personWithRoles(request: APIRequestContext, owner: string, s: string, roleIds: string[]) {
  const login = `e2e-perm-${s}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Perm ${s}`, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const given = await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds } });
  expect(given.ok(), await given.text()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();
  return { personId, login, password };
}

test('Roles: any role from blank — only Live attendance and Notices; they see exactly that; the API refuses the rest; Copy from; the level hint', async ({ page, request }) => {
  const owner = await token(request);
  const s = stamp();
  const roleName = `E2E Live and notices ${s}`;
  let roleId: string | undefined;
  let personId: string | undefined;
  try {
    await openSignedIn(page, '/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const editor = page.getByRole('dialog', { name: 'New role' });

    // The hint says what the chosen level does.
    const level = editor.getByLabel('Level');
    await expect(editor.getByText('Uses the apps with exactly the permissions ticked below.')).toBeVisible();
    await level.selectOption({ label: 'Manager' });
    await expect(editor.getByText(/Same as Member: the ticked permissions decide/)).toBeVisible();
    await level.selectOption({ label: 'Admin' });
    await expect(editor.getByText(/Also an administrator in Tasks/)).toBeVisible();
    await level.selectOption({ label: 'Member' });

    // Saving without a name says why.
    await editor.getByRole('button', { name: 'Save role' }).click();
    await expect(editor.getByRole('alert').filter({ hasText: 'Give the role a name' })).toBeVisible();

    // Copy from another role ticks its permissions; Blank clears them.
    const seeTasks = editor.getByRole('checkbox', { name: 'Tasks: See tasks', exact: true });
    await editor.getByLabel('Start from').selectOption({ label: 'Copy from Rider' });
    await expect(seeTasks).toBeChecked();
    await expect(editor.getByRole('checkbox', { name: 'Tasks: Punch in and out', exact: true })).toBeChecked();
    await editor.getByLabel('Start from').selectOption({ label: 'Blank: nothing ticked' });
    await expect(seeTasks).not.toBeChecked();

    // Search, then tick exactly two permissions; each shows its description.
    const search = editor.getByLabel('Search permissions');
    await search.fill('live attendance');
    await expect(editor.getByText('Who is in, late or not in yet, right now.')).toBeVisible();
    await expect(seeTasks).toHaveCount(0);
    await editor.getByRole('checkbox', { name: 'Tasks: Live attendance', exact: true }).click();
    await expect(editor.getByRole('radiogroup', { name: 'Scope for Live attendance' }).getByRole('radio', { name: 'Team' })).toHaveAttribute('aria-checked', 'true');
    await search.fill('see notices');
    await editor.getByRole('checkbox', { name: 'Tasks: See notices', exact: true }).click();
    await search.fill('');
    await editor.getByLabel('Name', { exact: true }).fill(roleName);
    await editor.getByRole('button', { name: 'Save role' }).click();
    await expect(editor).toBeHidden();

    const saved = ((await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; name: string; grants: Array<{ app: string; permission: string; scope: string }> }>).find(
      (r) => r.name === roleName,
    )!;
    roleId = saved.id;
    expect(saved.grants.map((g) => `${g.app}:${g.permission}@${g.scope}`).sort()).toEqual(['tasks:hr.live@team', 'tasks:notices.view@']);

    // They see exactly those (and Today); nothing else, and no Admin workspace.
    const who = await personWithRoles(request, owner, s, [roleId]);
    personId = who.personId;
    await page.context().clearCookies();
    await openSignedIn(page, '/attendance', who.login, who.password);
    const attendance = page.getByRole('navigation', { name: 'Attendance menu' });
    await expect(attendance.getByRole('link', { name: 'Live attendance' })).toBeVisible();
    await expect(attendance.getByRole('link', { name: 'Today' })).toBeVisible();
    for (const hidden of ['My attendance', 'My leave', 'Holidays', 'Daily attendance', 'Dashboard', 'Reports', 'Approvals', 'Payroll', 'HR settings']) {
      await expect(attendance.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Show Tasks menu' }).click();
    const tasks = page.getByRole('navigation', { name: 'Tasks menu' });
    await expect(tasks.getByRole('link', { name: 'Notices' })).toBeVisible();
    for (const hidden of ['Notifications', 'Team performance', 'Task settings', 'Mistakes', 'Forms', 'Links', 'Idea board']) {
      await expect(tasks.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'People & access' })).toHaveCount(0);

    // The API agrees.
    const theirs = await token(request, who.login, who.password);
    expect((await request.get('/tasks/api/attendance/team_day/', { headers: auth(theirs) })).status()).toBe(200);
    expect((await request.get('/tasks/api/notices/', { headers: auth(theirs) })).status()).toBe(200);
    expect((await request.get('/tasks/api/hr/settings/', { headers: auth(theirs) })).status()).toBe(403);
    expect((await request.get('/tasks/api/leaves/balances/', { headers: auth(theirs) })).status()).toBe(403);
    expect((await request.post('/tasks/api/attendance/check_in/', { headers: auth(theirs), data: {} })).status()).toBe(403);
    expect((await request.get('/api/platform/people', { headers: auth(theirs) })).status()).toBe(403);
  } finally {
    if (personId) await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    if (roleId) await request.delete(`/api/platform/roles/${roleId}`, { headers: auth(owner) });
  }
});

test('Admin permissions: a member with only "Manage people" gets People & access and nothing else of Admin', async ({ page, request }) => {
  const owner = await token(request);
  const s = stamp();
  const role = await request.post('/api/platform/roles', {
    headers: auth(owner),
    data: { name: `E2E People desk ${s}`, level: 1, grants: [{ app: 'platform', permission: 'people.manage' }] },
  });
  expect(role.status(), await role.text()).toBe(201);
  const roleId = (await role.json()).id as string;
  let personId: string | undefined;
  try {
    const who = await personWithRoles(request, owner, `${s}a`, [roleId]);
    personId = who.personId;
    await openSignedIn(page, '/roles', who.login, who.password);
    // Roles is not theirs: they land on the Admin screen they may open.
    await expect(page).toHaveURL((url) => url.pathname === '/people');
    await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add person' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Change roles/ })).toHaveCount(0);
    const admin = page.getByRole('navigation', { name: 'Admin menu' });
    await expect(admin.getByRole('link', { name: 'People & access' })).toBeVisible();
    await expect(admin.getByRole('link', { name: 'Roles' })).toHaveCount(0);
    await expect(admin.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page).toHaveURL((url) => url.pathname === '/people');
    const theirs = await token(request, who.login, who.password);
    expect((await request.patch('/api/platform/company', { headers: auth(theirs), data: { shortName: 'Nope' } })).status()).toBe(403);
  } finally {
    if (personId) await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    await request.delete(`/api/platform/roles/${roleId}`, { headers: auth(owner) });
  }
});
