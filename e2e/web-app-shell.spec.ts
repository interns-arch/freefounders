// The phone app = this web app inside a native shell (PLAN.md §19.17). These tests play the shell: before the page loads
// they set `window.FreeFoundersApp` and a fake `window.ReactNativeWebView.postMessage` that answers the bridge requests
// the way apps/mobile does (replies dispatched on `document`, like Android's WebView). They prove that inside the app the
// punch uses the app's camera (no browser camera dialog) and stores the photo, that face check can no longer be switched
// on (PLAN.md §19.18), and that downloads go to the app instead of the browser. Settings are restored afterwards.
import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test';

/** The company may ask "Are you wearing the uniform?" before a check-in (HR setting, PLAN.md uniform check): answer Yes. */
async function answerUniform(page: Page) {
  const yes = page.getByRole('button', { name: /Yes, I.m wearing it/ });
  await yes.waitFor({ timeout: 2000 }).then(() => yes.click()).catch(() => {});
}


const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

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

/** A new person with a Tasks member role who has set their own password. */
async function newPerson(request: APIRequestContext, owner: string) {
  const stamp = Date.now().toString(36);
  const login = `e2e-shell-${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const name = `E2E Shell ${stamp}`;
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: name, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; level: number; system: boolean; grants: Array<{ app: string }> }>;
  const member = roles.find((r) => (r as { code?: string }).code === 'ff_member')!; // the built-in Member (PLAN.md §19.28)
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

type Logged = { type?: string; id?: string; title?: string; optional?: boolean; filename?: string; mime?: string; base64?: string; lang?: string };

/** A context that looks like the Android shell: phone size, the app marker and a fake native bridge. */
async function shellContext(browser: Browser, opts: { locationBlocked?: boolean; version?: string } = {}) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(({ blocked, version }: { blocked: boolean; version: string }) => {
    const w = window as unknown as Record<string, unknown>;
    const log: unknown[] = [];
    w.__shellLog = log;
    w.FreeFoundersApp = { platform: 'android', version, camera: 'granted' };
    const reply = (r: unknown) => setTimeout(() => document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(r) })), 30);
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const m = JSON.parse(raw) as { id?: string; type: string };
        log.push(m);
        if (!m.id) return;
        if (m.type === 'location')
          return blocked
            ? reply({ id: m.id, ok: false, error: 'Location is blocked for this app.', code: 'permission', permission: 'location', settings: true })
            : reply({ id: m.id, ok: true, data: { latitude: 12.9716, longitude: 77.5946, accuracy: 6 } });
        if (m.type === 'open-settings') return reply({ id: m.id, ok: true, data: null });
        if (m.type === 'photo') {
          // What the app's front camera hands back: a real JPEG as a data URL.
          const c = document.createElement('canvas');
          c.width = 48;
          c.height = 64;
          const g = c.getContext('2d')!;
          g.fillStyle = 'teal';
          g.fillRect(0, 0, 48, 64);
          return reply({ id: m.id, ok: true, data: c.toDataURL('image/jpeg', 0.6) });
        }
        if (m.type === 'download') return reply({ id: m.id, ok: true, data: { saved: true } });
        // the phone's speech recogniser (app 1.1.0+), after Android's microphone pop-up
        if (m.type === 'voice') return reply({ id: m.id, ok: true, data: { text: 'stock check karna hai kal 5 baje tak 30 minute' } });
        if (m.type === 'voice-stop') return reply({ id: m.id, ok: true, data: { stopped: true } });
        return reply({ id: m.id, ok: false, error: `unknown ${m.type}` });
      },
    };
  }, { blocked: !!opts.locationBlocked, version: opts.version ?? 'e2e' });
  return ctx;
}

const shellLog = (page: Page) => page.evaluate(() => (window as unknown as { __shellLog: Logged[] }).__shellLog.map((m) => ({ ...m, base64: m.base64?.slice(0, 8) })));

test('in the app: punch with the app camera (photo stored); face check cannot be switched on', async ({ browser, request }) => {
  const owner = await token(request);
  const hrBefore = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const restore = Object.fromEntries(['photo', 'geofence_enabled'].map((k) => [k, hrBefore[k].custom ? hrBefore[k].value : '']));
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'required', geofence_enabled: false} })).ok()).toBeTruthy();
  const person = await newPerson(request, owner);
  try {
    const ctx = await shellContext(browser);
    const page = await ctx.newPage();
    await page.goto('/');
    await signIn(page, person.login, person.password);
    await expect(page).toHaveURL(/\/attendance/); // phones land on Attendance
    await expect(page.getByText('A photo is taken at every check-in and check-out.')).toBeVisible();

    await page.getByRole('button', { name: 'Check in' }).click(); await answerUniform(page);
    await expect(page.getByText('Checked in ✅')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); // no browser camera dialog
    const log = await shellLog(page);
    expect(log.filter((m) => m.type === 'photo')).toEqual([expect.objectContaining({ type: 'photo', title: 'Check in', optional: false })]);
    expect(log.some((m) => m.type === 'location')).toBe(false); // no geofence → the app does not ask for the location

    // Face check was removed (PLAN.md §19.18): it cannot be switched on, and the check-out is a selfie again.
    const on = await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { face_enabled: true } });
    expect(on.status()).toBe(400);
    expect((await on.json()).face_enabled).toMatch(/removed/);
    await page.reload();
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByText('Checked out ✅')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await shellLog(page)).filter((m) => m.type === 'photo')).toHaveLength(1);
    await ctx.close();

    // The selfie from the app is stored with the check-in (the photo HR sees in Team).
    const mine = await token(request, person.login, person.password);
    const today = await (await request.get('/tasks/api/attendance/today/', { headers: auth(mine) })).json();
    expect(today.attendance?.check_in).toBeTruthy();
    const photo = await request.get(`/tasks/api/attendance/${today.attendance.id}/photo/in/`, { headers: auth(owner) });
    expect(photo.ok(), await photo.text()).toBeTruthy();
    const bytes = await photo.body();
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a JPEG
  } finally {
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await person.remove();
  }
});

test('in the app: a report download goes to the app, not the browser', async ({ browser }) => {
  const ctx = await shellContext(browser);
  const page = await ctx.newPage();
  let browserDownloads = 0;
  page.on('download', () => browserDownloads++);
  await page.goto('/');
  await signIn(page, OWNER.login, OWNER.password);
  await page.goto('/attendance/reports');
  await page.getByLabel('Report type').selectOption('daily');
  const date = await page.getByLabel('Date', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(async () => (await shellLog(page)).filter((m) => m.type === 'download')).toEqual([
    expect.objectContaining({
      type: 'download',
      filename: `attendance-daily-${date}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: expect.stringMatching(/^UEs/), // "PK": a real XLSX (zip)
    }),
  ]);
  expect(browserDownloads).toBe(0);
  await ctx.close();
});

