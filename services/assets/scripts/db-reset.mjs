// `npm run db:reset` — wipes the local database and re-creates it with fresh demo data.
import path from 'node:path';
import { API_DIST, ensureDatabase, localUrl, run, startPostgres, TSC } from './pg.mjs';

if (process.env.DATABASE_URL) {
  console.error('✖ db:reset only works with the bundled local database (unset DATABASE_URL).');
  process.exit(1);
}
const env = { DATABASE_URL: localUrl('eam') };
const db = await startPostgres();
try {
  await ensureDatabase('eam', { recreate: true });
  await run([TSC, '-b', 'apps/api']);
  await run([path.join(API_DIST, 'db', 'migrate.js')], { env });
  await run([path.join(API_DIST, 'seed', 'seed.js')], { env });
} finally {
  await db.stop().catch(() => {});
}
