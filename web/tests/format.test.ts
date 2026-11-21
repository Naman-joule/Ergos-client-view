import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, inr, mwh, rate, rupeeParts, rupees } from '../lib/format.ts';

test('inr uses Indian grouping', () => {
  assert.equal(inr(391192.06, 2), '3,91,192.06');
  assert.equal(inr(235373), '2,35,373');
  assert.equal(inr(999), '999');
  assert.equal(inr(1000), '1,000');
  assert.equal(inr(100000), '1,00,000');
  assert.equal(inr(12345678.9, 1), '1,23,45,678.9');
  assert.equal(inr(-1500), '−1,500');
  assert.equal(inr(-0.001, 2), '0.00');
  assert.equal(inr(NaN), '—');
});

test('rupees and rates', () => {
  assert.equal(rupees(391192.06, 2), '₹3,91,192.06');
  assert.equal(rupees(-42), '−₹42');
  assert.equal(rate(5.3312), '₹5.33 / kWh');
  assert.deepEqual(rupeeParts(391192.06), { whole: '₹3,91,192', paise: '.06' });
  assert.equal(mwh(50551), '50.55 MWh');
});

test('compact uses k, L and Cr', () => {
  assert.equal(compact(950), '950');
  assert.equal(compact(1250), '1.3k');
  assert.equal(compact(12500), '13k');
  assert.equal(compact(390000), '3.9 L');
  assert.equal(compact(100000), '1 L');
  assert.equal(compact(12000000), '1.2 Cr');
  assert.equal(compact(-250000), '−2.5 L');
});
