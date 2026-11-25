import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, msToNextRefresh, timeState } from '../lib/time-state.ts';

test('freshness states', () => {
  assert.equal(timeState(4), 'live');
  assert.equal(timeState(30), 'live');
  assert.equal(timeState(31), 'delayed');
  assert.equal(timeState(90), 'delayed');
  assert.equal(timeState(91), 'stale');
  assert.equal(timeState(null), 'stale');
});

test('refresh lands 90 s after the next IST block boundary', () => {
  // 10:14:00 IST = 04:44:00 UTC -> next boundary 10:15:00, refresh at 10:16:30 = 2.5 min away
  const t = Date.UTC(2026, 10, 20, 4, 44, 0);
  assert.equal(msToNextRefresh(t), 150_000);
  // exactly on a boundary: wait for the next one (+15 min) plus 90 s
  assert.equal(msToNextRefresh(Date.UTC(2026, 10, 20, 4, 45, 0)), 15 * 60_000 + 90_000);
});

test('ago', () => {
  assert.equal(ago(0.2), '1 min ago');
  assert.equal(ago(45), '45 min ago');
  assert.equal(ago(180), '3 h ago');
  assert.equal(ago(4320), '3 d ago');
});
