// Phase 6 parity tests for the Admin area of the new web app (PLAN.md §18): People & access, Roles (with duties) and
// Settings (company, modules, departments). Elements are found by role / label / text only. Everything a test creates is
// switched off or put back at the end (the Platform has no hard delete for people or departments).
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
    await editor.getByLabel('Day').selectOption({ label: 'Friday' });
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
