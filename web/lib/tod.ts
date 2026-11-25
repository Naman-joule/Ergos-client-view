// A day's 96 blocks split into contiguous DISCOM ToD runs (e.g. Off-peak 00:00–05:00, Normal
// 05:00–11:00, …, Off-peak 23:00–24:00), with each source's energy and cost per run.
// Pure: used by the ToD view and the node:test suite.
import { blockEnd, blockStart } from './time.ts';

export interface TodLayer { key: string; slot: string; label: string; values: number[]; hatch?: boolean }   // kW per block
export interface TodInput {
  tod: (string | null)[]; now: number; demand: number[];
  layers: TodLayer[];                  // bottom-up; keys used for pricing: 'iex', 'solar', 'bank', 'grid', 'surplus'
  iexRate: (number | null)[]; gridRate: (number | null)[]; solarRate?: (number | null)[];
}

const NAME: Record<string, string> = { OFFPEAK: 'Off-peak', NORMAL: 'Normal', PEAK: 'Peak' };
/** Display name; numbered variants (NORMAL2, OFFPEAK1) read like their base period. */
export const todName = (k: string) => {
  const base = k.replace(/\d+$/, '');
  return NAME[base] ?? (base.charAt(0) + base.slice(1).toLowerCase() || k);
};

/** Contiguous block runs as "00:00–06:00, 22:00–24:00" (blocks are 1-based). */
export function ranges(blocks: number[]): string {
  const out: string[] = [];
  let s = -1, p = -1;
  for (const b of [...blocks, -9]) {
    if (s < 0) { s = p = b; continue; }
    if (b === p + 1) { p = b; continue; }
    out.push(`${blockStart(s)}–${blockEnd(p)}`);
    s = p = b;
  }
  return out.join(', ');
}

export interface TodRun { key: string; start: number; end: number }        // 0-based block indexes, inclusive

/** Contiguous runs of the same ToD period. A new run also starts where the grid rate changes, so two
 *  periods the DISCOM prices separately (e.g. Normal 05–11 and Normal 11–17) stay separate even when
 *  they share a name. Blocks with no period are skipped. */
export function todRuns(tod: (string | null)[], rate?: (number | null)[]): TodRun[] {
  const runs: TodRun[] = [];
  const same = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? a == b : Math.abs(a - b) < 0.005;
  tod.forEach((t, i) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.key === t && last.end === i - 1 && (!rate || same(rate[i - 1], rate[i]))) last.end = i;
    else runs.push({ key: t, start: i, end: i });
  });
  return runs;
}

export interface RunPart { key: string; slot: string; label: string; hatch?: boolean; mwh: number; rate: number | null; cost: number | null }
export interface RunStats extends TodRun {
  label: string; hours: number; blocks: number; blocksDone: number; from: string; to: string;
  demand: number; parts: RunPart[];              // MWh up to now
  supply: number; cost: number; pricedMwh: number; avgPrice: number | null;
  balance: { kind: 'balanced' | 'excess' | 'short' | 'none'; mwh: number };
  future: boolean;                                // the run hasn't started yet
}

/** Energy (MWh), rates and cost per run, counting only blocks up to `now`. */
export function runStats(input: TodInput): RunStats[] {
  return statsForRuns(todRuns(input.tod, input.gridRate), input);
}

