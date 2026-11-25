import 'server-only';
import writeXlsxFile from 'write-excel-file/node';
import type { Row, SheetData } from 'write-excel-file/node';
import { blockEnd, blockStart } from './time';
import { todName } from './tod';
import type { HistoryData } from './queries/history';
import type { BillingData } from './queries/billing';
import type { IexData } from './queries/iex';

// Excel exports. Today's export and History's download are the same workbook (a one-day range for Today),
// built from loadHistory(..., { detail: true }), so the file always matches what the pages show.
//   Block-wise: every 15-minute block with data (energy in kWh for the block, rates in ₹/kWh)
//   Day-wise:   one row per day in the range, with energy costs
//   ToD-wise:   each day's ToD periods, then the periods summed over the range

const H = (v: string) => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#E8EEF2', wrap: true });
const n = (v: number | null | undefined, format = '#,##0') => (v == null || !Number.isFinite(v) ? null : { value: v, type: Number, format });
const kwh = (v: number | null | undefined) => n(v, '#,##0.00');
const rate = (v: number | null | undefined) => n(v, '0.0000');
const rs = (v: number | null | undefined) => n(v, '#,##0.00');
const d = (ymd: string) => ({ value: new Date(`${ymd}T00:00:00Z`), type: Date, format: 'dd-mmm-yyyy' });
const t = (v: string | null | undefined) => (v == null ? null : { value: v, type: String });

export interface ExportMeta { plant: string; client: string; from: string; to: string; generatedAt: string }

