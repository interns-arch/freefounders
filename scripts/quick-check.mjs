#!/usr/bin/env node
/**
 * Quick check for the testing phase (founder, 2026-10-24): env + code only, a few minutes, instead of the full suites.
 * The full run (all unit suites + all e2e) is for when the product is declared final.
 *
 *   npm run quick-check                  env + typechecks + web rules/typecheck + Django check
 *   npm run quick-check -- --server      also compare the server .env key names (needs ssh access; never prints values)
 *   npm run quick-check -- --tests platform,tasks,assets   also run the unit suites of the areas you changed
 *   npm run quick-check -- --smoke       also run the 10-step API smoke against the running suite (:8080)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const tests = (args[args.indexOf('--tests') + 1] ?? '').split(',').filter((a) => args.includes('--tests') && a);
const results = [];

function step(name, cmd, cwd = root, env = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'pipe', env: { ...process.env, ...env }, encoding: 'utf8' });
  const ok = r.status === 0;
  results.push({ name, ok, secs: Math.round((Date.now() - t) / 1000) });
  console.log(`${ok ? '✔' : '✖'} ${name} (${results.at(-1).secs}s)`);
  if (!ok) console.log(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n'));
}

// 1. Env: every ${VAR} the deploy compose file uses must be documented in an .env.example or written by gen-env.sh.
const compose = readFileSync(join(root, 'infra/deploy/docker-compose.yml'), 'utf8');
const used = [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]))];
const documented = ['services/platform/.env.example', 'services/assets/.env.example', 'services/tasks/backend/.env.example', 'infra/deploy/gen-env.sh', 'infra/deploy/README.md']
  .filter((f) => existsSync(join(root, f)))
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');
const undocumented = used.filter((v) => !new RegExp(`\\b${v}\\b`).test(documented));
results.push({ name: 'env: compose variables documented', ok: !undocumented.length, secs: 0 });
console.log(`${undocumented.length ? '✖' : '✔'} env: ${used.length} compose variables documented${undocumented.length ? ` (missing: ${undocumented.join(', ')})` : ''}`);

if (args.includes('--server')) {
  try {
    const keys = execSync(
      `ssh -i ~/.ssh/cartrends-ec2.pem -o ConnectTimeout=30 ubuntu@52.66.83.8 "sudo cut -d= -f1 /opt/freefounders/.env"`,
      { encoding: 'utf8', shell: 'bash' },
    ).split('\n').map((s) => s.trim()).filter((s) => /^[A-Z0-9_]+$/.test(s));
    // Required on the server: the ones compose uses without a default (`${VAR}` or `${VAR:?…}`).
    const required = [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)(\}|:\?)/g)].map((m) => m[1]))];
    const missing = required.filter((v) => !keys.includes(v));
    results.push({ name: 'env: server .env has required keys', ok: !missing.length, secs: 0 });
    console.log(`${missing.length ? '✖' : '✔'} env: server .env has the ${required.length} required keys${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  } catch {
    results.push({ name: 'env: server .env', ok: false, secs: 0 });
    console.log('✖ env: could not read the server .env key names (ssh)');
  }
}

// 2. Code: typechecks + web rules, no test suites.
step('platform typecheck', 'npm run typecheck', join(root, 'services/platform'));
step('assets typecheck', 'npm run typecheck', join(root, 'services/assets'));
step('web rules', 'node scripts/check-web-rules.mjs');
step('web typecheck', 'npm run web:typecheck');
const py = join(root, 'services/tasks/backend/.venv/Scripts/python.exe');
step('tasks django check + migrations in sync', `"${existsSync(py) ? py : 'python'}" manage.py check && "${existsSync(py) ? py : 'python'}" manage.py makemigrations --check --dry-run`, join(root, 'services/tasks/backend'), { DATABASE_URL: '', NOTIF_SCHEDULER: 'false' });

// 3. Optional: unit suites of the areas changed, and the API smoke.
if (tests.includes('platform')) step('platform tests', 'npm test', join(root, 'services/platform'));
if (tests.includes('assets')) step('assets tests', 'npm test', join(root, 'services/assets'));
if (tests.includes('tasks')) step('tasks tests', `"${existsSync(py) ? py : 'python'}" manage.py test --parallel auto`, join(root, 'services/tasks/backend'), { DATABASE_URL: '', NOTIF_SCHEDULER: 'false' });
if (args.includes('--smoke')) step('smoke (running suite)', 'node scripts/smoke.mjs');

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `✖ ${failed.length} of ${results.length} failed` : `✔ all ${results.length} checks passed`}`);
process.exit(failed.length ? 1 : 0);
