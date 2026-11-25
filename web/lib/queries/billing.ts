import 'server-only';
import type { Query } from '../db';
import { addDays, istToday } from '../time';
import { loadHistory, type HistoryDay } from './history';

// Billing & costing: a plant's energy and energy cost per calendar month, built from the same per-block
// computation as History and Today (lib/supply.ts allocation, DISCOM ToD rates), so the numbers agree.
// Costs are energy charges: IEX at its landed cost, grid kWh at the ToD rate for the plant's voltage +
// FPPCA, solar used at the solar tariff where known. Fixed/demand charges and electricity duty aren't
// in the data the client view holds, so they aren't included.

export const BILLING_MONTH_CHOICES = [3, 6, 12] as const;
export type BillingMonths = (typeof BILLING_MONTH_CHOICES)[number];

export function resolveBillingMonths(v: unknown): BillingMonths {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (BILLING_MONTH_CHOICES as readonly number[]).includes(n) ? (n as BillingMonths) : 6;
}

export interface BillMonth {
  month: string;                 // YYYY-MM
  daysWithData: number; daysInRange: number; partial: boolean;
  demandKwh: number; iexKwh: number; iexUsedKwh: number; solarUsedKwh: number; bankKwh: number; gridKwh: number; surplusKwh: number;
  peakKw: number;
  iexCostRs: number; gridCostRs: number; solarCostRs: number; totalCostRs: number;
  avgRate: number | null;        // total cost / demand
  iexRate: number | null; gridRate: number | null;
  gridUnpricedKwh: number;
}

export interface BillingData {
  from: string; to: string; months: BillMonth[];   // newest first
  total: Omit<BillMonth, 'month' | 'partial' | 'daysInRange'> & { months: number };
  days: HistoryDay[];
}

function monthStart(ymd: string, back: number): string {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1 - back;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

function roll(days: HistoryDay[]): Omit<BillMonth, 'month' | 'partial' | 'daysInRange'> {
  const s = (k: keyof HistoryDay) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const demandKwh = s('demandKwh'), iexKwh = s('iexKwh'), gridKwh = s('gridKwh'), gridUnpricedKwh = s('gridUnpricedKwh');
  const iexCostRs = s('iexLandedRs'), gridCostRs = s('gridCostRs'), solarCostRs = s('solarCostRs');
  const totalCostRs = iexCostRs + gridCostRs + solarCostRs;
  return {
    daysWithData: days.filter((d) => d.blocks > 0).length,
    demandKwh, iexKwh, iexUsedKwh: s('iexUsedKwh'), solarUsedKwh: s('solarUsedKwh'), bankKwh: s('bankKwh'), gridKwh, surplusKwh: s('surplusKwh'),
    peakKw: days.reduce((m, d) => Math.max(m, d.peakKw), 0),
    iexCostRs, gridCostRs, solarCostRs, totalCostRs, gridUnpricedKwh,
    avgRate: demandKwh ? totalCostRs / demandKwh : null,
    iexRate: iexKwh ? iexCostRs / iexKwh : null,
    gridRate: gridKwh - gridUnpricedKwh > 0 ? gridCostRs / (gridKwh - gridUnpricedKwh) : null,
  };
}

export async function loadBilling(q: Query, plantId: number, months: BillingMonths): Promise<BillingData> {
  const to = istToday();
  const from = monthStart(to, months - 1);
  const h = await loadHistory(q, plantId, { from, to, preset: null, clamped: false });
  const byMonth = new Map<string, HistoryDay[]>();
  for (const d of h.days) {
    const m = d.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
  }
  const out: BillMonth[] = [...byMonth.entries()].map(([month, days]) => {
    const last = addDays(`${month}-01`, 40).slice(0, 7) + '-01';
    const monthEnd = addDays(last.slice(0, 8) + '01', -1);
    return { month, ...roll(days), daysInRange: days.length, partial: to < monthEnd || days.length < Number(monthEnd.slice(8)) };
  }).reverse();
  return { from, to, months: out, total: { ...roll(h.days), months: out.length }, days: h.days };
}
