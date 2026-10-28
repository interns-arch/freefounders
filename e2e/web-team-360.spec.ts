// Team 360 (PLAN.md §25): the Owner opens Team from the menu, finds a person among the tiles, opens their page and goes
// through Overview / Attendance / Tasks; a Member gets no menu entry, `/team` sends them Home and the API answers 403.
// Desktop and a 390 px phone (2 tile columns). Run against `npm run dev`.
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(browser: Browser, login = OWNER.login, password = OWNER.password, phone = false) {
  const ctx = await browser.newContext(phone ? PHONE : {});
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

/** A new person with the built-in Member role, known to Tasks. */
async function member(request: APIRequestContext, owner: string) {
  const tag = Date.now().toString(36);
  const login = `e2e-t360-${tag}`;
  const password = 'E2e@123456';
  const created = await request.post('/api/platform/people', {
    headers: auth(owner),
    data: { fullName: `E2E Team360 ${tag}`, email: `${login}@kaampilot.test`, login: { username: login, password } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const personId = (await created.json()).person.id as string;
  const roles = (await (await request.get('/api/platform/roles', { headers: auth(owner) })).json()) as Array<{ id: string; code?: string }>;
  const m = roles.find((r) => r.code === 'ff_member')!;
  const given = await request.put(`/api/platform/people/${personId}/roles`, { headers: auth(owner), data: { roleIds: [m.id] } });
  expect(given.ok(), await given.text()).toBeTruthy();
  const mine = await token(request, login, password);
  await expect.poll(async () => (await request.get('/tasks/api/auth/me', { headers: auth(mine) })).status(), { timeout: 30_000 }).toBe(200);
  return {
    login,
    password,
    token: mine,
    remove: () => request.patch(`/api/platform/people/${personId}`, { headers: auth(owner), data: { status: 'inactive' } }),
  };
}

test('Owner: Team tiles → one person → Overview, Attendance, Tasks', async ({ browser, request }) => {
  const owner = await token(request);
  const tiles = await request.get('/tasks/api/team360/', { headers: auth(owner) });
  expect(tiles.ok(), await tiles.text()).toBeTruthy();
  const body = await tiles.json();
  expect(body.scope).toBe('company');
  expect(body.rows.length).toBeGreaterThan(0);

  const { ctx, page } = await signIn(browser);
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  const list = page.getByRole('list', { name: 'People' });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await page.getByLabel('Search people').fill('Demo Owner');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await shot(page, 'team-360-tiles');
  await list.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/team\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name: /Demo Owner/ })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await expect(page.getByText('Attendance', { exact: true }).first()).toBeVisible();
  const quarter = page.waitForResponse((r) => r.url().includes('/team360/') && r.url().includes('range=this_quarter'));
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This quarter' }).click();
  await quarter;
  await page.waitForTimeout(500); // charts draw
  await shot(page, 'team-360-overview');
  await sections.getByRole('button', { name: 'Attendance' }).click();
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  await expect(page.getByText('Regularizations this month')).toBeVisible();
  await sections.getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByText('Task chains')).toBeVisible();
  await expect(page.getByRole('button', { name: /Excel report for/ })).toBeVisible();
  await shot(page, 'team-360-tasks');
  await ctx.close();

  // Phone: two tile columns, the entry is in More.
  const phone = await signIn(browser, OWNER.login, OWNER.password, true);
  await phone.page.getByRole('button', { name: 'More' }).click();
  await phone.page.getByRole('dialog').getByRole('link', { name: 'Team', exact: true }).click();
  const first = phone.page.getByRole('list', { name: 'People' }).getByRole('listitem');
  await expect(first.first()).toBeVisible();
  if ((await first.count()) > 1) {
    const [a, b] = [await first.nth(0).boundingBox(), await first.nth(1).boundingBox()];
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1))).toBeLessThan(2); // side by side
  }
  await shot(phone.page, 'team-360-phone');
  await phone.ctx.close();
});

test('Member: no Team menu, /team sends Home, the API refuses', async ({ browser, request }) => {
  const owner = await token(request);
  const m = await member(request, owner);
  try {
    const me = await (await request.get('/tasks/api/auth/me', { headers: auth(m.token) })).json();
    expect(me.team360).toBe(false);
    expect((await request.get('/tasks/api/team360/', { headers: auth(m.token) })).status()).toBe(403);
    expect((await request.get(`/tasks/api/team360/${me.id}/`, { headers: auth(m.token) })).status()).toBe(403);
    const { ctx, page } = await signIn(browser, m.login, m.password);
    await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    await page.goto('/team');
    await expect(page).not.toHaveURL(/\/team/);
    await ctx.close();
  } finally {
    await m.remove();
  }
});
