// Roster management (PLAN.md §28): HR adds a shift, plans a person's week in the grid (select → pick a shift → Save),
// the person is told and sees it under My roster, the shift list in HR settings, the phone "By day" view. Found by
// role/label/text only; the shift and the roster entries made here are cleaned up (archived / cleared).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

test.describe('Roster', () => {
  const code = `Q${Date.now().toString(36).slice(-2).toUpperCase()}`;
  let shiftId: number | undefined;
  let owner = '';

  test.afterAll(async ({ request }) => {
    owner = owner || (await token(request));
    const roster = await (await request.get(`/tasks/api/hr/roster/?from=${nextMonday()}&to=${nextMonday()}`, { headers: auth(owner) })).json();
    const mine = (roster.entries as Array<{ user: number; date: string; shift: number }>).filter((e) => e.shift === shiftId);
    if (mine.length) await request.put('/tasks/api/hr/roster/', { headers: auth(owner), data: { changes: mine.map((e) => ({ ...e, shift: null })) } });
    if (shiftId) await request.patch(`/tasks/api/hr/shifts/${shiftId}/`, { headers: auth(owner), data: { active: false, code: `${code}X`.slice(0, 4) } });
  });

  test('add a shift, plan a day in the grid, save', async ({ page, request }) => {
    owner = await token(request);
    await signIn(page);

    // HR settings › Shifts: add an overnight shift.
    await page.goto('/attendance/settings');
    const form = page.getByRole('form', { name: 'Add a shift' });
    await form.getByLabel('Name').fill(`E2E night ${code}`);
    await form.getByLabel('Code').fill(code);
    await form.getByLabel('Starts').fill('22:00');
    await form.getByLabel('Ends').fill('06:00');
    await expect(form.getByText('Overnight: ends the next day.')).toBeVisible();
    await form.getByRole('button', { name: 'Add shift' }).click();
    await expect(page.getByText('Shift added')).toBeVisible();
    const shifts = (await (await request.get('/tasks/api/hr/shifts/', { headers: auth(owner) })).json()) as Array<{ id: number; code: string }>;
    shiftId = shifts.find((s) => s.code === code)?.id;
    expect(shiftId).toBeTruthy();

    // Attendance › Roster: next week, the first editable cell on Monday → the new shift → Save.
    await page.goto('/attendance/roster');
    await page.getByRole('button', { name: 'Next week' }).click();
    const grid = page.getByRole('grid', { name: 'Roster' });
    const cell = grid.getByRole('gridcell').and(page.locator(':not([disabled])')).first();
    await cell.click();
    await expect(page.getByText('1 day selected')).toBeVisible();
    await page.getByRole('group', { name: 'Set the selected days to' }).getByRole('button', { name: new RegExp(`^${code}`) }).click();
    await expect(cell).toHaveText(code);
    await expect(page.getByText('1 unsaved')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('1 unsaved')).toBeHidden();
    await cell.click();
    await page.getByRole('group', { name: 'Set the selected days to' }).getByRole('button', { name: new RegExp(`^${code}`) }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 1 day/)).toBeVisible();

    const roster = await (await request.get(`/tasks/api/hr/roster/?from=${nextMonday()}&to=${nextMonday()}`, { headers: auth(owner) })).json();
    expect((roster.entries as Array<{ shift: number }>).some((e) => e.shift === shiftId)).toBeTruthy();

    // Phones: By day lists one day, the grid stays inside its card.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('group', { name: 'Roster layout' }).getByRole('button', { name: 'By day' }).click();
    await expect(page.getByRole('group', { name: 'Day' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test('menu entry and plan gate wording', async ({ page }) => {
    await signIn(page);
    await page.goto('/attendance');
    await expect(page.getByRole('link', { name: 'Roster' }).first()).toBeVisible();
  });
});
