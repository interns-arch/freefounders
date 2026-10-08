// Starts the local PostgreSQL (port 5434) and keeps it running until Ctrl+C.
// Used by the whole-suite dev script and for running the Tasks multi-company tests by hand.
import { startPostgres } from './pg.mjs';

const db = await startPostgres();
console.log(db.external ? '• PostgreSQL already running on 5434' : '✔ PostgreSQL running on 5434');
const stop = async () => {
  await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (!db.external) setInterval(() => {}, 1 << 30);
