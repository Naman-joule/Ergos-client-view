import 'server-only';
import type { Query } from '../db';
import { addDays, istToday } from '../time';
import { addBills, billRate, billTotal, excessCost, netVsGrid, savedOnUsed, type BillSegment } from '../bill';
import { loadHistory, type HistoryDay } from './history';

// Billing & costing: a plant's energy bill per calendar month, calculated the way ergOS's billing service does
// (lib/bill.ts, mirroring ergOS calculate_combined): for every metered 15-minute block,
//   grid kWh = demand − solar − banking adjusted discharge − exchange;  grid ₹ = grid kWh × tariff × (1+FPPCA%)(1+duty%)
//   solar ₹  = all solar × solar rate;  exchange ₹ = exchange kWh × landed rate
//   bill = grid + solar + exchange;  average = bill ÷ demand;  banking saving and all-grid cost reported alongside.
// Tariffs are ergOS's own rows (app_bill_tariff, migration 008), with the ToD schedule as a fallback for plants
// ergOS has none for. Built on the History loader, so every page agrees.

export const BILLING_MONTH_CHOICES = [3, 6, 12] as const;
export type BillingMonths = (typeof BILLING_MONTH_CHOICES)[number];

export function resolveBillingMonths(v: unknown): BillingMonths {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (BILLING_MONTH_CHOICES as readonly number[]).includes(n) ? (n as BillingMonths) : 6;
}

export interface BillSummary {
  daysWithData: number;
  demandKwh: number; gridKwh: number; solarKwh: number; solarSurplusKwh: number; exchangeKwh: number;
  iexUsedKwh: number; bankKwh: number; chargeKwh: number; dischargeKwh: number;
  peakKw: number;
  gridCostRs: number; solarCostRs: number; exchangeCostRs: number; totalCostRs: number;
  bankSavedRs: number; allGridCostRs: number;
  // comparison with an all-grid supply, over blocks that have a grid rate (net = allGridPricedRs − billPricedRs)
  allGridPricedRs: number; billPricedRs: number; netVsGridRs: number;
  savedOnUsedRs: number;          // all-grid cost − cost of the energy used (like for like)
  excessPricedRs: number;         // paid for energy beyond demand, in the compared blocks
  solarExcessPricedRs: number; solarExcessPricedKwh: number; exchangeExcessPricedRs: number; exchangeExcessPricedKwh: number;
  unpricedDemandKwh: number; unpricedBillRs: number;
  excessCostRs: number;           // paid for energy beyond demand: surplus solar + IEX beyond demand (all blocks)
  solarExcessCostRs: number; exchangeExcessCostRs: number; exchangeExcessKwh: number;
  avgRate: number | null; exchangeRate: number | null; gridRate: number | null; solarRate: number | null;
  gridUnpricedKwh: number;
  fallbackDays: number;          // days priced with the ToD-schedule fallback (no ergOS tariff rows)
  segments: BillSegment[];        // ToD segments, in block order
}
export interface BillMonth extends BillSummary { month: string; daysInRange: number; partial: boolean }

export interface BillingData {
  from: string; to: string; months: BillMonth[];   // newest first
  total: BillSummary & { months: number };
  days: HistoryDay[];
}

function monthStart(ymd: string, back: number): string {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1 - back;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export function summarise(days: HistoryDay[]): BillSummary {
  const b = addBills(days.map((d) => d.bill));
  const s = (k: keyof HistoryDay) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const priced = b.gridKwh - b.gridUnpricedKwh;
  return {
    daysWithData: days.filter((d) => d.blocks > 0).length,
    demandKwh: b.demandKwh, gridKwh: b.gridKwh, solarKwh: b.solarKwh, solarSurplusKwh: b.solarSurplusKwh, exchangeKwh: b.exchangeKwh,
    iexUsedKwh: s('iexUsedKwh'), bankKwh: b.adjDischargeKwh, chargeKwh: b.chargeKwh, dischargeKwh: b.dischargeKwh,
    peakKw: days.reduce((m, d) => Math.max(m, d.peakKw), 0),
    gridCostRs: b.gridCostRs, solarCostRs: b.solarCostRs, exchangeCostRs: b.exchangeCostRs, totalCostRs: billTotal(b),
    bankSavedRs: b.bankSavedRs, allGridCostRs: b.allGridCostRs,
    allGridPricedRs: b.allGridPricedRs, billPricedRs: b.billPricedRs, netVsGridRs: netVsGrid(b),
    savedOnUsedRs: savedOnUsed(b), excessPricedRs: b.excessPricedRs,
    solarExcessPricedRs: b.solarExcessPricedRs, solarExcessPricedKwh: b.solarExcessPricedKwh,
    exchangeExcessPricedRs: b.exchangeExcessPricedRs, exchangeExcessPricedKwh: b.exchangeExcessPricedKwh, unpricedDemandKwh: b.unpricedDemandKwh, unpricedBillRs: b.unpricedBillRs,
    excessCostRs: excessCost(b),
    solarExcessCostRs: b.solarExcessCostRs, exchangeExcessCostRs: b.exchangeExcessCostRs, exchangeExcessKwh: b.exchangeExcessKwh,
    avgRate: billRate(b),
    exchangeRate: b.exchangeKwh ? b.exchangeCostRs / b.exchangeKwh : null,
    gridRate: priced > 0 ? b.gridCostRs / priced : null,
    solarRate: b.solarKwh > 0 && b.solarCostRs > 0 ? b.solarCostRs / b.solarKwh : null,
    gridUnpricedKwh: b.gridUnpricedKwh,
    fallbackDays: days.filter((d) => d.blocks > 0 && d.pricedBy === 'fallback').length,
    segments: Object.values(b.segments).sort((x, y) => Number(x.blocks.split('-')[0]) - Number(y.blocks.split('-')[0])),
  };
}

export async function loadBilling(q: Query, plantId: number, months: BillingMonths): Promise<BillingData> {
  const to = istToday();
  const from = monthStart(to, months - 1);
  const h = await loadHistory(q, plantId, { from, to, preset: null, clamped: false });
  const byMonth = new Map<string, HistoryDay[]>();
  for (const d of h.days) byMonth.set(d.date.slice(0, 7), [...(byMonth.get(d.date.slice(0, 7)) ?? []), d]);
  const out: BillMonth[] = [...byMonth.entries()].map(([month, days]) => {
    const monthEnd = addDays(addDays(`${month}-01`, 40).slice(0, 8) + '01', -1);
    return { month, ...summarise(days), daysInRange: days.length, partial: to < monthEnd || days.length < Number(monthEnd.slice(8)) };
  }).reverse();
  return { from, to, months: out, total: { ...summarise(h.days), months: out.length }, days: h.days };
}
