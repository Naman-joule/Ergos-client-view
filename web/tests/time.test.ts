import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, blockEnd, blockLabel, blockStart, currentBlock, formatDate, formatDateLong, formatRange, istToday } from '../lib/time.ts';

test('block times: Block 1 is 00:00–00:15, Block 96 ends at 24:00', () => {
  assert.equal(blockStart(1), '00:00');
  assert.equal(blockEnd(1), '00:15');
  assert.equal(blockStart(37), '09:00');
  assert.equal(blockEnd(89), '22:15');
  assert.equal(blockEnd(96), '24:00');
  assert.equal(blockLabel(89), 'Block 89 · 22:15');
});

test('IST today and current block', () => {
  // 2026-10-13 16:44:59Z = 22:14:59 IST -> Block 89
  const t = new Date('2026-10-13T16:44:59Z');
  assert.equal(istToday(t), '2026-10-13');
  assert.equal(currentBlock(t), 89);
  // 18:30Z is midnight IST next day -> Block 1
  const m = new Date('2026-10-13T18:30:00Z');
  assert.equal(istToday(m), '2026-10-14');
  assert.equal(currentBlock(m), 1);
});

test('dates', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(formatDateLong('2026-10-13'), 'Tue, 13 Oct 2026');
  assert.equal(formatDate('2026-10-13'), '13 Oct 2026');
  assert.equal(formatRange('2026-10-01', '2026-10-13'), '1–13 Oct 2026');
});