export async function historyWorkbook(data: HistoryData, meta: ExportMeta): Promise<Buffer> {
  const title: Row = [t(`${meta.plant} (${meta.client}) · ${meta.from} to ${meta.to} · generated ${meta.generatedAt} IST · ergOS client view`)];
  const note: Row = [t('IEX settles first, then solar and banking; grid is the remainder. Grid cost = grid kWh × DISCOM ToD rate for the plant’s voltage + FPPCA (energy charges only).')];

  // ---- Block-wise
  const blocks: SheetData = [title, note, [], [
    H('Date'), H('Block'), H('From'), H('To'), H('ToD period'), H('Demand kWh'), H('Power exchange bought kWh'), H('Power exchange used kWh'),
    H('Solar generated kWh'), H('Solar used kWh'), H('Banking kWh'), H('Grid kWh'), H('Surplus solar kWh'),
    H('IEX landed ₹/kWh'), H('Grid ₹/kWh'), H('Solar ₹/kWh'),
  ]];
  for (const b of data.blocks ?? []) {
    blocks.push([d(b.date), n(b.block), t(blockStart(b.block)), t(blockEnd(b.block)), t(b.tod ? todName(b.tod) : null),
      kwh(b.demandKwh), kwh(b.iexKwh), kwh(b.iexUsedKwh), kwh(b.solarKwh), kwh(b.solarUsedKwh), kwh(b.bankKwh), kwh(b.gridKwh), kwh(b.surplusKwh),
      rate(b.iexRate), rate(b.gridRate), rate(b.solarRate)]);
  }

  // ---- Day-wise
  const days: SheetData = [title, note, [], [
    H('Date'), H('Blocks with data'), H('Demand kWh'), H('Power exchange bought kWh'), H('Power exchange used kWh'), H('Solar generated kWh'),
    H('Solar used kWh'), H('Banking kWh'), H('Grid kWh'), H('Surplus solar kWh'), H('Peak demand kW'), H('Peak at'),
    H('IEX landed ₹/kWh'), H('IEX cost ₹'), H('Grid cost ₹'), H('Solar cost ₹'), H('Total energy cost ₹'), H('Average ₹/kWh'),
  ]];
  const dayRow = (label: Row[number], x: HistoryData['totals'] | HistoryData['days'][number], peakAt: string | null): Row => [
    label, n(x.blocks), kwh(x.demandKwh), kwh(x.iexKwh), kwh(x.iexUsedKwh), kwh(x.solarKwh), kwh(x.solarUsedKwh), kwh(x.bankKwh),
    kwh(x.gridKwh), kwh(x.surplusKwh), n(Math.round(x.peakKw)), t(peakAt), rate(x.landedRate), rs(x.iexLandedRs), rs(x.gridCostRs),
    rs(x.solarCostRs), rs(x.totalCostRs), rate(x.demandKwh ? x.totalCostRs / x.demandKwh : null),
  ];
  for (const day of data.days) days.push(dayRow(d(day.date), day, day.peakBlock ? blockEnd(day.peakBlock) : null));
  const tt = data.totals;
  days.push([], dayRow({ value: 'Total', type: String, fontWeight: 'bold' },
    tt, tt.peakDate && tt.peakBlock ? `${tt.peakDate} ${blockEnd(tt.peakBlock)}` : null));

  // ---- ToD-wise
  const tod: SheetData = [title, note, [], [
    H('Date'), H('ToD period'), H('From'), H('To'), H('Hours'), H('Demand kWh'), H('Power exchange kWh'), H('Solar used kWh'),
    H('Banking kWh'), H('Grid kWh'), H('Surplus solar kWh'), H('Supply kWh'), H('Energy cost ₹'), H('Average ₹/kWh'), H('Balance'),
  ]];
  const part = (r: NonNullable<HistoryData['todByDay']>[number], key: string) => (r.stats.parts.find((p) => p.key === key)?.mwh ?? 0) * 1000;
  let totalsStarted = false;
  for (const r of data.todByDay ?? []) {
    if (r.date === null && !totalsStarted) { tod.push([], [{ value: `All days (${data.todDays})`, type: String, fontWeight: 'bold' }]); totalsStarted = true; }
    const s = r.stats;
    tod.push([r.date ? d(r.date) : t('All days'), t(s.label), t(s.from), t(s.to), n(s.hours, '0.00'),
      kwh(s.demand * 1000), kwh(part(r, 'iex')), kwh(part(r, 'solar')), kwh(part(r, 'bank')), kwh(part(r, 'grid')), kwh(part(r, 'surplus')),
      kwh(s.supply * 1000), rs(s.cost), rate(s.avgPrice),
      t(s.balance.kind === 'balanced' ? 'Balanced' : s.balance.kind === 'excess' ? `${(s.balance.mwh * 1000).toFixed(0)} kWh over` : s.balance.kind === 'short' ? `${(s.balance.mwh * 1000).toFixed(0)} kWh short` : '—')]);
  }
  if (!data.todByDay?.length) tod.push([t('No DISCOM ToD schedule was found for this plant and range.')]);

  const widths = (first: number, rest: number, count: number) => [{ width: first }, ...Array.from({ length: count }, () => ({ width: rest }))];
  return writeXlsxFile([
    { sheet: 'Block-wise', data: blocks, stickyRowsCount: 4, columns: widths(13, 14, 15) },
    { sheet: 'Day-wise', data: days, stickyRowsCount: 4, columns: widths(13, 14, 17) },
    { sheet: 'ToD-wise', data: tod, stickyRowsCount: 4, columns: widths(13, 14, 14) },
  ], { fontFamily: 'Calibri', fontSize: 11 }).toBuffer();
}

// ---------------------------------------------------------------------------- billing

