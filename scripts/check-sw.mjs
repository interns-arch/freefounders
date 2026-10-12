// Build check for the web app's service worker (PLAN.md §19.18), run after `vite build` (apps/web `npm run build`):
// - dist/sw.js is emitted and is a classic script (no import/export left, Android's WebView registers it as-is);
// - it precaches index.html and every script/style that index.html loads (the app shell);
// - nothing from the APIs or uploads is precached, and the page route leaves those paths alone;
// - the old Tasks kill-switch (dist/tasks/sw.js) is still there and is not precached.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'dist');
const fail = (msg) => {
  console.error(`✖ Service worker check: ${msg}`);
  process.exit(1);
};

const swPath = join(dist, 'sw.js');
if (!existsSync(swPath)) fail('dist/sw.js was not emitted');
const sw = readFileSync(swPath, 'utf8');
if (/^\s*(import|export)\s/m.test(sw) || /\bexport\s*\{/.test(sw)) fail('dist/sw.js still has import/export (must be a classic script)');

const urls = [...sw.matchAll(/(?:"url"|\burl):"([^"]+)"/g)].map((m) => m[1]);
if (urls.length < 5) fail(`the precache list looks empty (${urls.length} entries)`);
const never = [/^\/?api\//, /^\/?tasks\/api\//, /^\/?assets\/api\//, /^\/?media\//, /^\/?tasks\//, /^\/?sw\.js$/];
const bad = urls.filter((u) => never.some((re) => re.test(u)));
if (bad.length) fail(`API, upload or kill-switch paths are precached: ${bad.join(', ')}`);
if (!urls.includes('index.html')) fail('index.html (the app shell) is not precached');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const shell = [...html.matchAll(/(?:src|href)="\/(static\/[^"]+)"/g)].map((m) => m[1]);
const missing = shell.filter((f) => !urls.includes(f));
if (missing.length) fail(`files index.html loads are not precached: ${missing.join(', ')}`);

// The page route's denylist: the four API/upload prefixes must be in the built worker.
for (const prefix of ['api', 'tasks\\/api', 'assets\\/api', 'media']) {
  if (!sw.includes(`/^\\/${prefix}\\//`)) fail(`the page route does not leave /${prefix.replace('\\', '')}/ alone`);
}
if (!existsSync(join(dist, 'tasks', 'sw.js'))) fail('the old Tasks kill-switch dist/tasks/sw.js is missing');

console.log(`✔ Service worker: ${urls.length} files precached (app shell incl.), API and upload paths left to the network`);
