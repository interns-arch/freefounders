// Visitors V3 (PLAN.md §22.10): a contractor pass in and out (also found by the gate's one scan); a material gate pass
// let out at the gate; a patrol checkpoint scanned; an incident reported and closed; the reports page. Run against the
// live suite (`npm run dev`); reset DEMO afterwards (`npm --prefix services/platform run company -- reset --code DEMO --keep-owner`).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwB1FFFesecFFFFABRRRQAUUUUAf/9k=',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: JPEG });

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
}
const mobile = (s: string, d: string) => `9${d}${(parseInt(s, 36) % 1e8).toString().padStart(8, '0')}`.slice(0, 10);

test('Visitors V3: contractor in / out and scan; material pass out; patrol scan; incident; reports', async ({ page, request }) => {
  test.setTimeout(180_000);
  const owner = await token(request);
  const s = Date.now().toString(36);

  await signIn(page, '/settings');
  const sw = page.getByRole('switch', { name: 'Tasks: Visitors' });
  await expect(sw).toBeVisible();
  if (!(await sw.isChecked())) await sw.click();
  await expect.poll(async () => (await request.get('/tasks/api/visitors/config/', { headers: auth(owner) })).status(), { timeout: 40_000 }).toBe(200);

  // 1. A contractor pass for a crew, in (photo) and out.
  const name = `Crew ${s}`;
  await page.goto('/visitors/contractors');
  await page.getByRole('button', { name: 'New contractor pass' }).click();
  const sheet = page.getByRole('dialog', { name: 'New contractor pass' });
  await sheet.getByLabel(/^Name/).fill(name);
  await sheet.getByLabel(/^Mobile/).fill(mobile(s, '3'));
  await sheet.getByLabel('People in the crew').fill('3');
  await sheet.locator('input[name="work"]').fill('Painting the warehouse');
  await sheet.getByLabel('Safety note').fill('Harness above 2 m');
  await sheet.getByRole('button', { name: 'Make pass' }).click();
  const detail = page.getByRole('dialog', { name: new RegExp(`^${name} C\\d+`) });
  await expect(detail).toBeVisible();
  await detail.getByTestId(/^contractor-photo-/).setInputFiles(photo('crew.jpg'));
  await expect(detail.getByText('New photo ready.')).toBeVisible();
  await detail.getByRole('button', { name: 'In', exact: true }).click();
  await expect(page.getByText(`${name} in`)).toBeVisible();
  const card = page.locator('[data-testid^="contractor-"]', { hasText: name });
  await expect(card.getByText('Inside', { exact: true })).toBeVisible();
  const passNo = (await (await request.get('/tasks/api/visitors/contractors/', { headers: auth(owner), params: { q: name } })).json()).results[0].pass_no as string;
  // The gate's one scan finds the contractor's pass by its number; Out from there.
  await page.goto('/visitors/today');
  await page.getByRole('button', { name: 'Scan pass' }).click();
  await page.getByLabel('Pass number').fill(passNo);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  const scanned = page.getByRole('dialog', { name: `Contractor pass ${passNo}` });
  await expect(scanned).toBeVisible();
  await scanned.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(page.getByText(`${name} out`)).toBeVisible();

  // 2. A material pass: the owner (security head) asks, it is approved at once; the gate lets it out.
  const item = `Old monitor ${s}`;
  await page.goto('/visitors/material');
  await page.getByRole('button', { name: 'Ask for a pass' }).click();
  const ms = page.getByRole('dialog', { name: 'Ask for a material gate pass' });
  await ms.getByLabel(/^Purpose/).fill('Scrap sale');
  await ms.getByRole('textbox', { name: 'Item 1', exact: true }).fill(item);
  await ms.getByLabel('Item 1 quantity').fill('2');
  await ms.getByRole('button', { name: 'Ask for approval' }).click();
  const md = page.getByRole('dialog').filter({ hasText: item });
  await expect(md.getByText('Approved', { exact: true })).toBeVisible();
  await md.getByRole('button', { name: 'Let it out' }).click();
  await page.getByRole('dialog', { name: /^Let M\d+ through\?/ }).getByRole('button', { name: 'Checked, let it out' }).click();
  await expect(page.getByText(/M\d+ passed the gate/).first()).toBeVisible();

  // 3. Patrol: a checkpoint, then the guard's scan (the sticker code typed).
  const cpName = `Back gate ${s}`;
  await page.goto('/visitors/patrol');
  await page.getByRole('button', { name: 'Add checkpoint' }).click();
  const cs = page.getByRole('dialog', { name: 'New checkpoint' });
  await cs.getByLabel(/^Name/).fill(cpName);
  await cs.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-testid^="checkpoint-"]', { hasText: cpName })).toBeVisible();
  const cps = (await (await request.get('/tasks/api/visitors/checkpoints/', { headers: auth(owner) })).json()) as { checkpoints: Array<{ name: string; code: string }> };
  const code = cps.checkpoints.find((c) => c.name === cpName)!.code;
  await page.getByRole('button', { name: 'Scan checkpoint' }).click();
  const sd = page.getByRole('dialog', { name: 'Scan checkpoint' });
  await sd.getByLabel('Sticker code').fill(code);
  await sd.getByRole('button', { name: 'Checked' }).click();
  await expect(page.getByText(`${cpName} checked`)).toBeVisible();
  await sd.press('Escape');
  await expect(page.locator('[data-testid^="checkpoint-"]', { hasText: cpName }).getByText('On time')).toBeVisible();

  // 4. An incident: reported (high), then closed by the head.
  const title = `Cable cut ${s}`;
  await page.goto('/visitors/incidents');
  await page.getByRole('button', { name: 'Report incident' }).click();
  const rs = page.getByRole('dialog', { name: 'Report incident' });
  await rs.getByLabel(/^What happened/).fill(title);
  await rs.getByLabel('Kind').selectOption('theft');
  await rs.getByLabel('Severity').selectOption('high');
  await rs.getByTestId('incident-photo').setInputFiles(photo('cut.jpg'));
  await expect(rs.getByAltText('Photo 1')).toBeVisible();
  await rs.getByRole('button', { name: 'Report', exact: true }).click();
  await page.getByRole('row', { name: new RegExp(title) }).click();
  const idlg = page.getByRole('dialog', { name: title });
  await idlg.getByLabel('What was done').fill('Police complaint filed');
  await idlg.getByRole('button', { name: 'Close incident' }).click();
  await expect(page.getByText('Incident closed')).toBeVisible();

  // 5. Reports.
  await page.goto('/visitors/reports');
  await expect(page.getByRole('heading', { name: 'Visitor reports' })).toBeVisible();

  const log = (await (await request.get('/tasks/api/visitors/activity/', { headers: auth(owner), params: { page_size: 100 } })).json()) as { results: Array<{ action: string }> };
  expect(log.results.map((r) => r.action)).toEqual(expect.arrayContaining(['contractor_pass', 'contractor_in', 'contractor_out', 'material_request', 'material_gate', 'patrol', 'incident', 'incident_close']));
});
