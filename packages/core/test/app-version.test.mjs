// The phone app's update prompt (PLAN.md §19.30): which installed app is older than the one the server needs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOlderVersion } from '../src/app-version.ts';

test('older app versions are found, newer and equal ones are not', () => {
  assert.equal(isOlderVersion('1.0.0', '1.1.0'), true);
  assert.equal(isOlderVersion('1.1.0', '1.1.0'), false);
  assert.equal(isOlderVersion('1.2.0', '1.1.0'), false);
  assert.equal(isOlderVersion('1.9.9', '1.10.0'), true);
  assert.equal(isOlderVersion('2', '1.1.0'), false);
  assert.equal(isOlderVersion('1.1', '1.1.0'), false);
});

test('no version (a browser) or no minimum (prompt off) never asks', () => {
  assert.equal(isOlderVersion(null, '1.1.0'), false);
  assert.equal(isOlderVersion('1.0.0', null), false);
  assert.equal(isOlderVersion('', ''), false);
  assert.equal(isOlderVersion('e2e', '1.1.0'), false); // a test or development build
});