/** Stats for given runs (a layout), so several days can be measured against the same periods. */
function statsForRuns(runs: TodRun[], input: TodInput): RunStats[] {
  const { now, demand, layers, iexRate, gridRate, solarRate } = input;
  return runs.map((run) => {
    const done: number[] = [];
    for (let i = run.start; i <= Math.min(run.end, now); i++) done.push(i);
    const mwh = (a: number[]) => done.reduce((s, i) => s + (a[i] || 0), 0) / 4 / 1000;
    const rateOf = (key: string): (number | null)[] | null =>
      key === 'iex' ? iexRate : key === 'grid' ? gridRate : key === 'solar' ? solarRate ?? null : null;

    const parts: RunPart[] = layers.map((l) => {
      const rates = rateOf(l.key);
      let cost: number | null = null, pricedKwh = 0;
      if (rates) {
        for (const i of done) {
          const kwh = (l.values[i] || 0) / 4;
          const r = rates[i];
          if (kwh > 0 && r != null) { cost = (cost ?? 0) + kwh * r; pricedKwh += kwh; }
        }
      }
      return { key: l.key, slot: l.slot, label: l.label, hatch: l.hatch, mwh: mwh(l.values), rate: pricedKwh ? (cost as number) / pricedKwh : null, cost };
    });

    const supply = parts.filter((p) => p.key !== 'surplus').reduce((s, p) => s + p.mwh, 0);
    const cost = parts.reduce((s, p) => s + (p.cost ?? 0), 0);
    const pricedMwh = parts.reduce((s, p) => s + (p.cost != null && p.rate ? p.cost / p.rate / 1000 : 0), 0);
    const d = mwh(demand);
    const gap = supply - d;
    const balance: RunStats['balance'] = !done.length ? { kind: 'none', mwh: 0 }
      : Math.abs(gap) <= Math.max(0.001, d * 0.01) ? { kind: 'balanced', mwh: 0 }
      : gap > 0 ? { kind: 'excess', mwh: gap } : { kind: 'short', mwh: -gap };

    const blocks = run.end - run.start + 1;
    return {
      ...run, label: todName(run.key), blocks, hours: blocks / 4, blocksDone: done.length,
      from: blockStart(run.start + 1), to: blockEnd(run.end + 1),
      demand: d, parts, supply, cost, pricedMwh, avgPrice: pricedMwh ? cost / (pricedMwh * 1000) : null,
      balance, future: run.start > now,
    };
  });
}

/**
 * ToD stats summed over several days (History). Every day is measured against the same period layout
 * (`layout`: usually the latest day's schedule), each with its own block rates, then summed per period:
 * energy and cost add up; rates, average price and balance are recomputed from the sums. `blocksDone`
 * becomes the number of day-blocks with data, so average kW stays correct over the range.
 */
export function rangeRunStats(days: TodInput[], layout: { tod: (string | null)[]; gridRate?: (number | null)[] }): RunStats[] {
  const runs = todRuns(layout.tod, layout.gridRate);
  if (!runs.length || !days.length) return [];
  const per = days.map((d) => statsForRuns(runs, d));
  return runs.map((_, ri) => {
    const rs = per.map((p) => p[ri]!);
    const first = rs[0]!;
    const parts: RunPart[] = first.parts.map((p0, pi) => {
      let mwh = 0, cost: number | null = null, pricedMwh = 0;
      for (const r of rs) {
        const p = r.parts[pi]!;
        mwh += p.mwh;
        if (p.cost != null) { cost = (cost ?? 0) + p.cost; if (p.rate) pricedMwh += p.cost / p.rate / 1000; }
      }
      return { ...p0, mwh, cost, rate: cost != null && pricedMwh ? cost / (pricedMwh * 1000) : null };
    });
    const demand = rs.reduce((s, r) => s + r.demand, 0);
    const blocksDone = rs.reduce((s, r) => s + r.blocksDone, 0);
    const supply = parts.filter((p) => p.key !== 'surplus').reduce((s, p) => s + p.mwh, 0);
    const cost = parts.reduce((s, p) => s + (p.cost ?? 0), 0);
    const pricedMwh = parts.reduce((s, p) => s + (p.cost != null && p.rate ? p.cost / p.rate / 1000 : 0), 0);
    const gap = supply - demand;
    const balance: RunStats['balance'] = !blocksDone ? { kind: 'none', mwh: 0 }
      : Math.abs(gap) <= Math.max(0.001, demand * 0.01) ? { kind: 'balanced', mwh: 0 }
      : gap > 0 ? { kind: 'excess', mwh: gap } : { kind: 'short', mwh: -gap };
    return { ...first, parts, demand, blocksDone, supply, cost, pricedMwh,
             avgPrice: pricedMwh ? cost / (pricedMwh * 1000) : null, balance, future: blocksDone === 0 };
  });
}
