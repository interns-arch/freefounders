// Files handed from the web app to the phone (downloads) and the punch selfie helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64Bytes, extFor, isBase64, safeFilename, stripDataUrl } from '../src/lib/files.ts';
import { fitWithin, jpegDataUrl } from '../src/lib/photo.ts';

test('file names are safe to save and keep their extension', () => {
  assert.equal(safeFilename('attendance-daily-2026-10-12.xlsx'), 'attendance-daily-2026-10-12.xlsx');
  assert.equal(safeFilename('../a/b:c?.csv'), 'b_c_.csv');
  assert.equal(safeFilename('C:\\Users\\x\\report.csv'), 'report.csv');
  assert.equal(safeFilename('', 'text/csv'), 'download.csv');
  assert.equal(safeFilename('payroll', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'payroll.xlsx');
  assert.equal(safeFilename('.hidden', 'text/plain'), 'hidden.txt');
  assert.equal(safeFilename('photo', 'application/x-unknown'), 'photo');
  const long = safeFilename(`${'x'.repeat(300)}.csv`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.csv'));
});

test('MIME types to extensions', () => {
  assert.equal(extFor('text/csv; charset=utf-8'), 'csv');
  assert.equal(extFor('IMAGE/JPEG'), 'jpg');
  assert.equal(extFor('application/x-thing'), '');
});

test('base64 helpers', () => {
  assert.equal(stripDataUrl('data:text/csv;base64,YW\nJj'), 'YWJj');
  assert.equal(base64Bytes('YWJj'), 3);
  assert.equal(base64Bytes('YQ=='), 1);
  assert.equal(base64Bytes('YWI='), 2);
  assert.equal(base64Bytes(Buffer.from('a'.repeat(1000)).toString('base64')), 1000);
  assert.ok(isBase64('YWJj'));
  assert.ok(isBase64('data:image/jpeg;base64,/9j/AA=='));
  assert.ok(!isBase64('YWJ'));
  assert.ok(!isBase64('a$bc'));
  assert.ok(!isBase64(''));
});

test('selfie: JPEG data URL, longer side at most 720, never enlarged', () => {
  assert.equal(jpegDataUrl('data:image/jpeg;base64,AB\nCD'), 'data:image/jpeg;base64,ABCD');
  assert.equal(jpegDataUrl('ABCD'), 'data:image/jpeg;base64,ABCD');
  assert.deepEqual(fitWithin(3000, 4000), { width: 540, height: 720 });
  assert.deepEqual(fitWithin(1920, 1080), { width: 720, height: 405 });
  assert.deepEqual(fitWithin(480, 640), { width: 480, height: 640 });
});
