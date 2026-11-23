import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranges, runStats, todName, todRuns } from '../lib/tod.ts';

const seq = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// Off-peak 00:00–05:00, Normal 05:00–17:00, Peak 17:00–23:00, Off-peak 23:00–24:00
const tod = Array.from({ length: 96 }, (_, i) => {
  const b = i + 1;
  if (b <= 20 || b >= 93) return 'OFFPEAK';
  if (b >= 69) return 'PEAK';
  return 'NORMAL';
});
const flat = (kw: number) => new Array(96).fill(kw);

test('block ranges read as clock times', () => {
  assert.equal(ranges(seq(1, 24)), '00:00–06:00');
  assert.equal(ranges([...seq(1, 24), ...seq(89, 96)]), '00:00–06:00, 22:00–24:00');
  assert.equal(ranges([37]), '09:00–09:15');
});

test('runs are contiguous: off-peak at both ends is two runs', () => {
  const r = todRuns(tod);
  assert.deepEqual(r.map((x) => `${x.key}:${x.start}-${x.end}`), ['OFFPEAK:0-19', 'NORMAL:20-67', 'PEAK:68-91', 'OFFPEAK:92-95']);
  assert.deepEqual(todRuns(new Array(96).fill(null)), []);
});

test('energy, cost, average price and balance per run', () => {
  const s = runStats({
    tod, now: 95, demand: flat(1000),
    layers: [
      { key: 'iex', slot: 'iex', label: 'IEX', values: flat(400) },
      { key: 'solar', slot: 'solar', label: 'Solar', values: flat(100) },
      { key: 'grid', slot: 'grid', label: 'Grid', values: flat(500) },
      { key: 'surplus', slot: 'hydro', label: 'Surplus', values: flat(50), hatch: true },
    ],
    iexRate: flat(5), gridRate: tod.map((t) => (t === 'PEAK' ? 9 : 7)), solarRate: flat(4),
  });
  const off = s[0]!;
  assert.equal(off.label, 'Off-peak');
  assert.equal(`${off.from}–${off.to}`, '00:00–05:00');
  assert.equal(off.hours, 5);
  assert.equal(off.demand, 20 * 1000 / 4 / 1000);                       // 5 MWh
  assert.equal(off.supply, 5);                                         // iex + solar + grid, surplus excluded
  assert.equal(off.balance.kind, 'balanced');
  // cost: 20 blocks × (100 kWh × ₹5 + 25 kWh × ₹4 + 125 kWh × ₹7)
  assert.equal(off.cost, 20 * (100 * 5 + 25 * 4 + 125 * 7));
  assert.equal(Math.round(off.avgPrice! * 100) / 100, Math.round((off.cost / 5000) * 100) / 100);
  assert.equal(s[2]!.parts.find((p) => p.key === 'grid')!.rate, 9);
  assert.equal(s[3]!.hours, 1);
});

test('only blocks up to now count; later runs are marked future', () => {
  const s = runStats({ tod, now: 29, demand: flat(1000), layers: [{ key: 'grid', slot: 'grid', label: 'Grid', values: flat(800) }],
    iexRate: flat(null as unknown as number), gridRate: flat(7) });
  assert.equal(s[1]!.blocksDone, 10);                                  // NORMAL blocks 20..29
  assert.equal(s[1]!.balance.kind, 'short');
  assert.equal(Math.round(s[1]!.balance.mwh * 1000), 500);             // 10 × 200 kW / 4
  assert.equal(s[2]!.future, true);
  assert.equal(s[2]!.balance.kind, 'none');
});

test('todRuns keeps separately numbered or priced periods apart', () => {
  const tod = Array.from({ length: 96 }, (_, i) => (i < 20 ? 'OFFPEAK' : i < 44 ? 'NORMAL' : i < 68 ? 'NORMAL' : i < 92 ? 'PEAK' : 'OFFPEAK'));
  const rate = tod.map((_, i) => (i < 20 ? 5 : i < 44 ? 7 : i < 68 ? 6.2 : i < 92 ? 8.5 : 5));
  assert.deepEqual(todRuns(tod, rate).map((r) => `${r.key}:${r.start}-${r.end}`),
    ['OFFPEAK:0-19', 'NORMAL:20-43', 'NORMAL:44-67', 'PEAK:68-91', 'OFFPEAK:92-95']);
  // same name, same rate -> one run (unchanged behaviour)
  assert.equal(todRuns(tod, tod.map(() => 7)).length, 4);
  // numbered labels stay separate and read as the base name
  const numbered = tod.map((t, i) => (t === 'NORMAL' ? (i < 44 ? 'NORMAL1' : 'NORMAL2') : t));
  assert.equal(todRuns(numbered).length, 5);
  assert.equal(todName('NORMAL2'), 'Normal');
  assert.equal(todName('OFFPEAK1'), 'Off-peak');
});
