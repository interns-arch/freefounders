// Uniform check at punch-in (PLAN.md §19.27, §19.36). HR switches the rule on HR settings → "Uniform at punch-in"
// (Off / Reminder only / Must confirm) while an employee already has the punch screen open: the next check-in still asks
// (the punch reads today's rules fresh at the tap). "Must confirm": Cancel stops the punch, No blocks it with "Please
// wear the company shirt / jersey, then punch in.", Yes punches in and is shown on Daily attendance. "Reminder only" from
// the Home card inside the phone app (fake native bridge): OK punches in. The API refuses uniform=false in Must confirm.
// The settings and the people made here are put back / switched off at the end.
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png` });
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, login: string, password: string) {
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** A new person with the built-in Member role (PLAN.md §19.28) who has set their own password. */
async function newMember(request: APIRequestContext, owner: string, tag: string) {
  const stamp = Date.now().toString(36);
  const login = `e2e-uni-${tag}-${stamp}`;
  const name = `E2E Uniform ${tag} ${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
  const member = roles.find((r) => r.code === 'ff_member')!;
  expect((await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [member.id] } })).ok()).toBeTruthy();
  const first = await token(request, login, temp);
  expect((await request.post('/api/platform/auth/change-password', { headers: auth(first), data: { currentPassword: temp, newPassword: password } })).ok()).toBeTruthy();
  return {
    login,
    password,
    name,
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

/** The Android shell (PLAN.md §19.17): the app marker and a fake bridge that answers location and the camera. */
async function appContext(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.FreeFoundersApp = { platform: 'android', version: 'e2e', camera: 'granted' };
    const reply = (r: unknown) => setTimeout(() => document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(r) })), 30);
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const m = JSON.parse(raw) as { id?: string; type: string };
        if (!m.id) return;
        if (m.type === 'location') return reply({ id: m.id, ok: true, data: { latitude: 12.9716, longitude: 77.5946, accuracy: 8 } });
        if (m.type === 'photo') return reply({ id: m.id, ok: true, data: null });
        if (m.type.startsWith('reminder')) return reply({ id: m.id, ok: true, data: { settings: null, permission: 'granted', next: null, skipped: null } });
        return reply({ id: m.id, ok: false, error: `unknown ${m.type}` });
      },
    };
  });
  return ctx;
}

test('uniform rule switched on while the punch screen is open still asks; Must confirm: No blocks, Yes punches in', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const keys = ['photo', 'geofence_enabled', 'uniform_check', 'uniform_message'];
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'off', geofence_enabled: false, uniform_check: 'off' } })).ok()).toBeTruthy();
  const people: Array<{ remove: () => Promise<void> }> = [];
  try {
    const a = await newMember(request, owner, 'a');
    people.push(a);
    const b = await newMember(request, owner, 'b');
    people.push(b);

    // The employee opens Today while the company does not ask yet.
    const desk = await browser.newContext({ colorScheme: 'light' });
    const page = await desk.newPage();
    await page.goto('/');
    await signIn(page, a.login, a.password);
    await page.goto('/attendance');
    await expect(page.getByRole('button', { name: 'Check in' })).toBeEnabled();

    // HR switches to "Must confirm" on the settings screen.
    const ownerCtx = await browser.newContext();
    const hr = await ownerCtx.newPage();
    await hr.goto('/');
    await signIn(hr, OWNER.login, OWNER.password);
    await hr.goto('/attendance/settings');
    const card = hr.getByRole('form', { name: 'Uniform at punch-in' });
    await expect(card.getByText('Must confirm asks Yes / No', { exact: false })).toBeVisible();
    await expect(card.getByText('Yes punches in, No blocks')).toBeVisible();
    await card.getByText('Must confirm', { exact: true }).click();
    await expect(card.getByRole('radio', { name: 'Must confirm' })).toBeChecked();
    await card.getByLabel('Message').fill('Are you wearing the company jersey today?');
    await card.getByRole('button', { name: 'Save uniform check' }).click();
    await expect(card.getByRole('status')).toHaveText('Saved');
    await card.scrollIntoViewIfNeeded();
    await shot(hr, 'web-uniform-settings');

    // The same open screen (no reload): the check-in asks. Cancel stops it.
    await page.getByRole('button', { name: 'Check in' }).click();
    const dialog = page.getByRole('dialog', { name: 'Company uniform' });
    await expect(dialog.getByText('Are you wearing the company jersey today?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // "No" blocks the punch; nothing is saved.
    await page.getByRole('button', { name: 'Check in' }).click();
    await dialog.getByRole('button', { name: 'No', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Please wear the company shirt / jersey, then punch in.');
    await expect(dialog.getByRole('button', { name: 'No', exact: true })).toBeHidden();
    await page.waitForTimeout(400);
    await shot(page, 'web-uniform-blocked');
    const at = await token(request, a.login, a.password);
    expect((await (await request.get('/tasks/api/attendance/today/', { headers: auth(at) })).json()).attendance).toBeNull();
    // The API refuses "No" too (an app cannot get round the dialog).
    const refused = await request.post('/tasks/api/attendance/check_in/', { headers: auth(at), data: { uniform: false } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe('uniform_not_worn');

    // Wearing it now: Yes punches in.
    await dialog.getByRole('button', { name: /Yes, I.m wearing it/ }).click();
    await expect(page.getByText('Checked in ✅')).toBeVisible();
    const today = await (await request.get('/tasks/api/attendance/today/', { headers: auth(at) })).json();
    expect(today.attendance.uniform_ok).toBe(true);
    await desk.close();

    // HR sees it on Daily attendance.
    await hr.goto('/attendance/daily');
    await hr.getByLabel('Search staff').fill(a.login);
    await expect(hr.getByRole('columnheader', { name: 'Uniform' })).toBeVisible();
    const row = hr.getByRole('row', { name: new RegExp(a.name) });
    await expect(row.getByRole('cell', { name: 'Yes', exact: true })).toBeVisible();
    await shot(hr, 'web-uniform-daily');

    // Phone app, Home card: the screen is open with "Must confirm", HR changes it to "Reminder only" → OK punches in.
    const app = await appContext(browser);
    const mp = await app.newPage();
    await mp.goto('/');
    await signIn(mp, b.login, b.password);
    await mp.goto('/?home=1');
    await expect(mp.getByRole('button', { name: 'Punch in' })).toBeEnabled();
    expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { uniform_check: 'remind' } })).ok()).toBeTruthy();
    await mp.getByRole('button', { name: 'Punch in' }).click();
    const remind = mp.getByRole('dialog', { name: 'Uniform reminder' });
    await expect(remind.getByRole('button', { name: 'OK, punch in' })).toBeVisible();
    await mp.waitForTimeout(400);
    await shot(mp, 'web-uniform-reminder-app');
    await remind.getByRole('button', { name: 'OK, punch in' }).click();
    await expect(mp.getByText('Checked in ✅')).toBeVisible();
    const bt = await token(request, b.login, b.password);
    const bToday = await (await request.get('/tasks/api/attendance/today/', { headers: auth(bt) })).json();
    expect(bToday.attendance.check_in).toBeTruthy();
    expect(bToday.attendance.uniform_ok).toBeNull();
    await app.close();
    await ownerCtx.close();
  } finally {
    const restore = Object.fromEntries(keys.map((k) => [k, before[k]?.custom ? before[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    for (const p of people) await p.remove();
  }
});
