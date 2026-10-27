#!/usr/bin/env node
/**
 * Screenshots for the landing page (PLAN.md §24.2): real screens of the DEMO company from the LOCAL dev suite, saved as
 * WebP (each ≤ 200 KB) in apps/web/public/landing/, plus the link-preview picture og.jpg (1200×630).
 *
 *   npm run dev                                   # the suite on http://localhost:8080
 *   node scripts/landing-showcase.mjs             # once: the tidy showcase company (anita.sharma / Demo@1234)
 *   npx --prefix e2e playwright install chromium  # once
 *   node scripts/landing-screenshots.mjs          # all pictures
 *   node scripts/landing-screenshots.mjs tasks og # only these
 *
 * Only a local address is accepted (never the live server: it holds real people). Desktop pictures are 1440×900,
 * phone pictures 390×844 at 2× (780×1688). FF_URL, LANDING_LOGIN and LANDING_PASSWORD override the defaults.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'apps/web/public/landing');
const BASE = process.env.FF_URL ?? 'http://localhost:8080';
const LOGIN = process.env.LANDING_LOGIN ?? 'anita.sharma'; // the showcase company (scripts/landing-showcase.mjs)
const PASSWORD = process.env.LANDING_PASSWORD ?? 'Demo@1234';
const MAX_BYTES = 200 * 1024;

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE)) {
  console.error(`Refusing ${BASE}: screenshots are made from the local demo suite only (never the live server).`);
  process.exit(1);
}

const require = createRequire(path.join(ROOT, 'e2e/package.json'));
const { chromium } = require('@playwright/test');

/** Each picture: where to go and what to do first. */
const SHOTS = [
  { name: 'home', view: 'desktop', url: '/?home=1' },
  { name: 'attendance', view: 'desktop', url: '/attendance/team' },
  { name: 'tasks', view: 'desktop', url: '/tasks/tasks?tab=all' },
  { name: 'task-chain', view: 'desktop', url: '/tasks/tasks?tab=chains', prepare: openFirstChain },
  { name: 'assets', view: 'desktop', url: '/assets/assets' },
  { name: 'visitors', view: 'desktop', url: '/visitors/today' },
  { name: 'admin', view: 'desktop', url: '/people' },
  { name: 'billing', view: 'desktop', url: '/billing', prepare: hideDevTools },
  { name: 'phone-attendance', view: 'phone', url: '/attendance' },
  { name: 'phone-home', view: 'phone', url: '/?home=1' },
];

const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.includes(name);

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, null, { timeout: 60_000 }).catch(() => console.warn('  (still loading after 60 s)'));
  // Toasts and focus rings are not part of the picture.
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none!important} *:focus{outline:none!important}' });
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(700);
}

/** Billing: the dev-only test panel (BILLING_DEV_TOOLS) is not part of the product. */
async function hideDevTools(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('main [class*="border-dashed"]')) if (/Dev tools/.test(el.textContent ?? '')) el.style.display = 'none';
  });
  await page.waitForTimeout(300);
}

/** Tasks → Chains: open the first chain (its tree: who gave which part to whom). */
async function openFirstChain(page) {
  const row = page.locator('main tbody tr').first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await page.getByRole('dialog').waitFor();
    await settle(page);
  }
}

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email, username or employee ID').fill(LOGIN);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => location.pathname !== '/login', null, { timeout: 30_000 });
}

/** PNG → WebP (or JPEG) in the browser itself (no image library needed), lowering quality until it fits. */
async function encode(page, png, type = 'image/webp') {
  const b64 = png.toString('base64');
  for (const q of [0.86, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4]) {
    const out = await page.evaluate(
      async ({ b64, type, q }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL(type, q).split(',')[1];
      },
      { b64, type, q },
    );
    const buf = Buffer.from(out, 'base64');
    if (buf.length <= MAX_BYTES || q === 0.4) return { buf, q };
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const common = { colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-IN', timezoneId: 'Asia/Kolkata' };
const contexts = {
  desktop: await browser.newContext({ ...common, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
  phone: await browser.newContext({
    ...common,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
    geolocation: { latitude: 19.1197, longitude: 72.8468 },
  }),
};
const pages = {};
try {
  for (const [view, ctx] of Object.entries(contexts)) {
    if (!SHOTS.some((s) => s.view === view && wanted(s.name))) continue;
    pages[view] = await ctx.newPage();
    await signIn(pages[view]);
  }
  for (const shot of SHOTS.filter((s) => wanted(s.name))) {
    const page = pages[shot.view];
    await page.goto(`${BASE}${shot.url}`);
    await settle(page);
    if (shot.prepare) await shot.prepare(page);
    const { buf, q } = await encode(page, await page.screenshot());
    writeFileSync(path.join(OUT, `${shot.name}.webp`), buf);
    console.log(`✔ ${shot.name}.webp  ${Math.round(buf.length / 1024)} KB (q ${q})  ${page.url().replace(BASE, '')}`);
  }

  // Link preview (og:image): the landing page's first screen, signed out, 1200×630.
  if (wanted('og')) {
    const ctx = await browser.newContext({ ...common, viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await settle(page);
    const { buf, q } = await encode(page, await page.screenshot(), 'image/jpeg');
    writeFileSync(path.join(OUT, 'og.jpg'), buf);
    console.log(`✔ og.jpg  ${Math.round(buf.length / 1024)} KB (q ${q})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
