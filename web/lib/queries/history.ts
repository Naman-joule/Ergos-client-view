import 'server-only';
import type { Query } from '../db';
import { addDays, currentBlock, istToday } from '../time';
import { allocate, SUPPLY_LAYERS } from '../supply';
import { billDay, billTotal, type BillDay } from '../bill';
import { rangeRunStats, type RunStats, type TodInput } from '../tod';
import { meterShift, normaliseTod, todSchedule } from './today';

// History: a plant's energy supply over a date range. Per day and 15-minute block it applies exactly the
// same rules as Today (lib/supply.ts: IEX first, then solar, banking, grid), then returns daily totals, the
// block series for short ranges, and the range's ToD stats.

export const HISTORY_MAX_DAYS = 92;
export const BLOCK_SERIES_MAX_DAYS = 7;          // up to this many days, the timeline shows every block

export type HistoryPreset = 'mtd' | 'last7';
export interface HistoryPeriod { from: string; to: string; preset: HistoryPreset | null; clamped: boolean }

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Range from the URL: ?preset=mtd|last7, or ?from=&to= (custom). Default: last 7 days. Never after today. */
export function resolveHistoryPeriod(p: { preset?: unknown; from?: unknown; to?: unknown }, today = istToday()): HistoryPeriod {
  const preset = one(p.preset);
  if (preset === 'mtd') return { from: `${today.slice(0, 8)}01`, to: today, preset: 'mtd', clamped: false };
  const f = one(p.from), t = one(p.to);
  if (preset !== 'last7' && (isYmd(f) || isYmd(t))) {
    let to = isYmd(t) ? t : today;
    if (to > today) to = today;
    let from = isYmd(f) ? f : addDays(to, -6);
    if (from > to) [from, to] = [to, from];
    let clamped = false;
    if (daysBetween(from, to) > HISTORY_MAX_DAYS) { from = addDays(to, -(HISTORY_MAX_DAYS - 1)); clamped = true; }
    return { from, to, preset: null, clamped };
  }
  return { from: addDays(today, -6), to: today, preset: 'last7', clamped: false };
}

export interface HistoryDay {
  date: string;
  blocks: number;                 // blocks with meter data
  demandKwh: number; iexKwh: number; iexUsedKwh: number; solarKwh: number; solarUsedKwh: number;
  bankKwh: number; gridKwh: number; surplusKwh: number;
  peakKw: number; peakBlock: number | null;
  iexLandedRs: number; landedRate: number | null;
  /** energy bill the way ergOS bills it (lib/bill.ts): grid kWh × tariff × (1+FPPCA%)(1+duty%), all solar ×
   *  solar rate, exchange × landed rate in metered blocks; banking saving and all-grid cost alongside */
  gridCostRs: number; solarCostRs: number; exchangeCostRs: number; totalCostRs: number;
  bankSavedRs: number; allGridCostRs: number;
  gridUnpricedKwh: number;        // grid kWh in blocks with no grid rate (not in gridCostRs)
  pricedBy: 'ergos' | 'fallback' | null;   // ergOS tariff rows (app_bill_tariff), or the ToD schedule fallback
  bill: BillDay;
}

/** One 15-minute block (exports). Energy in kWh for the block; rates in ₹/kWh. */
export interface HistoryBlock {
  date: string; block: number; tod: string | null;
  demandKwh: number; iexKwh: number; iexUsedKwh: number; solarKwh: number; solarUsedKwh: number;
  bankKwh: number; gridKwh: number; surplusKwh: number;
  iexRate: number | null; gridRate: number | null; solarRate: number | null;
}

/** One ToD period of one day (exports); `date` is null for the all-days total. */
export interface HistoryTodRow { date: string | null; stats: RunStats }

export interface HistorySeries {
  /** kW per block across the range (days x 96), null where a day has no data yet */
  demand: (number | null)[]; iex: number[]; solar: number[]; bank: number[]; grid: number[]; surplus: number[];
  days: string[];                 // the range's dates, in order; block i belongs to days[floor(i / 96)]
}

