import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from '../lib/password.ts';

test('password rules', () => {
  assert.equal(passwordProblem('admin@123', 'a@b.com'), 'Use at least 12 characters.');
  assert.equal(passwordProblem('Admin@123456', 'a@b.com'), 'That password is too easy to guess.');
  assert.equal(passwordProblem('Password1234!', 'a@b.com'), 'That password is too easy to guess.');
  assert.match(passwordProblem('vipin.biala-2026!', 'vipin.biala@haldiram.com') ?? '', /email name/);
  assert.equal(passwordProblem('aaaaaaaaaaaaaa', 'a@b.com'), 'Don’t repeat one character.');
  assert.equal(passwordProblem('river-lamp-ochre-42', 'vipin.biala@haldiram.com'), null);
});
