// `npm run dev`: local database + migrations + demo company, then the API with auto-restart on :4000.
import { spawn } from 'node:child_process';
import { ensureDatabase, localUrl, run, startPostgres, TSC, ROOT } from './pg.mjs';

const db = await startPostgres();
await ensureDatabase('ff_platform');
const env = { DATABASE_URL: process.env.DATABASE_URL ?? localUrl('ff_platform') };
await run([TSC, '-p', '.']);
await run(['dist/db/migrate.js'], { env });
await run(['dist/seed.js'], { env });

const children = [
  spawn(process.execPath, [TSC, '-p', '.', '-w', '--preserveWatchOutput'], { cwd: ROOT, stdio: 'ignore' }),
  spawn(process.execPath, ['--watch-path', 'dist', 'dist/main.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } }),
];
const stop = async () => {
  for (const c of children) c.kill();
  await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
