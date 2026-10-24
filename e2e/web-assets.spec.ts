// Phase 6 parity tests for the Assets area of the new web app (PLAN.md §18): the Assets screens moved from the old Assets
// web app keep their URLs (/assets/…), gates and behaviour. Elements are found by role / label / text only. What a test
// creates is retired / cancelled at the end where the API allows it (assets and tickets have no hard delete).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });
const stamp = () => Date.now().toString(36);

/** A 3000×2000 phone-sized JPEG for the asset photo, drawn in the browser: it must be stored ≤ 1600 px (PLAN.md §19.20). */
async function bigPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(3000, 2000);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(3000, 2000);
    for (let i = 0; i < img.data.length; i += 4) {
      const p = i / 4;
      const grain = (Math.random() - 0.5) * 30;
      img.data[i] = ((p % 3000) / 3000) * 255 + grain;
      img.data[i + 1] = (Math.floor(p / 3000) / 2000) * 255 + grain;
      img.data[i + 2] = 128 + grain;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

/** A tiny valid PNG (1×1) for a second asset photo. */
const smallPng = () =>
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function token(request: APIRequestContext, login = OWNER.login, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/platform/auth/login', { data: { login, password, client: 'mobile' }, headers: XRW });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken;
}

/** Opens `path` signed in (the sign-in page sends us back there). */
async function openSignedIn(page: Page, path: string, login = OWNER.login, password = OWNER.password) {
  await page.goto(path);
  await page.getByLabel('Email, mobile, username or employee ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The Assets "+ Add" menu (top of every Assets screen). */
async function quickAdd(page: Page, item: string) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // The first nine items show their number key ("Asset 3").
  await page.getByRole('menuitem', { name: new RegExp(`^${item}( \\d)?$`) }).click();
}

const noLoadError = (page: Page) => expect(page.getByText('Couldn’t load this')).toHaveCount(0);

test('every Assets screen opens under /assets with its menu', async ({ page }) => {
  test.setTimeout(120_000); // 17 full page loads in a row: the dev server sends ~150 modules per load
  await openSignedIn(page, '/assets');
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Assets menu' });
  for (const name of ['Dashboard', 'Assets', 'Employees', 'Requests', 'Tickets', 'Asset catalogue', 'Departments']) {
    // a count badge (PLAN.md §19.42) adds ", N pending" to Requests / Tickets when something waits
    await expect(menu.getByRole('link', { name: new RegExp(`^${name}( ?, \\d+ pending)?$`) })).toBeVisible();
  }
  // SIM cards and reconciliation are in-app too (web-assets-sims-reconciliation.spec.ts covers them).
  await expect(menu.getByRole('link', { name: /SIM cards/ })).toHaveAttribute('href', '/assets/sims');

  const screens: Array<[string, string | RegExp]> = [
    ['/assets/assets', 'Assets'],
    ['/assets/employees', 'Employees'],
    ['/assets/exits', 'Employee exits'],
    ['/assets/requests', 'Asset requests'],
    ['/assets/requests?view=joiners', 'Requests'],
    ['/assets/tickets', 'Tickets'],
    ['/assets/queue', 'Priority queue'],
    ['/assets/leadership', 'Leadership overview'],
    ['/assets/onboarding', 'New joiners'],
    ['/assets/maintenance', 'Maintenance'],
    ['/assets/activity', 'Activity log'],
    ['/assets/scan', 'Scan'],
    ['/assets/settings/catalog', 'Asset catalog'],
    ['/assets/settings/departments', 'Departments'],
    ['/assets/settings/vendors', 'Vendors'],
    ['/assets/settings/users', 'Users'],
    ['/assets/settings/roles', 'Roles'], // one role builder: Admin → Roles (PLAN.md §19.28)
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: typeof heading === 'string' })).toBeVisible();
    await noLoadError(page);
  }

  // The catalogue lists the demo categories; the scan page takes a typed code.
  await page.goto('/assets/settings/catalog');
  await expect(page.getByText('Laptop').first()).toBeVisible();
  await page.goto('/assets/scan');
  await expect(page.getByRole('heading', { level: 1, name: 'Scan' })).toBeVisible();
});

