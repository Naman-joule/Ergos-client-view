import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrebid, sumCurves } from '../lib/prebid.ts';

const at = (arr: number[] | null, block: number) => arr![block - 1];

test('96 numbers are MW per block', () => {
  const r = parsePrebid(Array.from({ length: 96 }, (_, i) => (i === 36 ? 2.5 : 0)));
  assert.equal(r!.length, 96);
  assert.equal(at(r, 37), 2500);
  assert.equal(at(r, 1), 0);
});

test('objects with block + mw, wrapped in {blocks}', () => {
  const r = parsePrebid({ blocks: [{ block: 37, mw: 2, price: 4100 }, { block: 38, mw: 1.5 }] });
  assert.equal(at(r, 37), 2000);
  assert.equal(at(r, 38), 1500);
});

test('alternative keys: block_no / blockNo / quantity_mw / bid_mw / planned_mw / kw', () => {
  assert.equal(at(parsePrebid([{ block_no: 5, quantity_mw: 1 }]), 5), 1000);
  assert.equal(at(parsePrebid([{ blockNo: 6, bid_mw: '0.5' }]), 6), 500);
  assert.equal(at(parsePrebid([{ block: 7, planned_mw: 2 }]), 7), 2000);
  assert.equal(at(parsePrebid([{ block: 8, kw: 750 }]), 8), 750);
  assert.equal(at(parsePrebid([{ block: 9, quantity_kw: 600 }]), 9), 600);
  assert.equal(at(parsePrebid([{ block: 10, quantity: 1.2 }]), 10), 1200);
});

test('time_block "09:00-09:15" is Block 37', () => {
  assert.equal(at(parsePrebid({ data: [{ time_block: '09:00-09:15', mw: 3 }] }), 37), 3000);
});

test('slot is 1-based unless a 0 appears', () => {
  assert.equal(at(parsePrebid([{ slot: 1, mw: 1 }]), 1), 1000);
  const zero = parsePrebid([{ slot: 0, mw: 1 }, { slot: 36, mw: 2 }]);
  assert.equal(at(zero, 1), 1000);
  assert.equal(at(zero, 37), 2000);
});

test('object keyed "1".."96", other wrappers and JSON strings', () => {
  assert.equal(at(parsePrebid({ '1': 1, '96': 0.25 }), 96), 250);
  assert.equal(at(parsePrebid({ schedule: { '40': { mw: 1 } } }), 40), 1000);
  assert.equal(at(parsePrebid({ plan: { values: Array(96).fill(1) } }), 50), 1000);
  assert.equal(at(parsePrebid('{"blocks":[{"block":2,"mw":1}]}'), 2), 1000);
});

test('unknown shapes return null', () => {
  assert.equal(parsePrebid(null), null);
  assert.equal(parsePrebid({ foo: 'bar' }), null);
  assert.equal(parsePrebid([1, 2, 3]), null);
  assert.equal(parsePrebid([{ when: 'morning', amount: 2 }]), null);
  assert.equal(parsePrebid({ blocks: [{ block: 120, mw: 1 }] }), null);
  assert.equal(parsePrebid('not json'), null);
  assert.equal(parsePrebid(42), null);
});

test('curves sum across market types', () => {
  const a = parsePrebid([{ block: 37, mw: 1 }])!;
  const b = parsePrebid([{ block: 37, mw: 0.5 }, { block: 38, mw: 1 }])!;
  const s = sumCurves([a, b]);
  assert.equal(s[36], 1500);
  assert.equal(s[37], 1000);
});
