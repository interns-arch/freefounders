// `npm test` — unit tests (shared rules) + API integration tests against a throwaway database.
import { globSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDatabase, localUrl, ROOT, run, startPostgres, TSC } from './pg.mjs';

const TEST_UPLOADS = path.join(ROOT, '.data', 'test-uploads');
const db = await startPostgres();
let failed = false;
try {
  await ensureDatabase('eam_test', { recreate: true });
  await run([TSC, '-b', 'apps/api']);
  const env = { DATABASE_URL: process.env.TEST_DATABASE_URL ?? localUrl('eam_test'), NODE_ENV: 'test', UPLOAD_DIR: TEST_UPLOADS };
  await run([path.join(ROOT, 'apps', 'api', 'dist', 'db', 'migrate.js')], { env });
  const files = [
    ...globSync('packages/shared/dist/**/*.test.js', { cwd: ROOT }),
    ...globSync('apps/api/dist/**/*.test.js', { cwd: ROOT }),
  ];
  await run(['--test', '--test-concurrency=1', ...files], { env });
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  await db.stop().catch(() => {});
  rmSync(TEST_UPLOADS, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
