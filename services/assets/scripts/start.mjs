// `npm start` — production mode: one server on http://localhost:3000 serving API + built web app.
// Run `npm run build` first. Uses DATABASE_URL if set, otherwise the bundled local PostgreSQL.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { API_DIST, ensureDatabase, localUrl, publicUrl, ROOT, run, startPostgres } from './pg.mjs';

if (!fs.existsSync(path.join(API_DIST, 'main.js')) || !fs.existsSync(path.join(ROOT, 'apps', 'web', 'dist', 'index.html'))) {
  console.error('✖ Build not found. Run `npm run build` first.');
  process.exit(1);
}

// On a host like Render the bundled database would be wiped on every restart — require a real one.
if (process.env.RENDER && !process.env.DATABASE_URL) {
  console.error('✖ DATABASE_URL is not set. In Render: open the database → copy the Internal Database URL →');
  console.error('  this web service → Environment → add DATABASE_URL → Save (it redeploys by itself).');
  process.exit(1);
}

const PORT = process.env.PORT ?? '3000';
const PUBLIC_URL = publicUrl(PORT);
const env = { DATABASE_URL: process.env.DATABASE_URL ?? localUrl('eam'), NODE_ENV: 'production', PORT, ...(PUBLIC_URL ? { PUBLIC_URL } : {}) };
const db = await startPostgres();
await ensureDatabase('eam');
await run([path.join(API_DIST, 'db', 'migrate.js')], { env });
// Empty database: demo data by default, or just roles + first admin with SEED_DEMO=false.
await run([path.join(API_DIST, 'seed', 'seed.js'), ...(process.env.SEED_DEMO === 'false' ? ['--bootstrap'] : [])], { env });

const api = spawn(process.execPath, [path.join(API_DIST, 'main.js')], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
console.log(`\n  ➜ Open http://localhost:${env.PORT}${PUBLIC_URL ? `  ·  phones: ${PUBLIC_URL}` : ''}\n`);

async function shutdown() {
  api.kill();
  await db.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
api.on('exit', (code) => void db.stop().finally(() => process.exit(code ?? 0)));
