import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlantLoad, type MeterRow } from '../lib/plant-load.ts';

// Test fixtures only (in-memory, never written anywhere): a register advancing 100 kWh per block.
const row = (block: number, over: Partial<MeterRow> = {}): MeterRow => ({
  block, ts: `2026-11-20 ${String(Math.floor(block / 4)).padStart(2, '0')}:${String((block % 4) * 15).padStart(2, '0')}`,
  kwh: 1000 + block * 100, kwh_delta: 100, kvah: 2000 + block * 110, prev_kvah: 2000 + (block - 1) * 110, pf: 0.9, flags: 'real', ...over,
});

test('blocks without a reading stay empty and are counted, never filled', () => {
  const r = buildPlantLoad([row(1), row(2), row(4)]);
  assert.equal(r.blocks.length, 96);
  assert.equal(r.blocks[2]!.flag, 'none');
  assert.equal(r.blocks[2]!.kwh, null);
  assert.equal(r.summary.real, 3);
  assert.equal(r.summary.none, 93);
  assert.equal(r.summary.totalKwh, 300);
});

test('load, kVAh, PF and the day summary', () => {
  const r = buildPlantLoad([row(1), row(2, { kwh_delta: 200, kwh: 1400 }), row(3, { kwh: 1500 })]);
  assert.equal(r.blocks[1]!.kw, 800);
  assert.equal(r.blocks[0]!.kvah, 110);
  assert.ok(Math.abs(r.blocks[0]!.pf! - 100 / 110) < 1e-9);
  assert.equal(r.summary.maxKw, 800); assert.equal(r.summary.maxBlock, 2);
  assert.equal(r.summary.minKw, 400);
  assert.ok(Math.abs(r.summary.loadFactor! - (1600 / 3) / 800) < 1e-9);
  assert.equal(r.summary.openingKwh, 1000);       // 1100 − its own 100 kWh
  assert.equal(r.summary.closingKwh, 1500);
  assert.equal(r.summary.registerGapKwh, 100);    // register moved 500, blocks add to 400: flagged on the page
});

test('interpolated readings are kept but marked; missing ones carry no value', () => {
  const r = buildPlantLoad([row(1, { flags: 'interpolated' }), row(2, { flags: 'missing' }), row(3, { flags: 'Real ' })]);
  assert.equal(r.blocks[0]!.flag, 'interpolated'); assert.equal(r.blocks[0]!.kwh, 100);
  assert.equal(r.blocks[1]!.flag, 'missing'); assert.equal(r.blocks[1]!.kwh, null);
  assert.equal(r.blocks[2]!.flag, 'real');
  assert.deepEqual([r.summary.real, r.summary.interpolated, r.summary.missing], [1, 1, 1]);
  assert.equal(r.summary.totalKwh, 200);
});

test('several readings in one block add up; the weakest flag wins; a register reset gives no kVAh', () => {
  const r = buildPlantLoad([row(4), row(5, { kwh_delta: 40, kvah: 2550, prev_kvah: 2490 }), row(5, { kwh_delta: 60, flags: 'interpolated', kvah: 10, prev_kvah: 5000 }), row(6)]);
  assert.equal(r.blocks[4]!.readings, 2);
  assert.equal(r.blocks[4]!.kwh, 100);
  assert.equal(r.blocks[4]!.flag, 'interpolated');
  assert.equal(r.blocks[4]!.kvah, 60);            // the reset reading adds no kVAh
});

test('kVAh logged per interval (not a register) is read as such', () => {
  const r = buildPlantLoad([1, 2, 3].map((b) => row(b, { kvah: 104, prev_kvah: 104 })));
  assert.equal(r.blocks[0]!.kvah, 104);
  assert.ok(Math.abs(r.summary.pf! - 100 / 104) < 1e-9);
});

test('kVAh that gives no possible power factor is left out, not shown', () => {
  const r = buildPlantLoad([1, 2, 3].map((b) => row(b, { kvah: 5, prev_kvah: 1 })));
  assert.equal(r.blocks[0]!.kvah, null); assert.equal(r.summary.pf, null); assert.equal(r.summary.totalKvah, null);
});

test('no readings: empty report, no figures invented', () => {
  const r = buildPlantLoad([]);
  assert.equal(r.summary.totalKwh, 0);
  assert.equal(r.summary.maxKw, null); assert.equal(r.summary.avgKw, null); assert.equal(r.summary.openingKwh, null);
  assert.equal(r.summary.none, 96);
});

import { buildMonthLoad } from '../lib/plant-load.ts';

test('month: daily and monthly max / min load, empty days stay empty', () => {
  const m = buildMonthLoad([
    { d: '2026-11-01', block: 1, kwh: 100 }, { d: '2026-11-01', block: 2, kwh: 300 }, { d: '2026-11-01', block: 3, kwh: 50 },
    { d: '2026-11-03', block: 40, kwh: 400 }, { d: '2026-11-03', block: 41, kwh: 200 },
    { d: '2026-11-03', block: 41, kwh: 20 },     // two readings in one block add up
    { d: '2026-12-01', block: 1, kwh: 999 },     // outside the dates: ignored
  ], ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(m.days[0]!.max, { kw: 1200, date: '2026-11-01', block: 2 });
  assert.deepEqual(m.days[0]!.min, { kw: 200, date: '2026-11-01', block: 3 });
  assert.equal(m.days[1]!.max, null); assert.equal(m.days[1]!.avgKw, null); assert.equal(m.days[1]!.blocks, 0);
  assert.equal(m.days[2]!.min!.kw, 880);
  assert.deepEqual(m.max, { kw: 1600, date: '2026-11-03', block: 40 });
  assert.deepEqual(m.min, { kw: 200, date: '2026-11-01', block: 3 });
  assert.equal(m.daysWithData, 2); assert.equal(m.blocks, 5); assert.equal(m.kwh, 1070);
  assert.equal(m.avgKw, (1070 * 4) / 5);
});

test('month with no readings: nothing invented', () => {
  const m = buildMonthLoad([], ['2026-11-01', '2026-11-02']);
  assert.equal(m.max, null); assert.equal(m.min, null); assert.equal(m.avgKw, null); assert.equal(m.daysWithData, 0);
});
