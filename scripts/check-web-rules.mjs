// The redesign rules of the web app (PLAN.md §6, §18.2), checked before every typecheck/build:
//   1. Screens (src/app, src/features) get data only through @freefounders/core hooks: no fetch, no HTTP client.
//   2. Screens use theme colours only: no hex / rgb / hsl / oklch colour literals, no fixed Tailwind palette colours
//      (blue-700, emerald-50…; PLAN.md §19.1), so the brand colour and dark mode reach every screen.
// A redesign then only touches screens and the theme, never the logic.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderNative } from '../packages/theme/scripts/build-native.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['apps/web/src/app', 'apps/web/src/features'];

const RULES = [
  { re: /\bfetch\s*\(/, why: 'calls fetch — add an API function + hook in packages/core instead' },
  { re: /\bXMLHttpRequest\b|\bnew WebSocket\b/, why: 'talks to the network — use a hook from @freefounders/core' },
  { re: /\b(platformApi|tasksApi|assetsApi|createHttp)\b/, why: 'uses the HTTP client — screens use hooks from @freefounders/core' },
  { re: /from ['"][^'"]*packages\/core\/src/, why: 'imports core internals — import from @freefounders/core(/area)' },
  { re: /(['"`\s(:])#[0-9a-fA-F]{3,8}\b/, why: 'hard-codes a colour — use a theme colour (e.g. text-primary, bg-success)' },
  { re: /\b(rgba?|hsla?|oklch)\(\s*\d/, why: 'hard-codes a colour — use a theme colour' },
  {
    re: /(?<![\w/-])(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|from|to|via|fill|stroke|outline|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    why: 'uses a fixed Tailwind colour — use a theme colour (text-info, bg-success/10, border-warning/40…)',
  },
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

// 3. The two copies of the design tokens (CSS for the web, TypeScript for mobile) say the same thing.
{
  const css = readFileSync(path.join(ROOT, 'packages/theme/tokens.css'), 'utf8');
  const ts = readFileSync(path.join(ROOT, 'packages/theme/src/tokens.ts'), 'utf8');
  const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const block = (src, start) => src.slice(src.indexOf(start), src.indexOf('}', src.indexOf(start)));
  for (const [cssStart, tsStart] of [[':root {', 'export const light = {'], ['.dark {', 'export const dark']]) {
    const tsBlock = block(ts, tsStart);
    for (const [, name, value] of block(css, cssStart).matchAll(/--([a-z-]+):\s*(oklch\([^)]*\))/g)) {
      if (!tsBlock.includes(`${camel(name)}: '${value}'`)) problems.push(`packages/theme: --${name} in tokens.css (${cssStart}) is not the same in src/tokens.ts`);
    }
  }
}

// 4. The hex copy for the phone app (packages/theme/src/tokens.native.ts) is generated from tokens.ts and up to date.
{
  let have = '';
  try {
    have = readFileSync(path.join(ROOT, 'packages/theme/src/tokens.native.ts'), 'utf8').replace(/\r\n/g, '\n');
  } catch {}
  if (have !== renderNative(readFileSync(path.join(ROOT, 'packages/theme/src/tokens.ts'), 'utf8'))) {
    problems.push('packages/theme/src/tokens.native.ts is out of date with src/tokens.ts. Run: node packages/theme/scripts/build-native.mjs');
  }
}

if (problems.length) {
  console.error(`✖ Web app rules (PLAN.md §18.2): ${problems.length} problem(s)\n\n${problems.join('\n')}\n`);
  process.exit(1);
}
console.log('✔ Web app rules: screens use @freefounders/core for data and theme colours only');
