import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranges, todPeriods } from '../lib/tod.ts';

const seq = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// Off-peak 00:00–06:00 and 22:00–24:00, peak 18:00–22:00, normal otherwise
const tod = Array.from({ length: 96 }, (_, i) => {
  const b = i + 1;
  if (b <= 24 || b >= 89) return 'OFFPEAK';
  if (b >= 73) return 'PEAK';
  return 'NORMAL';
});

test('block ranges read as clock times', () => {
  assert.equal(ranges(seq(1, 24)), '00:00–06:00');
  assert.equal(ranges([...seq(1, 24), ...seq(89, 96)]), '00:00–06:00, 22:00–24:00');
  assert.equal(ranges([37]), '09:00–09:15');
});

test('energy per ToD period sums kW/4 per block, only up to now', () => {
  const flat = (kw: number) => new Array(96).fill(kw);
  const p = todPeriods({
    tod, now: 95, demand: flat(1000), iexKw: flat(400), iexRate: new Array(96).fill(5), gridRate: tod.map((t) => (t === 'PEAK' ? 9 : 7)),
    layers: [{ key: 'iex', slot: 'iex', label: 'IEX', values: flat(400) }, { key: 'grid', slot: 'grid', label: 'Grid', values: flat(600) }],
  });
  assert.deepEqual(p.map((x) => x.key), ['OFFPEAK', 'NORMAL', 'PEAK']);
  const off = p[0]!;
  assert.equal(off.blocks, 32);
  assert.equal(off.hours, '00:00–06:00, 22:00–24:00');
  assert.equal(off.demand, 32 * 1000 / 4 / 1000);           // 8 MWh
  assert.equal(off.parts[0]!.mwh, 32 * 400 / 4 / 1000);       // 3.2 MWh IEX
  assert.equal(p[2]!.gridRate, 9);
  assert.equal(off.iexRate, 5);

  const partial = todPeriods({
    tod, now: 39, demand: flat(1000), iexKw: flat(0), iexRate: new Array(96).fill(null), gridRate: new Array(96).fill(null),
    layers: [{ key: 'grid', slot: 'grid', label: 'Grid', values: flat(1000) }],
  });
  assert.equal(partial[1]!.blocksDone, 16);                    // NORMAL blocks 25..40 so far
  assert.equal(partial[2]!.demand, 0);                         // peak hasn't started
  assert.equal(partial[0]!.iexRate, null);
});

test('no ToD schedule gives no periods', () => {
  assert.equal(todPeriods({ tod: new Array(96).fill(null), now: 95, demand: [], layers: [], iexKw: [], iexRate: [], gridRate: [] }).length, 0);
});
