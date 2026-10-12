// `node scripts/compress-uploads.mjs [--apply]` — shrinks the photos saved before uploads were compressed (PLAN.md §19.20).
//
// Goes through every stored photo (allocation_photos: the shared tables and, in multi-company mode, every company schema
// in ff.companies; older rows kept on disk under UPLOAD_DIR too), runs it through the same shrinking as a new upload
// (upright, at most 1600 px, quality 72, metadata dropped) and reports the space saved. A dry run by default:
// nothing changes until --apply. With --apply a photo is only replaced when the result is smaller; the row keeps its
// id (links keep working) and gets the new type, size and file name.
//
// Uses DATABASE_URL (default: the local database of `npm run dev`) and builds the API first (the shrinking code lives there).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import pg from 'pg';
import { API_DIST, ROOT, run, TSC } from './pg.mjs';

const apply = process.argv.includes('--apply');
await run([TSC, '-b', 'apps/api']);
const require = createRequire(import.meta.url);
const { shrinkPhoto, sniff } = require(path.join(API_DIST, 'modules', 'assets', 'photo-shrink.js'));
const { databaseSsl, databaseUrl } = require(path.join(API_DIST, 'db', 'db.service.js'));
const { quoteSchema } = require(path.join(API_DIST, 'db', 'tenancy.js'));
const uploadDir = process.env.UPLOAD_DIR ?? path.join(ROOT, '.data', 'uploads');

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const pool = new pg.Pool({ connectionString: databaseUrl(), ssl: databaseSsl(), max: 1 });
const totals = { photos: 0, smaller: 0, before: 0, after: 0, missing: 0 };

try {
  const schemas = ['public'];
  const registry = await pool.query("select to_regclass('ff.companies') is not null as ok");
  if (registry.rows[0].ok) {
    const { rows } = await pool.query('select schema_name from ff.companies order by created_at, schema_name');
    schemas.push(...rows.map((r) => r.schema_name));
  }

  for (const schema of schemas) {
    const table = schema === 'public' ? 'public.allocation_photos' : `${quoteSchema(schema)}.allocation_photos`;
    const exists = await pool.query('select to_regclass($1) is not null as ok', [table]);
    if (!exists.rows[0].ok) continue;
    const { rows: ids } = await pool.query(`select id from ${table} order by created_at`);
    const sum = { photos: 0, smaller: 0, before: 0, after: 0 };
    for (const { id } of ids) {
      // One photo in memory at a time.
      const { rows } = await pool.query(`select id, data, file_name, mime_type from ${table} where id = $1`, [id]);
      const row = rows[0];
      const onDisk = !row.data;
      const file = path.join(uploadDir, row.file_name);
      const data = row.data ?? (fs.existsSync(file) ? fs.readFileSync(file) : null);
      if (!data) {
        totals.missing++;
        continue;
      }
      sum.photos++;
      sum.before += data.length;
      const out = await shrinkPhoto(data, sniff(data));
      if (!out || out.buffer.length >= data.length) {
        sum.after += data.length;
        continue;
      }
      sum.smaller++;
      sum.after += out.buffer.length;
      if (!apply) continue;
      const fileName = row.file_name.replace(/\.[a-z0-9]+$/i, '') + '.' + out.ext;
      if (onDisk) {
        // Older rows live on disk: write the smaller file, then point the row at it.
        fs.writeFileSync(path.join(uploadDir, fileName), out.buffer);
        await pool.query(`update ${table} set file_name = $2, mime_type = $3, size_bytes = $4 where id = $1`, [row.id, fileName, out.mime, out.buffer.length]);
        if (fileName !== row.file_name) fs.rmSync(file, { force: true });
      } else {
        await pool.query(`update ${table} set data = $2, file_name = $3, mime_type = $4, size_bytes = $5 where id = $1`, [row.id, out.buffer, fileName, out.mime, out.buffer.length]);
      }
    }
    if (sum.photos) {
      console.log(`${schema}: ${sum.photos} photo(s), ${sum.smaller} can shrink · ${kb(sum.before)} → ${kb(sum.after)} (saves ${kb(sum.before - sum.after)})`);
    }
    for (const k of Object.keys(sum)) totals[k] += sum[k];
  }

  const saved = totals.before - totals.after;
  const pct = totals.before ? Math.round((saved / totals.before) * 100) : 0;
  console.log(
    `\n${apply ? 'Done' : 'Dry run'}: ${totals.photos} photo(s), ${totals.smaller} ${apply ? 'shrunk' : 'would shrink'} · ` +
      `${kb(totals.before)} → ${kb(totals.after)} · ${apply ? 'saved' : 'would save'} ${kb(saved)} (${pct}%)` +
      (totals.missing ? ` · ${totals.missing} photo file(s) missing on disk (left as they are)` : ''),
  );
  if (!apply && totals.smaller) console.log('Run again with --apply to replace them.');
} finally {
  await pool.end();
}
