// `npm run dev` (repo root): the whole FreeFounders suite on http://localhost:8080 with single login.
//
// Starts: Platform API (:4000), Tasks API (:8000) + web (:5174), Assets API (:3000) + web (:5173),
// Portal (:5175) and the gateway (:8080) that puts them on one address. Ctrl+C stops everything.
// First time: `npm run setup` (installs every part's dependencies).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startGateway } from '../infra/gateway/dev-gateway.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const at = (...p) => path.join(ROOT, ...p);
const TASKS_PY = WIN ? at('services/tasks/backend/.venv/Scripts/python.exe') : at('services/tasks/backend/.venv/bin/python');
const JWKS = 'http://127.0.0.1:4000/api/platform/.well-known/jwks.json';

const missing = [
  ['services/platform/node_modules', 'services/platform'],
  ['services/assets/node_modules', 'services/assets'],
  ['services/tasks/frontend/node_modules', 'services/tasks/frontend'],
  ['apps/portal/node_modules', 'apps/portal'],
].filter(([dir]) => !existsSync(at(dir)));
if (missing.length || !existsSync(TASKS_PY)) {
  console.error('✖ Dependencies are missing. Run once:  npm run setup');
  process.exit(1);
}

const COLORS = { platform: 35, tasks: 32, 'tasks-web': 92, assets: 33, portal: 36 };
const children = [];

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

const shared = { PLATFORM_JWKS_URL: JWKS, VITE_PLATFORM_LOGIN: 'true' };

start('platform', 'npm', ['run', 'dev'], {
  cwd: 'services/platform',
  env: { TASKS_INTERNAL_URL: 'http://127.0.0.1:8000/api/internal', ASSETS_INTERNAL_URL: 'http://127.0.0.1:3000/api/internal' },
});

const djangoEnv = { ...shared, DATABASE_URL: '', DEBUG: 'true', ALLOWED_HOSTS: 'localhost,127.0.0.1', NOTIF_SCHEDULER: 'false', PYTHONUNBUFFERED: '1' };
execFileSync(TASKS_PY, ['manage.py', 'migrate', '--noinput'], { cwd: at('services/tasks/backend'), env: { ...process.env, ...djangoEnv }, stdio: 'ignore' });
start('tasks', TASKS_PY, ['manage.py', 'runserver', '127.0.0.1:8000'], { cwd: 'services/tasks/backend', env: djangoEnv });
start('tasks-web', 'npx', ['vite', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { cwd: 'services/tasks/frontend', env: { ...shared, VITE_BASE: '/tasks/' } });
start('assets', 'npm', ['run', 'dev'], { cwd: 'services/assets', env: { ...shared, VITE_BASE: '/assets/', PUBLIC_URL: process.env.PUBLIC_URL ?? 'http://localhost:8080' } });
start('portal', 'npx', ['vite', '--host', '127.0.0.1'], { cwd: 'apps/portal' });

await startGateway(8080);
console.log(`
  ✔ FreeFounders is starting on  http://localhost:8080
    Sign in as  owner  /  Demo@1234  (first run: give yourself Tasks and Assets in People & access)
    Ctrl+C stops everything.
`);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    // npm/npx run behind a shell on Windows; kill the whole tree.
    if (WIN) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