export async function billingWorkbook(b: BillingData, meta: ExportMeta): Promise<Buffer> {
  const title: Row = [t(`${meta.plant} (${meta.client}) · monthly energy and cost · ${meta.from} to ${meta.to} · generated ${meta.generatedAt} IST`)];
  const note: Row = [t('Energy charges only: IEX at landed cost (incl. open access charges), grid kWh × DISCOM ToD rate for the plant’s voltage + FPPCA, solar used × solar tariff where known. Fixed/demand charges and electricity duty are not included.')];
  const head: Row = [H('Month'), H('Days with data'), H('Demand kWh'), H('Power exchange kWh'), H('Solar used kWh'), H('Banking kWh'), H('Grid kWh'),
    H('Peak demand kW'), H('IEX cost ₹'), H('IEX ₹/kWh'), H('Grid cost ₹'), H('Grid ₹/kWh'), H('Solar cost ₹'), H('Total energy cost ₹'), H('Average ₹/kWh'), H('Note')];
  const row = (label: Row[number], m: Omit<BillingData['months'][number], 'month' | 'partial' | 'daysInRange'>, extra: string | null): Row => [
    label, n(m.daysWithData), kwh(m.demandKwh), kwh(m.iexKwh), kwh(m.solarUsedKwh), kwh(m.bankKwh), kwh(m.gridKwh), n(Math.round(m.peakKw)),
    rs(m.iexCostRs), rate(m.iexRate), rs(m.gridCostRs), rate(m.gridRate), rs(m.solarCostRs), rs(m.totalCostRs), rate(m.avgRate), t(extra)];
  const monthly: SheetData = [title, note, [], head];
  for (const m of b.months) {
    const notes = [m.partial ? 'month to date' : null, m.gridUnpricedKwh > 0.5 ? `${Math.round(m.gridUnpricedKwh)} grid kWh without a ToD rate` : null].filter(Boolean).join('; ');
    monthly.push(row(t(m.month), m, notes || null));
  }
  monthly.push([], row({ value: 'Total', type: String, fontWeight: 'bold' }, b.total, null));

  const days: SheetData = [title, note, [], [H('Date'), H('Demand kWh'), H('Power exchange kWh'), H('Solar used kWh'), H('Banking kWh'), H('Grid kWh'),
    H('IEX cost ₹'), H('Grid cost ₹'), H('Solar cost ₹'), H('Total energy cost ₹'), H('Average ₹/kWh')]];
  for (const x of [...b.days].reverse()) {
    if (!x.blocks) continue;
    days.push([d(x.date), kwh(x.demandKwh), kwh(x.iexKwh), kwh(x.solarUsedKwh), kwh(x.bankKwh), kwh(x.gridKwh),
      rs(x.iexLandedRs), rs(x.gridCostRs), rs(x.solarCostRs), rs(x.totalCostRs), rate(x.demandKwh ? x.totalCostRs / x.demandKwh : null)]);
  }
  return writeXlsxFile([
    { sheet: 'Monthly', data: monthly, stickyRowsCount: 4, columns: [{ width: 12 }, ...Array.from({ length: 14 }, () => ({ width: 15 })), { width: 34 }] },
    { sheet: 'Day-wise', data: days, stickyRowsCount: 4, columns: [{ width: 13 }, ...Array.from({ length: 10 }, () => ({ width: 15 }))] },
  ], { fontFamily: 'Calibri', fontSize: 11 }).toBuffer();
}

// ---------------------------------------------------------------------------- IEX prices
export async function iexWorkbook(x: IexData, generatedAt: string): Promise<Buffer> {
  const title: Row = [t(`IEX market clearing prices · ${x.date} · generated ${generatedAt} IST · ergOS client view`)];
  const blocks: SheetData = [title, [], [H('Date'), H('Block'), H('From'), H('To'),
    ...x.markets.map((m) => H(`${m.key} ₹/kWh`)), ...x.markets.map((m) => H(`${m.key} cleared MW`))]];
  for (let i = 0; i < 96; i++) {
    blocks.push([d(x.date), n(i + 1), t(blockStart(i + 1)), t(blockEnd(i + 1)),
      ...x.markets.map((m) => rate(m.mcp[i])), ...x.markets.map((m) => n(m.mcv[i], '#,##0.00'))]);
  }
  blocks.push([], [{ value: 'Volume-weighted average', type: String, fontWeight: 'bold' }, null, null, null, ...x.markets.map((m) => rate(m.avg))]);
  const trend: SheetData = [title, [], [H('Date'), ...x.markets.map((m) => H(`${m.key} avg ₹/kWh`)), ...x.markets.map((m) => H(`${m.key} cleared MWh`))]];
  for (const day of x.trend) {
    trend.push([d(day.date), ...x.markets.map((m) => rate(day.avg[m.key])), ...x.markets.map((m) => kwh(day.mwh[m.key]))]);
  }
  return writeXlsxFile([
    { sheet: 'Block-wise', data: blocks, stickyRowsCount: 3, columns: [{ width: 13 }, { width: 8 }, { width: 8 }, { width: 8 }, ...Array.from({ length: 6 }, () => ({ width: 15 }))] },
    { sheet: 'Last 30 days', data: trend, stickyRowsCount: 3, columns: [{ width: 13 }, ...Array.from({ length: 6 }, () => ({ width: 16 }))] },
  ], { fontFamily: 'Calibri', fontSize: 11 }).toBuffer();
}
