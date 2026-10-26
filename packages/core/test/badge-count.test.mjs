// Count badges (PLAN.md §19.42): both services' answers in one shape, totals per area, and the counter text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLabel, NO_BADGES, toBadges } from '../src/badge-count.ts';

test('nothing (or a failed service) is all zeros', () => {
  assert.equal(NO_BADGES.total, 0);
  assert.deepEqual(toBadges(null, undefined), NO_BADGES);
  assert.deepEqual(toBadges({ tasks: { my_tasks: -2, to_accept: 'x' } }, { approve: Number.NaN }), NO_BADGES);
});

test('totals per area and overall', () => {
  const b = toBadges(
    { tasks: { my_tasks: 5, to_accept: 2, requests: 1 }, hr: { leave: 3, corrections: 1 } },
    { approve: 1, fulfil: 2, tickets: 4, exits: 1 },
  );
  assert.deepEqual(b.tasks, { myTasks: 5, toAccept: 2, requests: 1, total: 8 });
  assert.deepEqual(b.attendance, { leave: 3, corrections: 1, approvals: 4, total: 4 });
  assert.deepEqual(b.assets, { approve: 1, fulfil: 2, requests: 3, tickets: 4, exits: 1, total: 8 });
  assert.equal(b.total, 20);
  assert.deepEqual(toBadges({ visitors: { waiting: 2, approvals: 1 } }, null).visitors, { waiting: 2, approvals: 1, total: 3 });
});

test('counter text: hidden at 0, 1–99, then 99+', () => {
  assert.equal(countLabel(0), '');
  assert.equal(countLabel(undefined), '');
  assert.equal(countLabel(-1), '');
  assert.equal(countLabel(5), '5');
  assert.equal(countLabel(99), '99');
  assert.equal(countLabel(100), '99+');
});
