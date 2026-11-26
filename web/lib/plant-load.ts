// Plant load report: assemble one day's meter readings into 96 blocks and a summary. Pure (no DB), so the
// node:test suite can exercise it. Only readings that exist are used; nothing is estimated.

export type LoadFlag = 'real' | 'interpolated' | 'missing' | 'other' | 'none';

export interface LoadBlock {
  block: number;                 // 1–96
  readings: number;              // meter rows in the block (0 = no reading)
  registerKwh: number | null;    // cumulative kWh register at the block's last reading
  kwh: number | null;            // energy in the block
  kw: number | null;             // average load in the block: kWh × 4
  kvah: number | null;           // apparent energy in the block (logged per interval or as a register: see kvahOf)
  pf: number | null;             // block power factor: kWh ÷ kVAh
  meterPf: number | null;        // the meter's own cumulative power factor at the block's last reading
  flag: LoadFlag;
  rawFlag: string | null;        // the flag as stored, when it isn't one of the known ones
  readAt: string | null;         // IST time of the block's last reading, 'YYYY-MM-DD HH:MM'
}

export interface LoadSummary {
  totalKwh: number;
  totalKvah: number | null;
  maxKw: number | null; maxBlock: number | null;
  minKw: number | null; minBlock: number | null;
  avgKw: number | null;          // over blocks with a reading
  loadFactor: number | null;     // avgKw ÷ maxKw
  pf: number | null;             // day PF: Σ kWh ÷ Σ kVAh over blocks with both
  real: number; interpolated: number; missing: number; other: number; none: number;
  openingKwh: number | null; closingKwh: number | null;
  registerGapKwh: number | null; // (closing − opening) − Σ block kWh: ≈ 0 when the register and the deltas agree
  firstReadAt: string | null; lastReadAt: string | null;
}

const known = (f: string | null): LoadFlag => {
  const v = (f ?? '').trim().toLowerCase();
  return v === 'real' || v === 'interpolated' || v === 'missing' ? v : v ? 'other' : 'real';
};
// the weakest flag wins when a block has several readings
const RANK: Record<LoadFlag, number> = { real: 0, other: 1, interpolated: 2, missing: 3, none: 4 };

export interface MeterRow {
  block: number; ts: string; kwh: number | null; kwh_delta: number | null; kvah: number | null;
  prev_kvah: number | null; pf: number | null; flags: string | null;
}

export function buildPlantLoad(rows: MeterRow[]): { blocks: LoadBlock[]; summary: LoadSummary } {
  // kVAh: some meters log it per interval, others as a running register. Pick whichever reading of the column
  // gives a physically possible power factor (kWh ÷ kVAh between 0.3 and 1) for most of the day's rows; if
  // neither does, leave kVAh and PF out rather than show numbers that can't be right.
  const plausible = (kwh: number | null, va: number | null) => kwh != null && va != null && va > 0 && kwh / va >= 0.3 && kwh / va <= 1.0005;
  const live = rows.filter((r) => known(r.flags) !== 'missing' && r.kwh_delta != null && r.kwh_delta > 0);
  const asInterval = live.filter((r) => plausible(r.kwh_delta, r.kvah)).length;
  const asRegister = live.filter((r) => plausible(r.kwh_delta, r.kvah != null && r.prev_kvah != null ? r.kvah - r.prev_kvah : null)).length;
  const mode: 'interval' | 'register' | null = Math.max(asInterval, asRegister) < live.length / 2 ? null
    : asInterval >= asRegister ? 'interval' : 'register';
  const kvahOf = (r: MeterRow): number | null => {
    if (mode === 'interval') return r.kvah != null && r.kvah >= 0 ? r.kvah : null;
    if (mode === 'register') return r.kvah != null && r.prev_kvah != null && r.kvah >= r.prev_kvah ? r.kvah - r.prev_kvah : null;
    return null;
  };

  const blocks: LoadBlock[] = Array.from({ length: 96 }, (_, i) => ({
    block: i + 1, readings: 0, registerKwh: null, kwh: null, kw: null, kvah: null, pf: null, meterPf: null,
    flag: 'none', rawFlag: null, readAt: null,
  }));
  for (const r of rows) {
    const b = blocks[r.block - 1];
    if (!b) continue;
    const flag = known(r.flags);
    b.readings += 1;
    if (b.flag === 'none' || RANK[flag] > RANK[b.flag]) { b.flag = flag; b.rawFlag = flag === 'other' ? r.flags : null; }
    if (flag === 'missing') continue;                       // a 'missing' row carries no usable value
    if (r.kwh_delta != null) b.kwh = (b.kwh ?? 0) + r.kwh_delta;
    const va = kvahOf(r);
    if (va != null) b.kvah = (b.kvah ?? 0) + va;
    if (r.kwh != null) b.registerKwh = r.kwh;
    if (r.pf != null) b.meterPf = r.pf;
    b.readAt = r.ts;
  }
  for (const b of blocks) {
    if (b.kwh != null) b.kw = b.kwh * 4;
    if (b.kwh != null && b.kvah != null && b.kvah > 0 && b.kwh >= 0 && b.kwh / b.kvah <= 1.0005) b.pf = Math.min(1, b.kwh / b.kvah);
  }

  const withKw = blocks.filter((b) => b.kw != null);
  const max = withKw.reduce<LoadBlock | null>((m, b) => (!m || b.kw! > m.kw! ? b : m), null);
  const min = withKw.reduce<LoadBlock | null>((m, b) => (!m || b.kw! < m.kw! ? b : m), null);
  const totalKwh = withKw.reduce((s, b) => s + b.kwh!, 0);
  const avgKw = withKw.length ? withKw.reduce((s, b) => s + b.kw!, 0) / withKw.length : null;
  const both = blocks.filter((b) => b.kwh != null && b.kvah != null && b.kvah > 0);
  const bothKwh = both.reduce((s, b) => s + b.kwh!, 0), bothKvah = both.reduce((s, b) => s + b.kvah!, 0);
  const regs = blocks.filter((b) => b.registerKwh != null);
  const opening = rows.find((r) => r.kwh != null && known(r.flags) !== 'missing');
  // opening register = first reading's register less that reading's own delta (the register at 00:00)
  const openingKwh = opening && opening.kwh != null ? opening.kwh - (opening.kwh_delta ?? 0) : null;
  const closingKwh = regs.length ? regs[regs.length - 1]!.registerKwh : null;
  const count = (f: LoadFlag) => blocks.filter((b) => b.flag === f).length;
  const readTimes = blocks.map((b) => b.readAt).filter((t): t is string => t != null);

  return {
    blocks,
    summary: {
      totalKwh,
      totalKvah: both.length ? bothKvah : null,
      maxKw: max?.kw ?? null, maxBlock: max?.block ?? null,
      minKw: min?.kw ?? null, minBlock: min?.block ?? null,
      avgKw,
      loadFactor: avgKw != null && max?.kw ? avgKw / max.kw : null,
      pf: bothKvah > 0 ? Math.min(1, bothKwh / bothKvah) : null,
      real: count('real'), interpolated: count('interpolated'), missing: count('missing'), other: count('other'), none: count('none'),
      openingKwh, closingKwh,
      registerGapKwh: openingKwh != null && closingKwh != null && withKw.length ? closingKwh - openingKwh - totalKwh : null,
      firstReadAt: readTimes[0] ?? null, lastReadAt: readTimes[readTimes.length - 1] ?? null,
    },
  };
}

