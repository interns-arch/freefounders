// `npm test`: builds, then runs the integration tests against a throwaway database.
import { globSync } from 'node:fs';
import { ensureDatabase, localUrl, ROOT, run, startPostgres, TSC } from './pg.mjs';

const db = await startPostgres();
let failed = false;
try {
  await ensureDatabase('ff_platform_test', { recreate: true });
  await run([TSC, '-p', '.']);
  const env = { DATABASE_URL: process.env.TEST_DATABASE_URL ?? localUrl('ff_platform_test'), NODE_ENV: 'test' };
  await run(['dist/db/migrate.js'], { env });
  await run(['--test', '--test-concurrency=1', ...globSync('dist/**/*.test.js', { cwd: ROOT })], { env });
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  await db.stop().catch(() => {});
}
process.exit(failed ? 1 : 0);
