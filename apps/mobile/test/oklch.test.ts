// The hex copy of the design tokens (packages/theme/src/tokens.native.ts) is made with this conversion.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oklchToHex } from '../../../packages/theme/scripts/oklch.mjs';

const close = (hex: string, want: string) => {
  const a = parseInt(hex.slice(1, 7), 16);
  const b = parseInt(want.slice(1, 7), 16);
  for (const shift of [16, 8, 0]) assert.ok(Math.abs(((a >> shift) & 255) - ((b >> shift) & 255)) <= 1, `${hex} vs ${want}`);
};

test('known colours', () => {
  assert.equal(oklchToHex('oklch(1 0 0)'), '#ffffff');
  assert.equal(oklchToHex('oklch(0 0 0)'), '#000000');
  close(oklchToHex('oklch(0.6279 0.2577 29.23)'), '#ff0000'); // CSS red
  close(oklchToHex('oklch(0.5198 0.1769 142.5)'), '#008000'); // CSS green
  close(oklchToHex('oklch(0.452 0.3132 264.05)'), '#0000ff'); // CSS blue
  close(oklchToHex('oklch(0.5999 0 0)'), '#808080'); // CSS grey
});

test('percent lightness, alpha, bad input', () => {
  assert.equal(oklchToHex('oklch(100% 0 0)'), '#ffffff');
  assert.equal(oklchToHex('oklch(1 0 0 / 0.5)'), '#ffffff80');
  assert.throws(() => oklchToHex('#123456'));
});

test('the product primary colour', () => {
  assert.equal(oklchToHex('oklch(0.54 0.215 262.9)'), '#2361e9'); // trust blue (PLAN.md §19.22)
});
