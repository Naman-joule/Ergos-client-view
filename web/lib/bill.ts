// The energy bill, computed the way ergOS's billing service does (calculate_combined in ergOS), block by block.
// Pure: no imports, used by the node:test suite.
//
// For every 15-minute block that has a meter reading:
//   demand   = max(0, metered kWh)
//   grid kWh = max(0, demand − solar − banking adjusted discharge − exchange quantity)
//   grid ₹   = grid kWh × grid rate, where grid rate = tariff × (1 + FPPCA%/100) × (1 + duty%/100)   (app_bill_tariff)
//   solar ₹  = solar kWh (all mapped generation) × solar rate
//   exchange ₹ = exchange quantity × landed ₹/kWh            (blocks without a meter reading aren't billed)
//   banking: adjusted discharge × solar rate = "cost saved by banking" (not part of the bill)
//   cost if all from grid = demand × grid rate
//   bill = grid ₹ + solar ₹ + exchange ₹;  average ₹/kWh = bill ÷ demand
// ToD segments: contiguous runs of the same ToD type AND the same grid rate in the day's schedule, numbered per
// type in order (OFFPEAK_1 … NORMAL_1, NORMAL_2 … OFFPEAK_2), so two Normal periods at different rates stay
// apart, as on the Today ToD view; a type already numbered in the tariff (normal_1) is used as is.

export interface BillBlock {
  hasMeter: boolean;
  demandKwh: number; solarKwh: number; exchangeKwh: number; exchangeCostRs: number;
  chargeKwh: number; adjDischargeKwh: number; dischargeKwh: number;
  gridRate: number | null; solarRate: number | null; tod: string | null;
}

export interface BillTotals {
  demandKwh: number; gridKwh: number; solarKwh: number; solarSurplusKwh: number; exchangeKwh: number;
  chargeKwh: number; adjDischargeKwh: number; dischargeKwh: number;
  gridCostRs: number; solarCostRs: number; exchangeCostRs: number; bankSavedRs: number; allGridCostRs: number;
  gridUnpricedKwh: number;        // grid kWh in blocks with no grid rate (ergOS leaves them unpriced too)
  // Like-for-like comparison with an all-grid supply (client view, not in ergOS). The bill also pays for
  // energy the plant didn't use (solar beyond demand, IEX bought beyond demand), which an all-grid supply
  // wouldn't buy, so the comparison splits it out. Exchange meets demand first, then solar (as ergOS).
  // The comparison covers only blocks that have a grid rate (an all-grid cost can't be priced elsewhere), and every
  // figure in it covers those same blocks, so: allGridPricedRs − billPricedRs = savedOnUsed − excessPricedRs, exactly.
  exchangeExcessKwh: number; exchangeExcessCostRs: number;   // IEX bought beyond demand (all metered blocks)
  solarExcessCostRs: number;                                 // solar beyond demand × solar rate (all metered blocks)
  allGridPricedRs: number;        // demand × grid rate                                 } blocks with a grid rate
  billPricedRs: number;           // the bill (grid + exchange + solar) in those blocks   }
  usedCostRs: number;             // cost of the energy consumed (grid + exchange used + solar used) }
  excessPricedRs: number;         // paid for energy beyond demand                       }
  solarExcessPricedRs: number; solarExcessPricedKwh: number;          // … of which surplus solar   }
  exchangeExcessPricedRs: number; exchangeExcessPricedKwh: number;    // … of which IEX beyond demand }
  unpricedDemandKwh: number;      // demand in metered blocks with no grid rate (left out of the comparison)
  unpricedBillRs: number;         // the bill in those blocks (exchange + solar)
}
export interface BillSegment extends BillTotals { key: string; todType: string; blocks: string }
export interface BillDay extends BillTotals { segments: Record<string, BillSegment> }

export const zeroBill = (): BillTotals => ({
  demandKwh: 0, gridKwh: 0, solarKwh: 0, solarSurplusKwh: 0, exchangeKwh: 0, chargeKwh: 0, adjDischargeKwh: 0, dischargeKwh: 0,
  gridCostRs: 0, solarCostRs: 0, exchangeCostRs: 0, bankSavedRs: 0, allGridCostRs: 0, gridUnpricedKwh: 0,
  exchangeExcessKwh: 0, exchangeExcessCostRs: 0, solarExcessCostRs: 0,
  allGridPricedRs: 0, billPricedRs: 0, usedCostRs: 0, excessPricedRs: 0, unpricedDemandKwh: 0, unpricedBillRs: 0,
  solarExcessPricedRs: 0, solarExcessPricedKwh: 0, exchangeExcessPricedRs: 0, exchangeExcessPricedKwh: 0,
});
/** All-grid cost minus the cost of the energy actually used (like for like, blocks with a grid rate). */
export const savedOnUsed = (b: BillTotals) => b.allGridPricedRs - b.usedCostRs;
/** What the plant paid for energy beyond its demand (surplus solar, IEX beyond demand), all metered blocks. */
export const excessCost = (b: BillTotals) => b.exchangeExcessCostRs + b.solarExcessCostRs;
/** Net vs an all-grid supply over the compared blocks: all-grid cost − bill = saved on energy used − excess there. */
export const netVsGrid = (b: BillTotals) => b.allGridPricedRs - b.billPricedRs;
export const billTotal = (b: BillTotals) => b.gridCostRs + b.solarCostRs + b.exchangeCostRs;
export const billRate = (b: BillTotals) => (b.demandKwh > 0 ? billTotal(b) / b.demandKwh : null);