test('add an asset with a photo from the Add menu, then open it: details, photo and QR code', async ({ page, request }) => {
  const owner = await token(request);
  const s = stamp();
  const model = `Web ${s}`;
  let assetId: string | undefined;
  try {
    await openSignedIn(page, '/assets/assets');
    await expect(page.getByRole('heading', { level: 1, name: 'Assets' })).toBeVisible();

    await quickAdd(page, 'Asset');
    const sheet = page.getByRole('dialog', { name: 'Add asset' });
    await sheet.getByRole('button', { name: /Laptop, Car, SIM Card/ }).click();
    await page.getByRole('combobox').last().fill('Laptop');
    await page.getByRole('option', { name: /^Laptop/ }).first().click();
    await sheet.getByPlaceholder('Dell, Honda, Canon…').fill('E2E');
    await sheet.getByPlaceholder('Latitude 7440').fill(model);
    // The Laptop type's own required fields (the form adapts to the type).
    await sheet.getByLabel(/^Processor/).fill('Intel Core i5');
    await sheet.getByLabel(/^RAM/).fill('16');
    const original = await bigPhoto(page);
    await sheet.getByLabel('Photo').setInputFiles({ name: 'front.jpg', mimeType: 'image/jpeg', buffer: original });
    await sheet.getByRole('button', { name: 'Add asset', exact: true }).click();
    await expect(page.getByText(/added$/).first()).toBeVisible();

    // Find it in the list and open it.
    await page.getByPlaceholder(/Search/).first().fill(model);
    await page.getByText(`E2E ${model}`).first().click();
    await expect(page).toHaveURL(/\/assets\/assets\/[0-9a-f-]{36}$/);
    assetId = page.url().split('/').pop();
    await expect(page.getByRole('heading', { level: 1, name: `E2E ${model}` })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Asset photo' })).toBeVisible();

    // The photo loads with the Assets session cookie at /assets/api/… (what the <img> uses).
    const detail = await (await request.get(`/assets/api/assets/${assetId}`, { headers: auth(owner) })).json();
    expect(detail.photos.length).toBe(1);
    const photo = await page.request.get(`/assets/api/assets/${assetId}/photos/${detail.photos[0].id}`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()['content-type']).toMatch(/^image\//);
    // Stored small: at most 1600 px and a fraction of the 3000×2000 original.
    const stored = await page.evaluate(async (url) => {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      return { width: bmp.width, height: bmp.height, size: blob.size };
    }, `/assets/api/assets/${assetId}/photos/${detail.photos[0].id}`);
    expect(Math.max(stored.width, stored.height)).toBe(1600);
    expect(stored.size, `${original.length} → ${stored.size} bytes`).toBeLessThan(Math.min(original.length / 4, 600 * 1024));

    // Asset photos (PLAN.md §19.34): add one from the asset page (gallery picker, caption), see it, then delete it.
    const photosCard = page.getByRole('heading', { name: /^Photos \(1\)$/ }).locator('..').locator('..');
    await expect(photosCard.getByText('1 of 6')).toBeVisible();
    await photosCard.getByRole('button', { name: 'Add photo' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add photos of this asset' });
    await expect(addDialog.getByRole('button', { name: 'Take photo' })).toBeVisible();
    await addDialog.getByLabel('Photos from the gallery').setInputFiles({ name: 'side.png', mimeType: 'image/png', buffer: smallPng() });
    await addDialog.getByLabel('Caption').fill('Side view');
    await addDialog.getByRole('button', { name: 'Save photo' }).click();
    await expect(page.getByText('1 photo saved')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Photos \(2\)$/ })).toBeVisible();
    const after = await (await request.get(`/assets/api/assets/${assetId}/photos`, { headers: auth(owner) })).json();
    expect(after.map((p: { caption: string | null }) => p.caption)).toEqual([null, 'Side view']);
    // The list shows the first photo as the thumbnail.
    const row = (await (await request.get(`/assets/api/assets?ids=${assetId}`, { headers: auth(owner) })).json()).items[0];
    expect(row.photoId).toBe(after[0].id);
    // Open the new one in the viewer (its caption is the title) and delete it.
    await page.getByRole('button', { name: 'Asset photo · Side view' }).click();
    const viewer = page.getByRole('dialog', { name: 'Side view' });
    await viewer.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete this photo?' }).getByRole('button', { name: 'Delete photo' }).click();
    await expect(page.getByText('Photo deleted')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Photos \(1\)$/ })).toBeVisible();
    expect((await (await request.get(`/assets/api/assets/${assetId}/photos`, { headers: auth(owner) })).json()).length).toBe(1);

    // Scanning its code opens it: /assets/scan/<code>.
    await page.goto(`/assets/scan/${encodeURIComponent(detail.assetTag)}`);
    await expect(page).toHaveURL(new RegExp(`/assets/assets/${assetId}$`));
  } finally {
    if (assetId) {
      for (const action of ['retire', 'dispose']) {
        await request.post(`/assets/api/assets/${assetId}/lifecycle`, { headers: auth(owner), data: { action, notes: 'e2e cleanup' } });
      }
    }
  }
});

