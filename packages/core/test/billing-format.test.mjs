// Billing formatters (PLAN.md §21): ₹ with Indian grouping, total in words, GSTIN check, plan prices.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatInr, gstinMatchesState, inrInWords, isGstin, numberInWords, planMaxSeats, planMinSeats, planPrice } from '../src/billing/format.ts';

test('rupees from paise with Indian grouping', () => {
  assert.equal(formatInr(14900), '₹149');
  assert.equal(formatInr(14_900_000), '₹1,49,000');
  assert.equal(formatInr(175840), '₹1,758.40');
  assert.equal(formatInr(14900, true), '₹149.00');
});

test('amounts in Indian words', () => {
  assert.equal(numberInWords(0), 'Zero');
  assert.equal(numberInWords(1758), 'One Thousand Seven Hundred Fifty Eight');
  assert.equal(numberInWords(12_34_56_789), 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
  assert.equal(inrInWords(175840), 'Rupees One Thousand Seven Hundred Fifty Eight and Forty Paise Only');
  assert.equal(inrInWords(87900), 'Rupees Eight Hundred Seventy Nine Only');
});

test('GSTIN format and state code', () => {
  assert.ok(isGstin('27AAPFU0939F1ZV'));
  assert.ok(isGstin('27aapfu0939f1zv'));
  assert.ok(!isGstin('27AAPFU0939F1Z'));
  assert.ok(gstinMatchesState('27AAPFU0939F1ZV', 'Maharashtra'));
  assert.ok(!gstinMatchesState('29AAPFU0939F1ZV', 'Maharashtra'));
});

test('plan prices and seat limits whatever field the server uses', () => {
  assert.equal(planPrice({ key: 'suite', name: 'Suite', apps: [], prices: { month: 14900 } }, 'year'), 149000);
  assert.equal(planPrice({ key: 'tasks', name: 'Tasks', apps: [], monthly: 9900, yearly: 99000 }, 'year'), 99000);
  assert.equal(planMinSeats({ key: 'suite', name: 'Suite', apps: [], prices: { month: 14900 } }), 5);
  assert.equal(planMaxSeats({ key: 'free', name: 'Free', apps: [] }), 3);
  assert.equal(planMaxSeats({ key: 'free', name: 'Free', apps: [], maxSeats: 3 }), 3);
});
