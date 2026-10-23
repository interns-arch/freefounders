// Punching in away from the office (PLAN.md §19.36): with the office location check on, a punch from outside the
// allowed radius is refused with the distance and the nearest office's name, on Attendance → Today and on the Home card;
// a rough GPS fix whose circle reaches the office asks for a better fix instead. The browser's position is faked
// (Playwright geolocation). The office, the setting and the person made here are removed / put back at the end.
import { expect, type APIRequestContext, type Browser, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
// Far from any real office: a point in the Arabian Sea, and the test office ~1.2 km north of it.
const HERE = { latitude: 10, longitude: 70 };
const OFFICE = { latitude: 10.0108, longitude: 70 };

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function newMember(request: APIRequestContext, owner: string) {
  const stamp = Date.now().toString(36);
  const login = `e2e-geo-${stamp}`;
  const temp = 'E2e@123456';
  const password = 'E2e@654321';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Geo ${stamp}`, email: `${login}@freefounders.test`, login: { username: login, password: temp } },
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
    remove: async () => {
      await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [] } });
      await request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } });
    },
  };
}

async function signedIn(browser: Browser, who: { login: string; password: string }, geo: { latitude: number; longitude: number; accuracy: number }, phone = false) {
  const ctx = await browser.newContext({
    geolocation: geo,
    permissions: ['geolocation'],
    ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Email, mobile, username or employee ID').fill(who.login);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

test('outside the office: refused with the distance and the office name (Today + Home); a rough fix asks for a better one', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const owner = await token(request);
  const before = await (await request.get('/tasks/api/hr/settings/', { headers: auth(owner) })).json();
  const keys = ['photo', 'geofence_enabled', 'uniform_check'];
  const name = `E2E Office ${Date.now().toString(36)}`;
  const office = await request.post('/tasks/api/office-locations/', { headers: auth(owner), data: { name, ...OFFICE, radius_m: 100 } });
  expect(office.status(), await office.text()).toBe(201);
  const officeId = (await office.json()).id as number;
  let person: Awaited<ReturnType<typeof newMember>> | null = null;
  try {
    expect((await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: { photo: 'off', geofence_enabled: true, uniform_check: 'off' } })).ok()).toBeTruthy();
    person = await newMember(request, owner);
    const message = `You are not at the office location. You are about 1.2 km away from ${name}; punch in when you reach the office.`;

    // Attendance → Today, 1.2 km away.
    const desk = await signedIn(browser, person, { ...HERE, accuracy: 15 });
    await desk.page.goto('/attendance');
    await desk.page.getByRole('button', { name: 'Check in' }).click();
    await expect(desk.page.getByText(message)).toBeVisible();
    await desk.page.screenshot({ path: 'screenshots/web-punch-outside-today.png' });
    await desk.ctx.close();

    // Home card on a phone.
    const phone = await signedIn(browser, person, { ...HERE, accuracy: 15 }, true);
    await phone.page.goto('/?home=1');
    await phone.page.getByRole('button', { name: 'Punch in' }).click();
    await expect(phone.page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    await phone.page.screenshot({ path: 'screenshots/web-punch-outside-home.png' });
    await phone.ctx.close();

    // 300 m away with ±250 m: maybe inside, so a better fix is asked for.
    const rough = await signedIn(browser, person, { latitude: OFFICE.latitude - 0.0027, longitude: OFFICE.longitude, accuracy: 250 });
    await rough.page.goto('/attendance');
    await rough.page.getByRole('button', { name: 'Check in' }).click();
    await expect(rough.page.getByText("Your location isn't accurate enough yet (±250 m). Move outdoors or near a window and try again.")).toBeVisible();
    await rough.ctx.close();

    const pt = await token(request, person.login, person.password);
    expect((await (await request.get('/tasks/api/attendance/today/', { headers: auth(pt) })).json()).attendance).toBeNull();
    // The API answer carries the numbers.
    const res = await request.post('/tasks/api/attendance/check_in/', { headers: auth(pt), data: { ...HERE, accuracy: 10 } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'outside_office', office: name, radius_m: 100 });
    expect(body.distance_m).toBeGreaterThan(1150);

    // At the office: the punch goes through.
    const there = await signedIn(browser, person, { ...OFFICE, accuracy: 10 });
    await there.page.goto('/attendance');
    await there.page.getByRole('button', { name: 'Check in' }).click();
    await expect(there.page.getByText('Checked in ✅')).toBeVisible();
    await there.ctx.close();
  } finally {
    const restore = Object.fromEntries(keys.map((k) => [k, before[k]?.custom ? before[k].value : '']));
    await request.put('/tasks/api/hr/settings/', { headers: auth(owner), data: restore });
    await request.delete(`/tasks/api/office-locations/${officeId}/`, { headers: auth(owner) });
    if (person) await person.remove();
  }
});
