// Group a day's 96 blocks by DISCOM ToD period (Off-peak / Normal / Peak) and total each
// source's energy per period. Pure: used by the ToD view and the node:test suite.
import { blockEnd, blockStart } from './time.ts';

export interface TodLayer { key: string; slot: string; label: string; values: number[]; hatch?: boolean }
export interface TodInput {
  tod: (string | null)[]; now: number; demand: number[]; layers: TodLayer[];   // layers bottom-up, kW per block
  iexKw: number[]; iexRate: (number | null)[]; gridRate: (number | null)[];
}

const ORDER = ['OFFPEAK', 'NORMAL', 'PEAK'];
const NAME: Record<string, string> = { OFFPEAK: 'Off-peak', NORMAL: 'Normal', PEAK: 'Peak' };
const name = (k: string) => NAME[k] ?? k.charAt(0) + k.slice(1).toLowerCase();

/** Contiguous block runs as "00:00–06:00, 22:00–24:00". */
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

export function todPeriods({ tod, now, demand, layers, iexKw, iexRate, gridRate }: TodInput) {
  const keys = [...new Set(tod.filter((t): t is string => !!t))].sort(
    (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return keys.map((k) => {
    const all: number[] = [];
    const done: number[] = [];
    tod.forEach((t, i) => { if (t === k) { all.push(i + 1); if (i <= now) done.push(i); } });
    const mwh = (a: number[]) => done.reduce((s, i) => s + (a[i] || 0), 0) / 4 / 1000;
    let iexKwh = 0, iexRs = 0, rateSum = 0, rateN = 0;
    for (const i of done) {
      const kwh = (iexKw[i] || 0) / 4;
      if (kwh && iexRate[i] != null) { iexKwh += kwh; iexRs += kwh * (iexRate[i] as number); }
    }
    for (const b of all) { const r = gridRate[b - 1]; if (r != null) { rateSum += r; rateN++; } }
    return {
      key: k, label: name(k), hours: ranges(all), blocks: all.length, blocksDone: done.length,
      demand: mwh(demand),
      parts: layers.map((l) => ({ ...l, mwh: mwh(l.values) })),
      iexRate: iexKwh ? iexRs / iexKwh : null,
      gridRate: rateN ? rateSum / rateN : null,
    };
  });
}