test('employees list and profile (QR card)', async ({ page }) => {
  await openSignedIn(page, '/assets/employees');
  await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();
  await page.getByPlaceholder(/Search/).first().fill('Demo Owner');
  await page.getByRole('main').getByRole('row').filter({ hasText: 'Demo Owner' }).first().click();
  await expect(page).toHaveURL(/\/assets\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Demo Owner').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code' }).first()).toBeVisible();
  await noLoadError(page);
});

test('a request is raised, approved, and opened from a notification link (?open=)', async ({ page, request }) => {
  const owner = await token(request);
  const s = stamp();
  const item = `E2E web item ${s}`;
  let requestId: string | undefined;
  try {
    await openSignedIn(page, '/assets/requests');
    await expect(page.getByRole('heading', { level: 1, name: 'Asset requests' })).toBeVisible();

    await quickAdd(page, 'Request');
    const sheet = page.getByRole('dialog', { name: 'Request an asset' });
    await sheet.getByRole('button', { name: /Monitor, headset, SIM card/ }).click();
    await page.getByRole('combobox').last().fill(item);
    await page.getByRole('option', { name: `Request “${item}”` }).click();
    await sheet.getByPlaceholder('Why is it needed?').fill('Parity test');
    await sheet.getByRole('button', { name: 'Submit request' }).click();
    await expect(sheet).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: item });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
    await confirm.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/approved$/).first()).toBeVisible();

    const list = await (await request.get('/assets/api/requests', { headers: auth(owner), params: { search: item } })).json();
    requestId = list.items[0].id;
    expect(list.items[0].status).toBe('APPROVED');

    // Notification links: /assets/requests?open=<id> opens that request.
    await page.goto(`/assets/requests?open=${requestId}`);
    const panel = page.getByRole('dialog', { name: item });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(list.items[0].number)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Fulfil' })).toBeVisible();
  } finally {
    if (requestId) await request.post(`/assets/api/requests/${requestId}/cancel`, { headers: auth(owner), data: {} });
  }
});

test('a ticket is raised and resolved', async ({ page }) => {
  const s = stamp();
  const title = `E2E web ticket ${s}`;
  await openSignedIn(page, '/assets/tickets');
  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();

  await quickAdd(page, 'Ticket');
  const form = page.getByRole('dialog', { name: 'Raise a ticket' });
  await form.getByPlaceholder('Laptop won’t charge').fill(title);
  await form.getByPlaceholder('What happened? Since when?').fill('Parity test');
  await form.getByRole('button', { name: 'Raise ticket' }).click();
  await expect(form).toBeHidden();

  // Earlier runs leave other tickets that sort above this one: find it with the search box.
  await page.getByPlaceholder('Search tickets…').fill(title);
  await page.getByText(title).first().click();
  await expect(page).toHaveURL(/[?&]open=/);
  const sheet = page.getByRole('dialog', { name: title });
  await sheet.getByLabel('Status').selectOption('RESOLVED');
  await sheet.getByLabel('Resolution notes').fill('Fixed by the parity test');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Ticket updated')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).first().click();

  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
});

test('exits, joiners, departments and activity lists load', async ({ page }) => {
  await openSignedIn(page, '/assets/exits');
  await expect(page.getByRole('heading', { level: 1, name: 'Employee exits' })).toBeVisible();
  await noLoadError(page);

  await page.goto('/assets/onboarding');
  await expect(page.getByRole('heading', { level: 1, name: 'New joiners' })).toBeVisible();
  await noLoadError(page);

  await page.goto('/assets/settings/departments');
  await expect(page.getByRole('heading', { level: 1, name: 'Departments' })).toBeVisible();
  await noLoadError(page);

  await page.goto('/assets/activity');
  await expect(page.getByRole('heading', { level: 1, name: 'Activity log' })).toBeVisible();
  await noLoadError(page);
});