test('location blocked → an Allow button: the app opens its Settings; the browser asks again', async ({ browser, request }) => {
  const owner = await token(request);
  const hrBefore = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const restore = Object.fromEntries(['photo', 'geofence_enabled'].map((k) => [k, hrBefore[k].custom ? hrBefore[k].value : '']));
  expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'off', geofence_enabled: true} })).ok()).toBeTruthy();
  const person = await newPerson(request, owner);
  try {
    // In the app: the phone blocked location for good → "Open settings to allow location" asks the app to open Settings.
    const ctx = await shellContext(browser, { locationBlocked: true });
    const page = await ctx.newPage();
    await page.goto('/');
    await signIn(page, person.login, person.password);
    await expect(page).toHaveURL(/\/attendance/);
    await page.getByRole('button', { name: 'Check in' }).click(); await answerUniform(page);
    await expect(page.getByText('Location is blocked for this app.')).toBeVisible();
    await page.getByRole('button', { name: 'Open settings to allow location' }).click();
    await expect.poll(async () => (await shellLog(page)).some((m) => m.type === 'open-settings')).toBe(true);
    await ctx.close();

    // In a browser that refused location: "Allow location" tries again (the browser asks again when it may).
    const web = await browser.newContext(PHONE);
    const wp = await web.newPage();
    await wp.goto('/');
    await signIn(wp, person.login, person.password);
    await wp.getByRole('button', { name: 'Check in' }).click(); await answerUniform(wp);
    await expect(wp.getByText(/Your browser is blocking location for this site/)).toBeVisible();
    await expect(wp.getByRole('button', { name: 'Allow location' })).toBeVisible();
    await web.grantPermissions(['geolocation']);
    await web.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });
    await wp.getByRole('button', { name: 'Allow location' }).click();
    await expect(wp.getByText(/Your browser is blocking location for this site/)).toHaveCount(0);
    await web.close();
  } finally {
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await person.remove();
  }
});

test('in the app: Voice draft listens with the phone (no browser microphone) and fills the task form', async ({ browser }) => {
  const ctx = await shellContext(browser, { version: '1.1.0' });
  const page = await ctx.newPage();
  await page.goto('/');
  await signIn(page, OWNER.login, OWNER.password);
  await page.goto('/tasks/tasks?tab=my');
  await page.getByRole('button', { name: 'Add task' }).click();
  const form = page.getByRole('dialog', { name: 'Add task' });
  await form.getByRole('button', { name: 'Voice draft' }).click();
  await expect(form.getByText(/^Heard: .stock check karna hai kal 5 baje tak 30 minute/)).toBeVisible();
  await expect(form.getByRole('spinbutton', { name: /^Effort/ })).toHaveValue('30');
  await expect.poll(async () => (await shellLog(page)).filter((m) => m.type === 'voice')).toEqual([expect.objectContaining({ type: 'voice', lang: 'en-IN' })]);
  await ctx.close();
});

test('an app older than the server needs asks once to update; Later hides it for the session', async ({ browser }) => {
  const ctx = await shellContext(browser, { version: '1.0.0' });
  const page = await ctx.newPage();
  await page.goto('/');
  await signIn(page, OWNER.login, OWNER.password);
  const prompt = page.getByRole('dialog', { name: 'Update the app — one time' });
  await expect(prompt).toBeVisible();
  const link = prompt.getByRole('link', { name: 'Update now' });
  await expect(link).toHaveAttribute('target', '_blank'); // a new window always leaves the app: the phone's browser downloads it
  await expect(link).toHaveAttribute('href', /\.apk$/);
  await prompt.getByRole('button', { name: 'Later' }).click();
  await expect(prompt).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), / }).or(page.getByRole('heading').first())).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Update the app — one time' })).toHaveCount(0);
  await ctx.close();
});
