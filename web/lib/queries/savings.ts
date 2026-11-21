import 'server-only';
import type { Query } from '../db';
import { addDays, daysBetween, formatWeekday, isYmd, istToday, monthStart } from '../time';

// ---------------------------------------------------------------------------- period
export type Preset = 'this_month' | 'last_month' | 'last_30';
export interface Period { from: string; to: string; preset: Preset | null; clamped: boolean }

export function resolvePeriod(p: { from?: unknown; to?: unknown; preset?: unknown }, today = istToday()): Period {
  const yesterday = addDays(today, -1);
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const preset = one(p.preset);
  if (preset === 'this_month') return { from: monthStart(yesterday), to: yesterday, preset, clamped: false };
  if (preset === 'last_month') {
    const lastMonthEnd = addDays(monthStart(today), -1);
    return { from: monthStart(lastMonthEnd), to: lastMonthEnd, preset, clamped: false };
  }
  if (preset === 'last_30') return { from: addDays(today, -30), to: yesterday, preset, clamped: false };

  let from = isYmd(one(p.from)) ? (one(p.from) as string) : monthStart(yesterday);
  let to = isYmd(one(p.to)) ? (one(p.to) as string) : yesterday;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (daysBetween(from, to) > 365) { from = addDays(to, -365); clamped = true; }   // 366 days inclusive
  return { from, to, preset: null, clamped };
}

// ---------------------------------------------------------------------------- data
export interface SavingsRow {
  trade_date: string;
  volume_cleared_kwh: number; iex_energy_charge: number; iex_total_cost: number; avg_landed_iex_tariff: number | null;
  ctu_transmission_charges: number; stu_transmission_charges: number; distribution_charges: number;
  nldc_application_fees: number; nldc_scheduling_buy: number; sldc_scheduling_charges: number;
  fees: number; igst: number; css: number;
  grid_total_cost: number; avg_grid_tariff: number | null; electricity_duty_amount: number;
  net_savings_per_day: number; percent_below_grid: number | null;
  excel_file_path: string | null; statement_docx_path: string | null; pdf_report_path: string | null; zip_bundle_path: string | null;
  is_locked: boolean;
}

export const CHARGE_COLUMNS = [
  ['ctu_transmission_charges', 'CTU transmission'],
  ['stu_transmission_charges', 'STU transmission'],
  ['distribution_charges', 'Distribution'],
  ['css', 'Cross-subsidy surcharge'],
  ['sldc_scheduling_charges', 'SLDC scheduling'],
  ['nldc_scheduling_buy', 'NLDC scheduling'],
  ['nldc_application_fees', 'NLDC application'],
  ['fees', 'Exchange fees'],
  ['igst', 'IGST'],
] as const;
export type ChargeKey = (typeof CHARGE_COLUMNS)[number][0];

export interface SavingsTotals {
  volumeKwh: number; iexCost: number; gridCost: number; savings: number;
  landedRate: number | null; benchmarkRate: number | null; percentBelow: number | null;
  tradeDays: number; best: SavingsRow | null; negativeDays: number; allLocked: boolean;
  energyCharge: number; charges: Record<ChargeKey, number>;
}

export interface TodSplitRow { tod_type: string; kwh: number; landed: number; grid: number }
export interface HeatRow { label: string; date: string; values: number[] }

export interface SavingsData { rows: SavingsRow[]; totals: SavingsTotals; tod: TodSplitRow[]; heat: HeatRow[] }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function totalsOf(rows: SavingsRow[]): SavingsTotals {
  const sum = (k: keyof SavingsRow) => rows.reduce((a, r) => a + n(r[k]), 0);
  const volumeKwh = sum('volume_cleared_kwh');
  const iexCost = sum('iex_total_cost');
  const gridCost = sum('grid_total_cost');
  const savings = sum('net_savings_per_day');
  const charges = Object.fromEntries(CHARGE_COLUMNS.map(([k]) => [k, sum(k)])) as Record<ChargeKey, number>;
  let best: SavingsRow | null = null;
  for (const r of rows) if (!best || n(r.net_savings_per_day) > n(best.net_savings_per_day)) best = r;
  return {
    volumeKwh, iexCost, gridCost, savings,
    landedRate: volumeKwh ? iexCost / volumeKwh : null,
    benchmarkRate: volumeKwh ? gridCost / volumeKwh : null,
    percentBelow: gridCost ? savings / gridCost : null,
    tradeDays: rows.filter((r) => n(r.volume_cleared_kwh) > 0).length,
    best,
    negativeDays: rows.filter((r) => n(r.net_savings_per_day) < 0).length,
    allLocked: rows.every((r) => r.is_locked),
    energyCharge: sum('iex_energy_charge'),
    charges,
  };
}

