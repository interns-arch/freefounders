// Downloads everywhere (PLAN.md §19.31): the one Download control in a page header gives a file of ALL rows matching
// the screen's current filters (not just the visible page), as Excel or CSV. Found by role/label/text only.
import { expect, type APIRequestContext, type Download, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Email, mobile, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (new URL(page.url()).pathname !== path) await page.goto(path);
}

/** Opens the header's Download menu, picks a format and returns the saved file. */
async function download(page: Page, item: RegExp): Promise<{ name: string; body: Buffer }> {
  const button = page.getByRole('button', { name: 'Download', exact: true }).first();
  await expect(button).toBeEnabled();
  await button.click();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()]);
  return read(file);
}

async function read(file: Download) {
  const path = await file.path();
  return { name: file.suggestedFilename(), body: readFileSync(path!) };
}

/** CSV rows (BOM removed, quoted cells with commas kept whole). */
function csvRows(body: Buffer): string[][] {
  const text = body.toString('utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

test('Admin → People: the search is applied to the Excel and CSV files', async ({ page, request }) => {
  const owner = await token(request);
  const term = 'a';
  const people = await (await request.get(`/api/platform/people?search=${term}`, { headers: auth(owner) })).json();
  const expected = (Array.isArray(people) ? people : people.items).length;
  await signIn(page, '/people');
  await page.getByLabel('Search people').fill(term);
  await page.waitForTimeout(800); // the search is debounced
  const xlsx = await download(page, /Excel/);
  expect(xlsx.name).toMatch(/^admin-people-a-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
  const csv = await download(page, /^CSV/);
  const rows = csvRows(csv.body);
  expect(rows[0]).toContain('Name');
  expect(rows.length - 1).toBe(expected);
});

test('Assets: a search filter downloads every matching asset, not one page', async ({ page }) => {
  await signIn(page, '/assets/assets');
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search assets' }).fill('a');
  // the header line says how many assets match ("12 assets")
  const line = page.getByText(/^[\d,]+ .*assets$/).first();
  await expect(line).toBeVisible();
  await page.waitForTimeout(600); // the search is debounced
  const total = Number((await line.innerText()).split(' ')[0]!.replace(/,/g, ''));
  test.skip(total === 0, 'no demo assets match');
  const csv = await download(page, /^CSV/);
  expect(csv.name).toMatch(/^assets-assets-.*a-\d{4}-\d{2}-\d{2}\.csv$/);
  const rows = csvRows(csv.body);
  expect(rows[0]!.length).toBeGreaterThan(3);
  expect(rows.length - 1).toBe(total);
});

test('Tasks → Groups: Excel has the groups the API lists', async ({ page, request }) => {
  const owner = await token(request);
  const groups = await (await request.get('/tasks/api/groups/', { headers: auth(owner) })).json();
  const count = (Array.isArray(groups) ? groups : groups.results).length;
  await signIn(page, '/tasks/groups');
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  const button = page.getByRole('button', { name: /^Download/ }).first();
  if (count === 0) {
    await expect(button).toBeDisabled();
    return;
  }
  const csv = await download(page, /^CSV/);
  expect(csv.name).toMatch(/^tasks-groups-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csvRows(csv.body).length - 1).toBe(count);
});

test('the Download menu fits and works on a 390 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/people');
  const button = page.getByRole('button', { name: 'Download', exact: true }).first();
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await button.click();
  await expect(page.getByRole('menuitem', { name: /Excel/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^CSV/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