// ---- month view: each day's maximum and minimum load, and the month's ----------------------------------

/** One block's energy for a day (blocks whose readings are all flagged 'missing' are left out by the query). */
export interface BlockKwh { d: string; block: number; kwh: number }

export interface LoadPoint { kw: number; date: string; block: number }
export interface DayLoad {
  date: string;
  blocks: number;                // blocks with a reading
  kwh: number;
  max: LoadPoint | null; min: LoadPoint | null;
  avgKw: number | null;          // over blocks with a reading
  loadFactor: number | null;     // avg ÷ max
}
export interface MonthLoad {
  days: DayLoad[];               // every day of the month up to `last`, in order; days without readings stay empty
  max: LoadPoint | null; min: LoadPoint | null;
  avgKw: number | null; loadFactor: number | null;
  kwh: number; blocks: number; daysWithData: number;
}

/**
 * Daily and monthly maximum / minimum load from block energies (load kW = block kWh × 4). Only blocks that have
 * a reading count; a day with none has no max, min or average, rather than zeros. Ties go to the earliest block.
 */
export function buildMonthLoad(rows: BlockKwh[], dates: string[]): MonthLoad {
  const byDay = new Map<string, Map<number, number>>(dates.map((d) => [d, new Map()]));
  for (const r of rows) {
    const day = byDay.get(r.d);
    if (!day || r.block < 1 || r.block > 96 || !Number.isFinite(r.kwh)) continue;
    day.set(r.block, (day.get(r.block) ?? 0) + r.kwh);
  }
  let mMax: LoadPoint | null = null, mMin: LoadPoint | null = null, mKw = 0, mBlocks = 0, mKwh = 0;
  const days: DayLoad[] = dates.map((date) => {
    const blocks = [...byDay.get(date)!.entries()].sort((a, b) => a[0] - b[0]);
    let max: LoadPoint | null = null, min: LoadPoint | null = null, sumKw = 0, kwh = 0;
    for (const [block, e] of blocks) {
      const kw = e * 4;
      kwh += e; sumKw += kw;
      if (!max || kw > max.kw) max = { kw, date, block };
      if (!min || kw < min.kw) min = { kw, date, block };
    }
    if (max && (!mMax || max.kw > mMax.kw)) mMax = max;
    if (min && (!mMin || min.kw < mMin.kw)) mMin = min;
    mKw += sumKw; mBlocks += blocks.length; mKwh += kwh;
    const avgKw = blocks.length ? sumKw / blocks.length : null;
    return { date, blocks: blocks.length, kwh, max, min, avgKw, loadFactor: avgKw != null && max?.kw ? avgKw / max.kw : null };
  });
  const avgKw = mBlocks ? mKw / mBlocks : null;
  const top = mMax as LoadPoint | null;
  return { days, max: top, min: mMin, avgKw, loadFactor: avgKw != null && top?.kw ? avgKw / top.kw : null,
    kwh: mKwh, blocks: mBlocks, daysWithData: days.filter((d) => d.blocks > 0).length };
}
