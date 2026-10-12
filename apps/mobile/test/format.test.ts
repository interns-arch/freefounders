import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableOn, withAlpha } from '../src/lib/colour.ts';
import { daysUntil, fmtDay, fmtMinutes, monthCells, workedMinutes } from '../src/lib/format.ts';

test('month grid starts on Monday and fills whole weeks', () => {
  const oct = monthCells(2026, 10); // 1 Oct 2026 is a Thursday
  assert.equal(oct.length % 7, 0);
  assert.deepEqual(oct.slice(0, 4), [null, null, null, '2026-10-01']);
  assert.equal(oct.filter(Boolean).length, 31);
  const feb = monthCells(2027, 2); // 1 Feb 2027 is a Monday, 28 days
  assert.equal(feb[0], '2027-02-01');
  assert.equal(feb.length, 28);
});

test('formats', () => {
  assert.equal(fmtDay('2026-10-20'), '20 Oct 2026');
  assert.equal(fmtMinutes(45), '45m');
  assert.equal(fmtMinutes(425), '7h 05m');
  assert.equal(daysUntil('2026-10-20', new Date(2026, 9, 12, 18)), 8);
  const checkIn = new Date(2026, 9, 12, 9, 30).toISOString();
  assert.equal(workedMinutes({ check_in: checkIn, check_out: null, working_minutes: 0 }, new Date(2026, 9, 12, 11, 0)), 90);
  assert.equal(workedMinutes({ check_in: checkIn, check_out: checkIn, working_minutes: 480 }), 480);
});

test('brand colour helpers', () => {
  assert.equal(readableOn('#2458f5'), '#ffffff');
  assert.equal(readableOn('#f5d90a'), '#111e19');
  assert.equal(withAlpha('#007856', 0.5), '#00785680');
});
