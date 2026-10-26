// `npm test --workspace @kaampilot/core` (Node 22.18+ / 24 reads the .ts directly). Weak-password warning, R3.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordWeakness, weakPasswordWarning } from '../src/admin/password-strength.ts';

const about = { fullName: 'Priya Sharma', username: 'priya.s', email: 'p.sharma@cartrends.net', companyName: 'Acme Motors Pvt Ltd' };

test('common passwords, also with a number, year or symbol added and letters swapped for look-alikes', () => {
  for (const pw of ['password', 'Password1', 'P@ssw0rd', 'welcome@2024', 'iloveyou', 'Admin@123', 'letmein!', 'Krishna123', 'sunshine', 'Demo@1234']) {
    assert.equal(passwordWeakness(pw), 'common', pw);
  }
});

test('only digits, repeated characters, sequences and keyboard walks', () => {
  for (const pw of ['123456', '111111', '987654321', '20051998', 'aaaaaa', 'abcdef', 'qwerty', 'asdfgh', 'zxcvbnm', '1qaz2wsx', 'qwerty123', 'abc123', 'asdf1234', 'abcabc', 'a1a1a1', 'fedcba', '!!!!!!']) {
    assert.ok(['pattern', 'common'].includes(passwordWeakness(pw)), pw);
  }
  assert.equal(passwordWeakness('poiuyt'), 'pattern', 'a walk backwards');
});

test("the person's name, username, email or the company name, case-insensitive", () => {
  for (const pw of ['priya2024', 'SHARMA@1', 'Priya.S!', 'psharma99', 'acme1234', 'AcmeMotors', 'pr1ya123']) {
    assert.equal(passwordWeakness(pw, about), 'personal', pw);
  }
  assert.equal(passwordWeakness('limited77', { companyName: 'Acme Pvt Ltd' }), null, 'company suffixes are not names');
});

test('reasonable passwords are not flagged; empty is not flagged', () => {
  for (const pw of ['k7q2-m9xd-4fha', 'Tr0ub4dor&3x', 'blue-kettle-91', 'mangoRiver#58', 'Zp9!wQ2#']) {
    assert.equal(passwordWeakness(pw, about), null, pw);
  }
  assert.equal(passwordWeakness(''), null);
});

test('the warning wording: says why, and that it can still be saved', () => {
  assert.equal(weakPasswordWarning('123456'), 'Weak password: easy to guess (simple pattern like 123456 or qwerty). You can still save it.');
  assert.equal(weakPasswordWarning('password'), 'Weak password: easy to guess (common password). You can still save it.');
  assert.match(weakPasswordWarning('priya123', about), /^Weak password: easy to guess \(it contains a name/);
  assert.equal(weakPasswordWarning('k7q2-m9xd-4fha'), null);
});
