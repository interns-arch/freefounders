// The redesign rules of the web app (PLAN.md §6, §18.2), checked before every typecheck/build:
//   1. Screens (src/app, src/features) get data only through @freefounders/core hooks: no fetch, no HTTP client.
//   2. Screens use theme colours only: no hex / rgb / hsl / oklch colour literals.
// A redesign then only touches screens and the theme, never the logic.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['apps/web/src/app', 'apps/web/src/features'];

const RULES = [
  { re: /\bfetch\s*\(/, why: 'calls fetch — add an API function + hook in packages/core instead' },
  { re: /\bXMLHttpRequest\b|\bnew WebSocket\b/, why: 'talks to the network — use a hook from @freefounders/core' },
  { re: /\b(platformApi|tasksApi|assetsApi|createHttp)\b/, why: 'uses the HTTP client — screens use hooks from @freefounders/core' },
  { re: /from ['"][^'"]*packages\/core\/src/, why: 'imports core internals — import from @freefounders/core(/area)' },
  { re: /(['"`\s(:])#[0-9a-fA-F]{3,8}\b/, why: 'hard-codes a colour — use a theme colour (e.g. text-primary, bg-success)' },
  { re: /\b(rgba?|hsla?|oklch)\(\s*\d/, why: 'hard-codes a colour — use a theme colour' },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield p;
  }
}

const problems = [];
for (const dir of DIRS) {
  const abs = path.join(ROOT, dir);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of files(abs)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''); // comments may mention anything
      for (const r of RULES) if (r.re.test(code)) problems.push(`${path.relative(ROOT, file)}:${i + 1}  ${r.why}\n    ${line.trim()}`);
    });
  }
}

if (problems.length) {
  console.error(`✖ Web app rules (PLAN.md §18.2): ${problems.length} problem(s)\n\n${problems.join('\n')}\n`);
  process.exit(1);
}
console.log('✔ Web app rules: screens use @freefounders/core for data and theme colours only');
