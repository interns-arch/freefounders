// `npm run setup` (repo root): installs every part's dependencies once.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const run = (cmd, args, cwd) => {
  console.log(`• ${cwd}: ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: path.join(ROOT, cwd), stdio: 'inherit', shell: WIN });
};

// '.' = the root workspace: the web app (apps/web) and the shared packages (packages/*).
// 'apps/mobile' (the phone app) has its own install: Expo pins its own React (see apps/mobile/README.md).
for (const dir of ['.', 'services/platform', 'services/assets', 'apps/mobile']) run('npm', ['ci', '--no-audit', '--no-fund'], dir);

const backend = 'services/tasks/backend';
const venvPy = path.join(ROOT, backend, WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(venvPy)) run(WIN ? 'python' : 'python3', ['-m', 'venv', '.venv'], backend);
run(venvPy, ['-m', 'pip', 'install', '-q', '--disable-pip-version-check', '-r', 'requirements.txt'], backend);
console.log('\n✔ Setup done. Start everything with:  npm run dev\n');
