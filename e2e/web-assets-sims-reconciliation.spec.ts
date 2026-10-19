// The last two Assets screens moved into the new web app (PLAN.md §18/§19): SIM cards (/assets/sims, the register
// filtered to the SIM type) and reconciliation (/assets/reconciliation, an Airtel / Salary Box dump checked against the
// register). Elements are found by role / label / text only. The `sims` module is switched on for the test and put
// back afterwards; assets created here are retired and disposed (there is no hard delete; checks are kept as reports).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };
const auth = (t: string) => ({ ...XRW, authorization: `Bearer ${t}` });

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

const noLoadError = (page: Page) => expect(page.getByText('Couldn’t load this')).toHaveCount(0);

/** Whether the Assets "sims" module is on for the company (undefined when the company has no Assets). */
function simsOn(company: { modules: { app: string; modules: { key: string; on: boolean }[] }[] }): boolean | undefined {
  return company.modules.find((m) => m.app === 'assets')?.modules.find((m) => m.key === 'sims')?.on;
}

/** A unique Indian mobile number (10 digits, starts with 9) so the SIM fields' uniqueness never collides. */
const phone = () => `9${Date.now().toString().slice(-9)}`;

async function retire(request: APIRequestContext, owner: string, assetId: string) {
  for (const action of ['retire', 'dispose']) {
    await request.post(`/assets/api/assets/${assetId}/lifecycle`, { headers: auth(owner), data: { action, notes: 'e2e cleanup' } });
  }
}

test('SIM cards list, then an Airtel check: matched SIM, missing one added from the report', async ({ page, request }) => {
  test.setTimeout(120_000);
  const owner = await token(request);
  const before = await (await request.get('/api/platform/company', { headers: auth(owner) })).json();
  const wasOn = simsOn(before);
  if (wasOn === false) {
    const res = await request.put('/api/platform/company/modules', { headers: auth(owner), data: { assets: { sims: true } } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  const types = await (await request.get('/assets/api/asset-types', { headers: auth(owner) })).json();
  const simType = types.find((t: { code: string }) => t.code === 'SIM');
  expect(simType, 'the demo catalogue has a SIM Card type').toBeTruthy();

  const known = phone();
  const missing = `8${known.slice(1)}`;
  const created: string[] = [];
  try {
    // A SIM already in the register, so the check has something to match.
    const sim = await request.post('/assets/api/assets', {
      headers: auth(owner),
      data: {
        assetTypeId: simType.id,
        name: 'E2E Airtel SIM',
        status: 'AVAILABLE',
        attributes: { connection_number: known, sim_number: `8991${known}0000001U`, plan: 'INFINITY_299', circle: 'DL', carrier: 'Airtel' },
      },
    });
    expect(sim.ok(), await sim.text()).toBeTruthy();
    created.push((await sim.json()).id);

    // SIM cards: the menu item is in-app now and opens the register filtered to SIM cards (its columns show).
    await openSignedIn(page, '/assets/sims');
    await expect(page).toHaveURL(/\/assets\/assets\?assetTypeId=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Assets' })).toBeVisible();
    await noLoadError(page);
    const menu = page.getByRole('navigation', { name: 'Assets menu' });
    await expect(menu.getByRole('link', { name: 'SIM cards' })).toHaveAttribute('href', '/assets/sims');
    await expect(menu.getByRole('link', { name: 'Reconciliation' })).toHaveAttribute('href', '/assets/reconciliation');
    await page.getByPlaceholder(/Search/).first().fill(known);
    await expect(page.getByRole('main').getByText(known).first()).toBeVisible();

    // An Airtel check started from the (already parsed) rows: one known connection, one the register does not have.
    const fileName = `e2e-airtel-${known}.xlsx`;
    const run = await request.post('/assets/api/reconciliations', {
      headers: auth(owner),
      data: {
        source: 'AIRTEL',
        fileName,
        repairedRows: 0,
        rows: [
          { connectionNumber: known, simNumber: `8991${known}0000001U`, plan: 'infinity_299', circle: 'DL', status: 'Active' },
          { connectionNumber: missing, simNumber: `8991${missing}0000002U`, plan: 'INFINITY_299', circle: 'DL', status: 'Active', billableId: '1-E2E' },
        ],
      },
    });
    expect(run.ok(), await run.text()).toBeTruthy();
    const { id: runId, summary } = await run.json();
    expect(summary.MATCHED).toBe(1);
    expect(summary.MISSING_IN_SYSTEM).toBe(1);

    // The list of previous checks shows it with its counts; opening it shows the report.
    await page.goto('/assets/reconciliation');
    await expect(page.getByRole('heading', { level: 1, name: 'Reconciliation' })).toBeVisible();
    await noLoadError(page);
    await expect(page.getByText(/Choose Airtel file/)).toBeVisible();
    const row = page.getByRole('button').filter({ hasText: fileName });
    await expect(row).toBeVisible();
    await expect(row.getByText('1 matched')).toBeVisible();
    await expect(row.getByText('1 not in system')).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/assets/reconciliation/${runId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Airtel connections check' })).toBeVisible();
    await expect(page.getByText(fileName)).toBeVisible();

    // "Needs attention" lists the missing connection; the matched one is under "Matched" with a link to the asset.
    const main = page.getByRole('main');
    await expect(main.getByRole('listitem').filter({ hasText: missing })).toBeVisible();
    await expect(main.getByRole('listitem').filter({ hasText: known })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Matched \d/ }).click();
    const matchedRow = main.getByRole('listitem').filter({ hasText: known });
    await expect(matchedRow).toBeVisible();
    await expect(matchedRow.getByRole('link', { name: /E2E Airtel SIM|Not assigned|→/ })).toHaveAttribute('href', new RegExp(`/assets/assets/${created[0]}$`));

    // Add the missing connection to the SIM register from the report: it becomes matched.
    await page.getByRole('tab', { name: /^Needs attention/ }).click();
    await main.getByRole('listitem').filter({ hasText: missing }).getByRole('button', { name: 'Add to SIM register' }).click();
    await expect(page.getByText('1 SIM added to the register')).toBeVisible();
    await expect(main.getByText('Everything matches')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Matched 2$/ })).toBeVisible();

    const after = await (await request.get(`/assets/api/reconciliations/${runId}`, { headers: auth(owner) })).json();
    expect(after.summary.MATCHED).toBe(2);
    expect(after.summary.MISSING_IN_SYSTEM).toBe(0);
    const added = after.items.find((i: { key: string }) => i.key === missing);
    expect(added.entity?.kind).toBe('ASSET');
    created.push(added.entity.id);

    // Phones: the report is readable at 360 px (no horizontal page scroll).
    await page.setViewportSize({ width: 360, height: 740 });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Airtel connections check' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  } finally {
    for (const id of created) await retire(request, owner, id);
    if (wasOn === false) await request.put('/api/platform/company/modules', { headers: auth(owner), data: { assets: { sims: false } } });
  }
});
