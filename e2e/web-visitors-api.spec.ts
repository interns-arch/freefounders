// The Vehicle API (PLAN.md §22.12): the owner makes a key in Visitors → Settings → API access, the key is shown once, it
// reads the vehicle register and revoking it stops it at once. The owner works the gate here (the Owner role has every
// permission). Run against the live suite (`npm run dev`); reset DEMO afterwards
// (`npm --prefix services/platform run company -- reset --code DEMO --keep-owner`).
import { expect, type APIRequestContext, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const API = '/tasks/api/visitors/v1';

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

test('make a key, read the vehicles, revoke the key', async ({ page, request }) => {
  const t = await token(request);
  const auth = { ...XRW, authorization: `Bearer ${t}` };
  await request.put('/api/platform/company/modules', { data: { tasks: { visitors: true } }, headers: auth });
  await request.put('/tasks/api/visitors/settings/', { data: { photo_vehicle: false }, headers: auth });
  const plate = `MH12E${String(Date.now()).slice(-4)}`;
  const made = await request.post('/tasks/api/visitors/vehicles/', { data: { number: plate, type: 'truck', driver_name: 'Sunil' }, headers: auth });
  expect(made.ok(), await made.text()).toBeTruthy();

  await page.goto('/visitors/settings');
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const card = page.getByTestId('api-access');
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'API guide' })).toHaveAttribute('href', '/docs/vehicle-api.txt');
  await card.getByLabel('Who is this key for?').fill('e2e manager');
  await card.getByRole('button', { name: 'Make a key' }).click();
  const key = (await card.getByTestId('api-key-value').innerText()).trim();
  expect(key).toMatch(/^kpv_[a-z0-9_]+_[A-Za-z0-9]{40}$/);

  const api = (path: string, value = key) => request.get(`${API}${path}`, { headers: { authorization: `Bearer ${value}` } });
  const list = await api(`/vehicles/?vehicle_number=${plate}`);
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.count).toBe(1);
  expect(body.results[0]).toMatchObject({ vehicle_number: plate, type: 'truck', driver_name: 'Sunil', status: 'inside' });
  expect((await (await api('/vehicles/inside/')).json()).count).toBeGreaterThan(0);
  expect((await api(`/vehicles/${body.results[0].id}/`)).status()).toBe(200);
  expect((await request.post(`${API}/vehicles/`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(405);
  expect((await request.get(`${API}/vehicles/`)).status()).toBe(401);

  // Once only: after a reload the full key is nowhere on the page.
  await page.reload();
  await expect(card.getByTestId('api-key-row').filter({ hasText: 'e2e manager' }).first()).toBeVisible();
  await expect(page.getByTestId('api-key-value')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(key);

  await card.getByRole('button', { name: 'Revoke the key for e2e manager' }).first().click();
  await page.getByRole('button', { name: 'Revoke key' }).click();
  await expect(card.getByTestId('api-key-row').filter({ hasText: 'Revoked' }).first()).toBeVisible();
  expect((await api('/vehicles/')).status()).toBe(401);
});

test('the guide needs no sign-in', async ({ request }) => {
  const res = await request.get('/docs/vehicle-api.txt');
  expect(res.ok()).toBeTruthy();
  expect(await res.text()).toContain('Kaampilot Vehicle API');
});
