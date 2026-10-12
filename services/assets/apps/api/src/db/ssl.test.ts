// Database TLS settings (docs/security/assets-web-mobile-infra.md): verified certificates on request.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { databaseSsl } from './db.service';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('database TLS: local needs none, remote is encrypted, verify-full checks the certificate', () => {
  const remote = 'postgres://u:p@db.example.com:5432/eam';
  withEnv({ DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/eam', PGSSLMODE: undefined, PGSSLROOTCERT: undefined }, () => assert.equal(databaseSsl(), undefined));
  withEnv({ DATABASE_URL: remote, PGSSLMODE: undefined, PGSSLROOTCERT: undefined }, () => assert.deepEqual(databaseSsl(), { rejectUnauthorized: false }));
  withEnv({ DATABASE_URL: remote, PGSSLMODE: 'disable', PGSSLROOTCERT: undefined }, () => assert.equal(databaseSsl(), undefined));
  withEnv({ DATABASE_URL: remote, PGSSLMODE: 'verify-full', PGSSLROOTCERT: undefined }, () => assert.deepEqual(databaseSsl(), { rejectUnauthorized: true }));
  const ca = path.join(mkdtempSync(path.join(tmpdir(), 'ff-ca-')), 'ca.pem');
  writeFileSync(ca, 'CERT');
  withEnv({ DATABASE_URL: remote, PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca }, () => assert.deepEqual(databaseSsl(), { rejectUnauthorized: true, ca: 'CERT' }));
});
