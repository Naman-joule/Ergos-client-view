import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../lib/supply.ts';

test('IEX settles first, then solar, banking, grid; surplus solar is what demand left over', () => {
  const a = allocate([100, 100, 100], [60, 150, 0], [30, 20, 200], [50, 0, 0], 1);
  assert.deepEqual(a.iexUsed, [60, 100, 0]);
  assert.deepEqual(a.solarUsed, [30, 0, 0]);
  assert.deepEqual(a.bank, [10, 0, 0]);
  assert.deepEqual(a.grid, [0, 0, 0]);
  assert.deepEqual(a.surplus, [0, 20, 0]);   // block 3 is after upTo: untouched
});