export async function loadSavings(q: Query, plantId: number, period: Period, profileDays: number | null): Promise<SavingsData> {
  const [rows, tod, heatRaw] = await Promise.all([
    q<SavingsRow>(`
      SELECT trade_date, volume_cleared_kwh, iex_energy_charge, iex_total_cost, avg_landed_iex_tariff,
             ctu_transmission_charges, stu_transmission_charges, distribution_charges, nldc_application_fees,
             nldc_scheduling_buy, sldc_scheduling_charges, fees, igst, css,
             grid_total_cost, avg_grid_tariff, electricity_duty_amount, net_savings_per_day, percent_below_grid,
             excel_file_path, statement_docx_path, pdf_report_path, zip_bundle_path, coalesce(is_locked, false) AS is_locked
      FROM iex_tod_daily_obligation
      WHERE plant_id = $1 AND trade_date BETWEEN $2::date AND $3::date
      ORDER BY trade_date`, [plantId, period.from, period.to]),
    // Indicative ToD split: cleared blocks priced at the DISCOM ToD tariff for the plant's voltage level + FPPCA.
    q<TodSplitRow>(`
      SELECT t.tod_type,
             sum(coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250))::float8 AS kwh,
             sum(coalesce(b.landed_cost, coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250) * b.landed_cost_rs_per_kwh))::float8 AS landed,
             sum(coalesce(b.cleared_quantity, b.cleared_quantity_mw * 250)
                 * (CASE p.voltage_level WHEN '132_kv' THEN t.tariff_132_kv WHEN '66_kv' THEN t.tariff_66_kv ELSE t.tariff_33_kv END
                    + coalesce(t.fppca_charge, 0)))::float8 AS grid
      FROM trading_result_block b
      JOIN plant p ON p.plant_id = b.plant_id
      JOIN state_grid_discom_tariff t
        ON t.plant_id = b.plant_id AND t.block = b.block_no
       AND t.year = extract(year FROM b.date)::int AND t.month = extract(month FROM b.date)::int
      WHERE b.plant_id = $1 AND b.date BETWEEN $2::date AND $3::date AND upper(b.type_) = 'BUY'
      GROUP BY t.tod_type
      ORDER BY CASE upper(t.tod_type) WHEN 'PEAK' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END`, [plantId, period.from, period.to]),
    profileDays
      ? q<{ d: string; block_no: number; kwh: number }>(`
          SELECT date::text AS d, block_no, sum(coalesce(cleared_quantity, cleared_quantity_mw * 250))::float8 AS kwh
          FROM trading_result_block
          WHERE plant_id = $1 AND date BETWEEN $2::date - ($3::int - 1) AND $2::date AND upper(type_) = 'BUY'
          GROUP BY 1, 2`, [plantId, period.to, profileDays])
      : Promise.resolve([]),
  ]);

  const heat: HeatRow[] = [];
  if (profileDays) {
    const byDay = new Map<string, number[]>();
    for (const r of heatRaw) {
      if (r.block_no < 1 || r.block_no > 96) continue;
      const v = byDay.get(r.d) ?? new Array<number>(96).fill(0);
      v[r.block_no - 1] += r.kwh * 4;
      byDay.set(r.d, v);
    }
    for (let k = profileDays - 1; k >= 0; k--) {
      const d = addDays(period.to, -k);
      const v = byDay.get(d);
      if (v) heat.push({ date: d, label: formatWeekday(d).replace(/,.*$/, '') + ' ' + Number(d.slice(8)), values: v });
    }
  }

  return { rows, totals: totalsOf(rows), tod, heat };
}

/** Only http(s) report paths become links; anything else (file paths, s3://) is shown as text or not at all. */
export function safeReportUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    const u = new URL(path);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