export interface HistoryData {
  period: HistoryPeriod;
  days: HistoryDay[];             // every date in the range, oldest first (zeros where there is no data)
  totals: Omit<HistoryDay, 'date' | 'peakBlock' | 'pricedBy' | 'bill'> & { peakDate: string | null; peakBlock: number | null; daysWithData: number };
  series: HistorySeries | null;   // only for ranges up to BLOCK_SERIES_MAX_DAYS
  tod: RunStats[];                // ToD periods summed over the range
  todDays: number;                // days that went into the ToD stats
  blocks?: HistoryBlock[];        // with { detail: true }
  todByMonth?: Record<string, { runs: RunStats[]; days: number }>;   // with { todByMonth: true }: YYYY-MM -> that month's ToD periods
  todByDay?: HistoryTodRow[];     // with { detail: true }: each day's ToD periods, then the all-days rows
  hasSolar: boolean;
  hasBank: boolean;
}

const z = () => new Array<number>(96).fill(0);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export async function loadHistory(q: Query, plantId: number, period: HistoryPeriod, opts: { detail?: boolean; todByMonth?: boolean } = {}): Promise<HistoryData> {
  const { from, to } = period;
  const shift = meterShift();
  const today = istToday();

  const mappings = await q<{ source_plant_id: number; s_t_ratio: number }>(
    `SELECT source_plant_id, s_t_ratio FROM plant_gen_con_mapping WHERE target_plant_id = $1 AND is_active`, [plantId]);
  const plantIds = [plantId, ...mappings.map((m) => m.source_plant_id)];
  const ratio = new Map(mappings.map((m) => [m.source_plant_id, Number(m.s_t_ratio) || 0]));

  const [{ ok: hasSchedFn, bill: hasBillFn }] = await q<{ ok: boolean; bill: boolean }>(
    `SELECT to_regprocedure('app_tod_schedule(integer,date)') IS NOT NULL AS ok, to_regprocedure('app_bill_tariff(integer,date)') IS NOT NULL AS bill`);

  const [meter, trades, banking, , fallbackSched] = await Promise.all([
    // readings bucketed by their shifted IST timestamp (same as Today), per day and block
    q<{ plant_id: number; d: string; block: number; kwh: number }>(`
      WITH m AS (
        SELECT plant_id, kwh_delta, (meter_timestamp AT TIME ZONE 'Asia/Kolkata') - $4::interval AS t
        FROM plant_processed_meter_data
        WHERE plant_id = ANY($1::int[]) AND date BETWEEN $2::date - 1 AND $3::date + 1
      )
      SELECT plant_id, t::date::text AS d,
             (extract(hour FROM t) * 4 + floor(extract(minute FROM t) / 15) + 1)::int AS block,
             sum(kwh_delta)::float8 AS kwh
      FROM m WHERE t::date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2, 3`, [plantIds, from, to, shift]),
    q<{ d: string; block_no: number; kwh: number; landed: number }>(`
      SELECT date::text AS d, block_no,
             sum(coalesce(cleared_quantity, cleared_quantity_mw * 250))::float8 AS kwh,
             sum(coalesce(landed_cost, coalesce(cleared_quantity, cleared_quantity_mw * 250) * landed_cost_rs_per_kwh))::float8 AS landed
      FROM trading_result_block
      WHERE plant_id = $1 AND date BETWEEN $2::date AND $3::date AND upper(type_) = 'BUY'
      GROUP BY 1, 2`, [plantId, from, to]),
    // banking as ergOS bills it: adjusted_discharge is what was drawn back (no fallback to discharge)
    q<{ d: string; block: number; drawn: number; charge: number; discharge: number }>(`
      SELECT date::text AS d, block, sum(coalesce(adjusted_discharge, 0))::float8 AS drawn,
             sum(coalesce(charge, 0))::float8 AS charge, sum(coalesce(discharge, 0))::float8 AS discharge
      FROM banking WHERE plant_id = $1 AND date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`, [plantId, from, to]),
    Promise.resolve(null),
    hasSchedFn || hasBillFn ? Promise.resolve(null) : todSchedule(q, plantId, to),
  ]);

  // ---- tariffs, as ergOS bills: ergOS's own tariff rows (app_bill_tariff: rate × (1+FPPCA%)(1+duty%)); days or
  // months it has no rows for fall back to the ToD schedule (app_tod_schedule). Up to a month: every day (exact,
  // handles a mid-month change); longer: once per month (each lookup scans the state's tariff rows, and per-day
  // lookups over long ranges ran into the statement timeout on production-sized tables).
  type SchedRow = { d: string; block: number; tod: string | null; grid_rate: number | null; solar_rate: number | null };
  const monthly = daysBetween(from, to) > 31;
  const dateList: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dateList.push(d);
  const keyDates = monthly ? [...new Set(dateList.map((d) => (d.slice(0, 7) + '-01' < from ? from : d.slice(0, 7) + '-01')))] : dateList;
  const keyOf = (d: string) => (monthly ? d.slice(0, 7) : d);
  const lookup = (fn: string, keys: string[]) => (keys.length ? q<SchedRow>(`
      SELECT ${monthly ? "to_char(k, 'YYYY-MM')" : 'k::text'} AS d, t.block, t.tod, t.grid_rate, t.solar_rate
      FROM unnest($2::date[]) AS k CROSS JOIN LATERAL ${fn}($1, k) t`, [plantId, keys]) : Promise.resolve([] as SchedRow[]));
  const billRows = hasBillFn ? await lookup('app_bill_tariff', keyDates) : [];
  const billKeys = new Set(billRows.map((r) => r.d));
  const missing = keyDates.filter((k) => !billKeys.has(keyOf(k)));
  const sched = hasSchedFn ? await lookup('app_tod_schedule', missing) : [];
  const pricedBy = new Map<string, 'ergos' | 'fallback'>([...billKeys].map((k) => [k, 'ergos' as const]));
  for (const r of sched) if (!pricedBy.has(r.d)) pricedBy.set(r.d, 'fallback');

  // ---- per-day, per-block inputs
  type DayIn = { demandKwh: number[]; solarKwh: number[]; iexKwh: number[]; iexLanded: number[]; bankKw: number[];
                 hasMeter: boolean[]; chargeKwh: number[]; dischargeKwh: number[]; todRaw: (string | null)[];
                 tod: (string | null)[]; gridRate: (number | null)[]; solarRate: (number | null)[]; last: number };
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const byDay = new Map<string, DayIn>(dates.map((d) => [d, {
    demandKwh: z(), solarKwh: z(), iexKwh: z(), iexLanded: z(), bankKw: z(),
    hasMeter: new Array(96).fill(false), chargeKwh: z(), dischargeKwh: z(), todRaw: new Array(96).fill(null),
    tod: new Array(96).fill(null), gridRate: new Array(96).fill(null), solarRate: new Array(96).fill(null), last: -1,
  }]));
  for (const r of meter) {
    const day = byDay.get(r.d);
    if (!day || r.block < 1 || r.block > 96) continue;
    if (r.plant_id === plantId) { day.demandKwh[r.block - 1]! += r.kwh; day.hasMeter[r.block - 1] = true; day.last = Math.max(day.last, r.block - 1); }
    else day.solarKwh[r.block - 1]! += r.kwh * (ratio.get(r.plant_id) ?? 0);
  }
  for (const t of trades) {
    const day = byDay.get(t.d);
    if (!day || t.block_no < 1 || t.block_no > 96) continue;
    day.iexKwh[t.block_no - 1]! += t.kwh || 0;
    day.iexLanded[t.block_no - 1]! += t.landed || 0;
  }
  for (const b of banking) {
    const day = byDay.get(b.d);
    if (!day || b.block < 1 || b.block > 96) continue;
    day.bankKw[b.block - 1]! += (b.drawn || 0) * 4;
    day.chargeKwh[b.block - 1]! += b.charge || 0;
    day.dischargeKwh[b.block - 1]! += b.discharge || 0;
  }
  const schedRows = hasSchedFn || hasBillFn ? [...billRows, ...sched]
    : dates.flatMap((d) => (fallbackSched?.rows ?? []).map((r) => ({ ...r, d })));
  // rows are keyed by day (YYYY-MM-DD) or, for long ranges, by month (YYYY-MM): spread a month to its days
  const daysFor = (key: string) => (key.length === 7 ? dates.filter((d) => d.startsWith(key)) : [key]);
  for (const s of schedRows) {
    if (s.block < 1 || s.block > 96) continue;
    for (const d of daysFor(s.d)) {
      const day = byDay.get(d);
      if (!day) continue;
      day.tod[s.block - 1] = normaliseTod(s.tod);
      day.todRaw[s.block - 1] = s.tod ? s.tod.trim() : null;
      day.gridRate[s.block - 1] = s.grid_rate;
      day.solarRate[s.block - 1] = s.solar_rate;
    }
  }

  // ---- allocate each day, then roll up
  const days: HistoryDay[] = [];
  const todInputs: TodInput[] = [];
  let layout: { tod: (string | null)[]; gridRate: (number | null)[] } | null = null;
  const blocks: HistoryBlock[] | undefined = opts.detail ? [] : undefined;
  const todDates: string[] = [];
  const series: HistorySeries | null = dates.length <= BLOCK_SERIES_MAX_DAYS
    ? { demand: [], iex: [], solar: [], bank: [], grid: [], surplus: [], days: dates } : null;

  for (const date of dates) {
    const day = byDay.get(date)!;
    const now = date === today ? Math.min(day.last, currentBlock() - 1) : day.last;
    const demand = day.demandKwh.map((k) => k * 4);
    const solar = day.solarKwh.map((k) => k * 4);
    const iex = day.iexKwh.map((k) => k * 4);
    const a = allocate(demand, iex, solar, day.bankKw, now);
    const upTo = (arr: number[]) => arr.slice(0, now + 1);

    let peakKw = 0, peakBlock: number | null = null;
    for (let i = 0; i <= now; i++) if (demand[i]! > peakKw) { peakKw = demand[i]!; peakBlock = i + 1; }
    const iexKwh = sum(day.iexKwh), iexLandedRs = sum(day.iexLanded);
    const bill = billDay(day.demandKwh.map((kwh, i) => ({
      hasMeter: day.hasMeter[i]! && i <= now, demandKwh: kwh, solarKwh: day.solarKwh[i]!, exchangeKwh: day.iexKwh[i]!, exchangeCostRs: day.iexLanded[i]!,
      chargeKwh: day.chargeKwh[i]!, adjDischargeKwh: day.bankKw[i]! / 4, dischargeKwh: day.dischargeKwh[i]!,
      gridRate: day.gridRate[i] ?? null, solarRate: day.solarRate[i] ?? null, tod: day.todRaw[i] ?? null,
    })));
    for (let i = 0; i <= now; i++) {
      const g = a.grid[i]! / 4, sol = a.solarUsed[i]! / 4, gr = day.gridRate[i], sr = day.solarRate[i];
      if (blocks) {
        blocks.push({
          date, block: i + 1, tod: day.tod[i] ?? null,
          demandKwh: day.demandKwh[i]!, iexKwh: day.iexKwh[i]!, iexUsedKwh: a.iexUsed[i]! / 4,
          solarKwh: day.solarKwh[i]!, solarUsedKwh: sol, bankKwh: a.bank[i]! / 4, gridKwh: g, surplusKwh: a.surplus[i]! / 4,
          iexRate: day.iexKwh[i] ? day.iexLanded[i]! / day.iexKwh[i]! : null, gridRate: gr ?? null, solarRate: sr ?? null,
        });
      }
    }
    days.push({
      date, blocks: now + 1, gridCostRs: bill.gridCostRs, solarCostRs: bill.solarCostRs, exchangeCostRs: bill.exchangeCostRs,
      totalCostRs: billTotal(bill), bankSavedRs: bill.bankSavedRs, allGridCostRs: bill.allGridCostRs, gridUnpricedKwh: bill.gridUnpricedKwh,
      pricedBy: pricedBy.get(keyOf(date)) ?? null, bill,
      demandKwh: sum(upTo(day.demandKwh)), iexKwh, iexUsedKwh: sum(upTo(a.iexUsed)) / 4,
      solarKwh: sum(upTo(day.solarKwh)), solarUsedKwh: sum(upTo(a.solarUsed)) / 4,
      bankKwh: sum(upTo(a.bank)) / 4, gridKwh: sum(upTo(a.grid)) / 4, surplusKwh: sum(upTo(a.surplus)) / 4,
      peakKw, peakBlock, iexLandedRs, landedRate: iexKwh ? iexLandedRs / iexKwh : null,
    });

    if (series) {
      for (let i = 0; i < 96; i++) {
        const has = i <= now;
        series.demand.push(has ? demand[i]! : null);
        series.iex.push(has ? iex[i]! : 0);
        series.solar.push(a.solarUsed[i]!);
        series.bank.push(a.bank[i]!);
        series.grid.push(a.grid[i]!);
        series.surplus.push(a.surplus[i]!);
      }
    }

    if (now >= 0 && day.tod.some(Boolean)) {
      const values: Record<string, number[]> = { iex, solar: a.solarUsed, bank: a.bank, grid: a.grid, surplus: a.surplus };
      todInputs.push({
        tod: day.tod, now, demand, iexRate: day.iexKwh.map((k, i) => (k ? day.iexLanded[i]! / k : null)),
        gridRate: day.gridRate, solarRate: day.solarRate,
        layers: SUPPLY_LAYERS.map((l) => ({ key: l.key, slot: l.slot, label: l.label, hatch: 'hatch' in l ? l.hatch : undefined, values: values[l.key]! })),
      });
      layout = { tod: day.tod, gridRate: day.gridRate };          // the latest day with a schedule
      todDates.push(date);
    }
  }

  // ---- totals
  const withData = days.filter((d) => d.blocks > 0);
  const add = (k: keyof HistoryDay) => days.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const peakDay = withData.reduce<HistoryDay | null>((p, d) => (!p || d.peakKw > p.peakKw ? d : p), null);
  const iexKwh = add('iexKwh'), iexLandedRs = add('iexLandedRs');
  const totals: HistoryData['totals'] = {
    blocks: add('blocks'), demandKwh: add('demandKwh'), iexKwh, iexUsedKwh: add('iexUsedKwh'),
    solarKwh: add('solarKwh'), solarUsedKwh: add('solarUsedKwh'), bankKwh: add('bankKwh'), gridKwh: add('gridKwh'),
    surplusKwh: add('surplusKwh'), peakKw: peakDay?.peakKw ?? 0, peakDate: peakDay?.date ?? null, peakBlock: peakDay?.peakBlock ?? null,
    iexLandedRs, landedRate: iexKwh ? iexLandedRs / iexKwh : null, daysWithData: withData.length,
    gridCostRs: add('gridCostRs'), solarCostRs: add('solarCostRs'), exchangeCostRs: add('exchangeCostRs'), totalCostRs: add('totalCostRs'),
    bankSavedRs: add('bankSavedRs'), allGridCostRs: add('allGridCostRs'), gridUnpricedKwh: add('gridUnpricedKwh'),
  };

  const tod = layout ? rangeRunStats(todInputs, layout) : [];
  let todByMonth: HistoryData['todByMonth'];
  if (opts.todByMonth) {
    todByMonth = {};
    const months = [...new Set(todDates.map((d) => d.slice(0, 7)))];
    for (const m of months) {
      const idx = todDates.map((d, k) => (d.startsWith(m) ? k : -1)).filter((k) => k >= 0);
      const inputs = idx.map((k) => todInputs[k]!);
      const last = inputs[inputs.length - 1]!;                       // the month's latest schedule sets the periods
      todByMonth[m] = { runs: rangeRunStats(inputs, { tod: last.tod, gridRate: last.gridRate }), days: inputs.length };
    }
  }
  let todByDay: HistoryTodRow[] | undefined;
  if (opts.detail && layout) {
    const lay = layout;
    todByDay = todInputs.flatMap((inp, k) => rangeRunStats([inp], lay).map((stats) => ({ date: todDates[k]!, stats })));
    todByDay.push(...tod.map((stats) => ({ date: null, stats })));
  }

  return {
    period, days, totals, series,
    tod, todDays: todInputs.length, blocks, todByDay, todByMonth,
    hasSolar: mappings.length > 0,
    hasBank: totals.bankKwh > 0,
  };
}
