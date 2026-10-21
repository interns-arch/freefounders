// Company names are unique (PLAN.md §21.6): the client-side normalisation, length check and the server error on the field.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCompanyName, companyNameErrorOf, companyNameShapeProblem, normaliseCompanyName } from '../src/account/company-name.ts';

test('normalised like the server: trimmed, inner spaces collapsed, lower-case', () => {
  assert.equal(cleanCompanyName('  Test   Comp \t Pvt '), 'Test Comp Pvt');
  assert.equal(normaliseCompanyName(' TESTCOMP '), 'testcomp');
  assert.equal(normaliseCompanyName('test  comp'), normaliseCompanyName('Test Comp'));
});

test('2–80 characters after trimming', () => {
  assert.equal(companyNameShapeProblem('Ab'), null);
  assert.equal(companyNameShapeProblem('  a  '), 'invalid');
  assert.equal(companyNameShapeProblem(''), 'invalid');
  assert.equal(companyNameShapeProblem('x'.repeat(80)), null);
  assert.equal(companyNameShapeProblem('x'.repeat(81)), 'invalid');
});

test('the field error of a 409 / 400 answer', () => {
  assert.equal(companyNameErrorOf({ status: 409, errors: { companyName: 'taken' } }), 'taken');
  assert.equal(companyNameErrorOf({ status: 409, errors: { username: 'taken' } }), null);
  assert.equal(companyNameErrorOf({ status: 500, errors: { companyName: 'x' } }), null);
  assert.equal(companyNameErrorOf(null), null);
});