/** Segment (key, base type, "start-end") for each of the 96 blocks, from the day's ToD types (and rates, when given). */
export function todSegments(tod: (string | null)[], rates?: (number | null)[]): ({ key: string; todType: string; blocks: string } | null)[] {
  const sameRate = (a: number, b: number) => !rates || (rates[a] ?? null) === (rates[b] ?? null) || Math.abs((rates[a] ?? NaN) - (rates[b] ?? NaN)) < 1e-9;
  const out: ({ key: string; todType: string; blocks: string } | null)[] = new Array(tod.length).fill(null);
  const counts = new Map<string, number>();
  let start = 0;
  for (let i = 1; i <= tod.length; i++) {
    if (i < tod.length && tod[i] === tod[start] && sameRate(i, start)) continue;
    const cur = tod[start];
    if (cur) {
      const numbered = /_(\d+)$/.test(cur);
      const n = (counts.get(cur) ?? 0) + 1;
      counts.set(cur, n);
      const seg = { key: numbered ? (n > 1 ? `${cur}.${n}` : cur) : `${cur}_${n}`, todType: numbered ? cur.replace(/_\d+$/, '') : cur, blocks: `${start + 1}-${i}` };
      for (let k = start; k < i; k++) out[k] = seg;
    }
    start = i;
  }
  return out;
}

function addInto(t: BillTotals, b: BillBlock, grid: number, surplus: number) {
  const demand = Math.max(0, b.demandKwh);
  t.demandKwh += demand; t.gridKwh += grid; t.solarKwh += b.solarKwh; t.solarSurplusKwh += surplus;
  t.exchangeKwh += b.exchangeKwh; t.exchangeCostRs += b.exchangeCostRs;
  t.chargeKwh += b.chargeKwh; t.adjDischargeKwh += b.adjDischargeKwh; t.dischargeKwh += b.dischargeKwh;
  if (b.gridRate != null) { t.gridCostRs += grid * b.gridRate; t.allGridCostRs += demand * b.gridRate; } else t.gridUnpricedKwh += grid;
  if (b.solarRate != null) { t.solarCostRs += b.solarKwh * b.solarRate; t.bankSavedRs += b.adjDischargeKwh * b.solarRate; }

  // like-for-like split: exchange meets demand first, then solar; the rest was bought beyond demand
  const exRate = b.exchangeKwh > 0 ? b.exchangeCostRs / b.exchangeKwh : 0;
  const exUsed = Math.min(b.exchangeKwh, demand), exExcess = b.exchangeKwh - exUsed;
  const solarUsed = Math.min(b.solarKwh, Math.max(0, demand - exUsed)), solarExcess = b.solarKwh - solarUsed;
  const sr = b.solarRate ?? 0;
  const excess = exExcess * exRate + solarExcess * sr;
  t.exchangeExcessKwh += exExcess;
  t.exchangeExcessCostRs += exExcess * exRate;
  t.solarExcessCostRs += solarExcess * sr;
  if (b.gridRate != null) {
    t.allGridPricedRs += demand * b.gridRate;
    t.billPricedRs += grid * b.gridRate + b.exchangeCostRs + b.solarKwh * sr;
    t.usedCostRs += grid * b.gridRate + exUsed * exRate + solarUsed * sr;
    t.excessPricedRs += excess;
    t.solarExcessPricedRs += solarExcess * sr; t.solarExcessPricedKwh += solarExcess;
    t.exchangeExcessPricedRs += exExcess * exRate; t.exchangeExcessPricedKwh += exExcess;
  } else {
    t.unpricedDemandKwh += demand;
    t.unpricedBillRs += b.exchangeCostRs + b.solarKwh * sr;
  }
}

export function billDay(blocks: BillBlock[]): BillDay {
  const day: BillDay = { ...zeroBill(), segments: {} };
  const segs = todSegments(blocks.map((b) => b.tod), blocks.map((b) => b.gridRate));
  blocks.forEach((b, i) => {
    if (!b.hasMeter) return;
    const demand = Math.max(0, b.demandKwh);
    const raw = demand - b.solarKwh - b.adjDischargeKwh - b.exchangeKwh;
    const grid = Math.max(raw, 0);
    const surplus = raw < 0 ? Math.max(0, b.solarKwh - Math.max(0, demand - b.exchangeKwh)) : 0;
    addInto(day, b, grid, surplus);
    const s = segs[i];
    if (s) {
      const seg = day.segments[s.key] ??= { ...zeroBill(), ...s };
      addInto(seg, b, grid, surplus);
    }
  });
  return day;
}

/** Sum bills (days into a month, months into a range); segments merge by key. */
export function addBills<T extends BillTotals & { segments?: Record<string, BillSegment> }>(items: T[]): BillTotals & { segments: Record<string, BillSegment> } {
  const out = { ...zeroBill(), segments: {} as Record<string, BillSegment> };
  const keys = Object.keys(zeroBill()) as (keyof BillTotals)[];
  for (const it of items) {
    for (const k of keys) out[k] += it[k];
    for (const [sk, s] of Object.entries(it.segments ?? {})) {
      const o = out.segments[sk] ??= { ...zeroBill(), key: s.key, todType: s.todType, blocks: s.blocks };
      for (const k of keys) o[k] += s[k];
    }
  }
  return out;
}
