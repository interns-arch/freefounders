// `npm run dev` (repo root): the whole FreeFounders suite on http://localhost:8080 with single login,
// in multi-company mode (one schema per company in Tasks and Assets, PLAN.md §14).
//
// Starts: PostgreSQL (:5434, Platform + Tasks), Platform API (:4000), Tasks API (:8000) + worker, Assets API (:3000),
// the FreeFounders web app (:5176) and the gateway
// (:8080) that puts them on one address.
// Once everything answers, every company is set up in its apps (`company sync`). Ctrl+C stops everything.
// First time: `npm run setup` (installs every part's dependencies).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGateway } from '../infra/gateway/dev-gateway.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const at = (...p) => path.join(ROOT, ...p);
const TASKS_PY = WIN ? at('services/tasks/backend/.venv/Scripts/python.exe') : at('services/tasks/backend/.venv/bin/python');
const JWKS = 'http://127.0.0.1:4000/api/platform/.well-known/jwks.json';

const missing = [
  ['services/platform/node_modules', 'services/platform'],
  ['services/assets/node_modules', 'services/assets'],
  ['node_modules', '.'],
].filter(([dir]) => !existsSync(at(dir)));
if (missing.length || !existsSync(TASKS_PY)) {
  console.error('✖ Dependencies are missing. Run once:  npm run setup');
  process.exit(1);
}

const COLORS = { platform: 35, tasks: 32, 'tasks-job': 32, assets: 33, web: 36 };
const children = [];
let stopping = false;

function start(name, cmd, args, { cwd, env = {} }) {
  const child = spawn(cmd, args, { cwd: at(cwd), env: { ...process.env, ...env }, shell: WIN && !cmd.endsWith('.exe'), stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${COLORS[name] ?? 37}m${name.padEnd(9)}\x1b[0m│ `;
  const relay = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) if (line.trim()) out.write(tag + line + '\n');
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => code && !stopping && console.error(`${tag}exited with code ${code}`));
  children.push(child);
  return child;
}

const shared = { PLATFORM_JWKS_URL: JWKS, VITE_PLATFORM_LOGIN: 'true', TENANCY: 'schemas' };
const INTERNAL = { TASKS_INTERNAL_URL: 'http://127.0.0.1:8000/api/internal', ASSETS_INTERNAL_URL: 'http://127.0.0.1:3000/api/internal', EVENT_POLL_SECONDS: '5' };

// One local PostgreSQL for the Platform and Tasks (Assets runs its own on :5433).
const pg = await import(pathToFileURL(at('services/platform/scripts/pg.mjs')).href);
const postgres = await pg.startPostgres();
await pg.ensureDatabase('ff_tasks');

// Sign-up and billing for testing (PLAN.md §21), dev only: one-time codes shown on screen (and in this log), the fake
// payment gateway's signing secret (a public test value), the billing dev tools, invite links on this address.
const SIGNUP_DEV = {
  OTP_DEV_ECHO: '1',
  BILLING_DEV_TOOLS: '1',
  FAKE_GATEWAY_SECRET: 'dev-only-fakepay-secret-not-for-production',
  PUBLIC_WEB_URL: process.env.PUBLIC_URL ?? 'http://localhost:8080',
  BILLING_TICK_SECONDS: '60',
};
start('platform', 'npm', ['run', 'dev'], { cwd: 'services/platform', env: { ...INTERNAL, ...SIGNUP_DEV } });

// The phone app (apps/mobile) reaches the suite over the Wi-Fi at http://<this PC's LAN address>:8080, so Django
// must accept those addresses as hosts too (dev only; the gateway already listens on every interface).
const LAN_HOSTS = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a.address);

const djangoEnv = {
  ...shared,
  DATABASE_URL: pg.localUrl('ff_tasks'),
  DB_SSLMODE: 'disable',
  DB_CONN_MAX_AGE: '0', // runserver leaks a persistent connection per request thread (see settings.py)
  DEBUG: 'true',
  ALLOWED_HOSTS: ['localhost', '127.0.0.1', ...LAN_HOSTS].join(','),
  NOTIF_SCHEDULER: 'false',
  PYTHONUNBUFFERED: '1',
};
console.log('• Migrating Tasks (every company)…');
execFileSync(TASKS_PY, ['manage.py', 'migrate_companies'], { cwd: at('services/tasks/backend'), env: { ...process.env, ...djangoEnv }, stdio: 'ignore' });
start('tasks', TASKS_PY, ['manage.py', 'runserver', '127.0.0.1:8000'], { cwd: 'services/tasks/backend', env: djangoEnv });
start('tasks-job', TASKS_PY, ['manage.py', 'run_worker'], { cwd: 'services/tasks/backend', env: djangoEnv });
// Assets API (every screen is in the FreeFounders web app, PLAN.md §19.10).
start('assets', 'npm', ['run', 'dev'], { cwd: 'services/assets', env: { ...shared, PUBLIC_URL: process.env.PUBLIC_URL ?? 'http://localhost:8080' } });
// The FreeFounders web app (apps/web): everything else on :8080.
start('web', 'npx', ['vite', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], { cwd: 'apps/web' });

await startGateway(8080);

// Every company gets its schema in each app, and existing app access is re-linked (safe to repeat).
async function up(url) {
  for (let i = 0; i < 240; i++) {
    if (stopping) return false;
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
const ready = await Promise.all(['http://127.0.0.1:4000/api/platform/health', 'http://127.0.0.1:8000/health', 'http://127.0.0.1:3000/api/health'].map(up));
if (ready.every(Boolean)) {
  // The Platform's file watcher may restart it once more right after start-up: retry a couple of times.
  let synced = false;
  for (let attempt = 1; attempt <= 3 && !synced && !stopping; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 5000));
    try {
      execFileSync(process.execPath, ['dist/companies.js', 'sync'], { cwd: at('services/platform'), env: { ...process.env, ...INTERNAL }, stdio: 'inherit' });
      synced = true;
    } catch {
      if (attempt < 3) console.log('• Sync did not finish; retrying…');
    }
  }
  if (!synced) console.error('✖ Could not set up the companies in Tasks/Assets (see above). Retry: npm --prefix services/platform run company -- sync');
} else if (!stopping) {
  console.error('✖ Not every service started; companies were not synced.');
}
console.log(`
  ✔ FreeFounders is starting on  http://localhost:8080
    Sign in as  owner  /  Demo@1234  (first run: give yourself Tasks and Assets in People & access)
    Phone app on the same Wi-Fi: ${LAN_HOSTS.map((h) => `http://${h}:8080`).join('  ') || '(no LAN address found)'}  (npm run mobile)
    Multi-company mode: each company's Tasks and Assets data lives in its own schema.
    Ctrl+C stops everything.
`);

function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    // npm/npx run behind a shell on Windows; kill the whole tree.
    if (WIN) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  setTimeout(async () => {
    await postgres.stop().catch(() => {});
    process.exit(0);
  }, 1500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
