import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBills, billDay, billRate, billTotal, todSegments, type BillBlock } from '../lib/bill.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
const blk = (o: Partial<BillBlock>): BillBlock => ({
  hasMeter: true, demandKwh: 0, solarKwh: 0, exchangeKwh: 0, exchangeCostRs: 0, chargeKwh: 0, adjDischargeKwh: 0, dischargeKwh: 0,
  gridRate: null, solarRate: null, tod: null, ...o,
});

test('per block: grid = demand − solar − adjusted discharge − exchange; costs as ergOS', () => {
  // 100 kWh demand, 20 solar, 10 banked, 30 IEX at ₹5 landed (₹150), grid rate ₹8.932 (8.28 × 1.0035 × 1.075), solar ₹4.5
  const d = billDay([blk({ demandKwh: 100, solarKwh: 20, adjDischargeKwh: 10, dischargeKwh: 12, exchangeKwh: 30, exchangeCostRs: 150,
    gridRate: 8.28 * 1.0035 * 1.075, solarRate: 4.5, tod: 'PEAK' })]);
  assert.equal(d.gridKwh, 40);
  near(d.gridCostRs, 40 * 8.28 * 1.0035 * 1.075);
  assert.equal(d.solarCostRs, 90);                       // all solar × rate
  assert.equal(d.exchangeCostRs, 150);
  assert.equal(d.bankSavedRs, 45);                       // adjusted discharge × solar rate, not in the bill
  near(billTotal(d), 40 * 8.28 * 1.0035 * 1.075 + 90 + 150);
  near(d.allGridCostRs, 100 * 8.28 * 1.0035 * 1.075);
  assert.equal(d.dischargeKwh, 12);
});

test('surplus solar only when supply exceeds demand; blocks without meter data are not billed', () => {
  const d = billDay([
    blk({ demandKwh: 50, solarKwh: 40, exchangeKwh: 30, exchangeCostRs: 120, gridRate: 8, solarRate: 4 }),   // raw −20 → surplus = 40 − (50−30) = 20
    blk({ hasMeter: false, demandKwh: 0, exchangeKwh: 25, exchangeCostRs: 100, gridRate: 8 }),           // IEX with no reading: skipped
    blk({ demandKwh: -5, gridRate: 8 }),                                                                 // negative reading → 0
  ]);
  assert.equal(d.gridKwh, 0);
  assert.equal(d.solarSurplusKwh, 20);
  assert.equal(d.exchangeKwh, 30);
  assert.equal(d.exchangeCostRs, 120);
  assert.equal(d.demandKwh, 50);
  assert.equal(d.gridUnpricedKwh, 0);
});

test('ToD segments are numbered per type in order; numbered types are kept', () => {
  const tod = [...Array(20).fill('OFFPEAK'), ...Array(48).fill('NORMAL'), ...Array(24).fill('PEAK'), ...Array(4).fill('OFFPEAK')];
  const s = todSegments(tod);
  assert.deepEqual([s[0], s[20], s[68], s[95]].map((x) => `${x!.key}:${x!.blocks}`), ['OFFPEAK_1:1-20', 'NORMAL_1:21-68', 'PEAK_1:69-92', 'OFFPEAK_2:93-96']);
  const n = todSegments([...Array(24).fill('normal_1'), ...Array(24).fill('normal_2')]);
  assert.deepEqual([n[0]!.key, n[0]!.todType, n[30]!.key, n[30]!.blocks], ['normal_1', 'normal', 'normal_2', '25-48']);
});

test('negative FPPCA and duty multiply onto the base rate; master ToD segments keep numbering', () => {
  // e.g. PVVNL HV-2(A) with FPPCA -1.52% and electricity duty 7.5%
  const tod = [
    ...Array(20).fill('off_peak_1'),
    ...Array(24).fill('normal_1'),
    ...Array(24).fill('normal_2'),
    ...Array(24).fill('peak_1'),
    ...Array(4).fill('off_peak_2'),
  ];
  const blocks = tod.map((t, i) => {
    const base = t.startsWith('off_peak') ? 5.78 : t.startsWith('normal') ? 6.80 : 7.82;
    return blk({
      demandKwh: 1000,
      exchangeKwh: i < 20 ? 200 : 0,
      exchangeCostRs: i < 20 ? 1000 : 0,
      gridRate: base * (1 - 1.52 / 100) * (1 + 7.5 / 100),
      tod: t,
    });
  });
  const d = billDay(blocks);
  assert.deepEqual(Object.keys(d.segments), ['off_peak_1', 'normal_1', 'normal_2', 'peak_1', 'off_peak_2']);
  assert.equal(d.segments['off_peak_1']!.blocks, '1-20');
  assert.equal(d.segments['off_peak_2']!.blocks, '93-96');
  near(d.gridCostRs, (20 * 800 * 5.78 + 48 * 1000 * 6.80 + 24 * 1000 * 7.82 + 4 * 1000 * 5.78) * 0.9848 * 1.075);
  assert.equal(d.exchangeCostRs, 20 * 1000);
});

test('days add up to the month, segment by segment', () => {
  const tod = [...Array(48).fill('OFFPEAK'), ...Array(48).fill('PEAK')];
  const day = (kwh: number) => billDay(tod.map((t) => blk({ demandKwh: kwh, gridRate: t === 'PEAK' ? 9 : 6, tod: t })));
  const m = addBills([day(10), day(20)]);
  assert.equal(m.demandKwh, 96 * 30);
  assert.equal(m.segments['PEAK_1']!.gridCostRs, 48 * 30 * 9);
  assert.equal(m.segments['OFFPEAK_1']!.gridCostRs, 48 * 30 * 6);
  assert.equal(billRate(m), (48 * 30 * 9 + 48 * 30 * 6) / (96 * 30));
});
