// Behaviour test (PLAN §6 rule 5): finds things by role/label/text, never by CSS, so a redesign
// keeps passing as long as the features still work.
import { expect, type Page, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

async function signIn(page: Page) {
  await page.getByLabel('Email, username or employee ID').fill(OWNER.login);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('one sign-in opens Tasks and Assets, switch between them, sign out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, '1-sign-in');

  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tasks/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Assets/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /People & access/ })).toBeVisible();
  await shot(page, '2-choose-workspace');

  await page.getByRole('button', { name: /^Tasks/ }).click();
  await expect(page).toHaveURL(/\/tasks\/$/);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  const switcher = page.getByRole('navigation', { name: 'Switch app' });
  await expect(switcher.getByRole('link', { name: 'Assets' })).toBeVisible();
  await shot(page, '3-tasks');

  await switcher.getByRole('link', { name: 'Assets' }).click();
  await expect(page).toHaveURL(/\/assets\/$/);
  const assetsSwitch = page.getByRole('navigation', { name: 'Switch app' });
  await expect(assetsSwitch.getByRole('link', { name: 'Tasks' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await shot(page, '4-assets');

  await assetsSwitch.getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/localhost:8080\/(\?.*)?$/);
});

test('opening an app while signed out goes to sign-in, then back to that app', async ({ page }) => {
  await page.goto('/assets/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe('/assets/');
  await signIn(page);
  await expect(page).toHaveURL(/\/assets\/$/);
  await expect(page.getByRole('navigation', { name: 'Switch app' })).toBeVisible({ timeout: 20_000 });
});

test('admins manage people from the portal', async ({ page }) => {
  await page.goto('/?choose');
  await signIn(page);
  await page.getByRole('button', { name: /People & access/ }).click();
  await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Demo Owner/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Tasks access for Demo Owner' })).toBeChecked();
  await shot(page, '5-people');
  await page.getByRole('button', { name: '+ Add person' }).click();
  await expect(page.getByRole('dialog', { name: 'Add person' })).toBeVisible();
  await shot(page, '6-add-person');
});
