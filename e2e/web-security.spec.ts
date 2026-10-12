// Security review 2026-10-12 (docs/security/assets-web-mobile-infra.md): checks against the running suite.
import { expect, test } from '@playwright/test';

const OWNER = { login: process.env.FF_OWNER ?? 'owner', password: process.env.FF_OWNER_PASSWORD ?? 'Demo@1234' };
const XRW = { 'x-requested-with': 'XMLHttpRequest' };

test('links made from typed data: only web, e-mail, phone and same-site addresses become links', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ type: 'module', content: "import * as m from '/src/lib/safe-url.ts'; window.ffSafeUrl = m;" });
  await page.waitForFunction(() => 'ffSafeUrl' in window);
  const out = await page.evaluate(() => {
    const { safeHref } = (window as unknown as { ffSafeUrl: typeof import('../apps/web/src/lib/safe-url') }).ffSafeUrl;
    const inputs = [
      'https://example.com/a?b=1',
      'HTTP://example.com',
      'mailto:a@b.c',
      'tel:+919876543210',
      '/media/tasks/file.pdf',
      ' javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'file:///etc/passwd',
      '//evil.example/x',
      '/\\evil.example/x',
      '',
      null,
    ];
    return inputs.map((i) => [i, safeHref(i as string | null) ?? null]);
  });
  expect(out).toEqual([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['tel:+919876543210', 'tel:+919876543210'],
    ['/media/tasks/file.pdf', '/media/tasks/file.pdf'],
    [' javascript:alert(1)', null],
    ['JaVaScRiPt:alert(1)', null],
    ['data:text/html,<script>alert(1)</script>', null],
    ['vbscript:x', null],
    ['file:///etc/passwd', null],
    ['//evil.example/x', null],
    ['/\\evil.example/x', null],
    ['', null],
    [null, null],
  ]);
});

test("Assets' own password login is off in multi-company mode, even with a cookie naming the company", async ({ request }) => {
  const res = await request.post('/api/platform/auth/login', { data: { login: OWNER.login, password: OWNER.password, client: 'mobile' }, headers: XRW });
  expect(res.ok()).toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  const cid = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).cid as string;
  // A login that does not exist (never the owner's: no lockout counting); refused before any password is checked.
  const login = await request.post('/assets/api/auth/login', {
    data: { login: 'no-such-person-security-check', password: 'not-a-password' },
    headers: { ...XRW, cookie: `eam_session=${cid}~${'x'.repeat(43)}` },
  });
  expect(login.status()).toBe(401);
  expect(((await login.json()) as { code?: string }).code).toBe('no_company');
});

test('API answers carry the safety headers; mutating calls need the X-Requested-With header', async ({ request }) => {
  const config = await request.get('/assets/api/config');
  expect(config.headers()['x-content-type-options']).toBe('nosniff');
  expect(config.headers()['x-powered-by']).toBeUndefined();
  expect((await request.post('/assets/api/auth/logout')).status()).toBe(403);
});
