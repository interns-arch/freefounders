// Account usernames (PLAN.md §21.5): the client-side shape check and the suggestion from a name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usernameFromName, usernameShapeProblem, usernameVariants } from '../src/account/username.ts';

test('suggestion from a name', () => {
  assert.equal(usernameFromName('test'), 'test');
  assert.equal(usernameFromName('Asha Rao'), 'asha.rao');
  assert.equal(usernameFromName('  Ravi K. Sharma '), 'ravi.k.sharma');
  assert.equal(usernameFromName('Émile Zola'), 'emile.zola');
  assert.equal(usernameFromName('Al'), 'al1');
  assert.equal(usernameFromName('42 Jo'), 'jo1');
  assert.equal(usernameFromName('राम'), null);
  assert.ok(usernameFromName('a'.repeat(40)).length <= 30);
});

test('variants keep the rules and stay unique', () => {
  const v = usernameVariants('asha.rao', 5, () => 0.5);
  assert.deepEqual(v.slice(0, 2), ['asha.rao2', 'asha.rao3']);
  for (const name of [...v, ...usernameVariants('x'.repeat(30))]) assert.equal(usernameShapeProblem(name), null, name);
});

test('shape: 3–30, starts with a letter, letters / digits / . _ -', () => {
  for (const ok of ['test', 'asha.rao', 'A_b-c.9', 'abc']) assert.equal(usernameShapeProblem(ok), null, ok);
  for (const bad of ['ab', '9876543210', '1abc', 'a@b.co', 'has space', 'x'.repeat(31), '', '.abc']) assert.equal(usernameShapeProblem(bad), 'invalid', bad);
});
