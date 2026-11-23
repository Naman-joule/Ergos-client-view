import 'server-only';
import type { Query } from '../db';
import { addDays, daysBetween, formatWeekday, isYmd, istToday, monthStart } from '../time';

// ---------------------------------------------------------------------------- period
export type Preset = 'this_month' | 'last_month' | 'last_30';
export interface Period { from: string; to: string; preset: Preset | null; clamped: boolean; explicit: boolean }

export function resolvePeriod(p: { from?: unknown; to?: unknown; preset?: unknown }, today = istToday()): Period {
  const yesterday = addDays(today, -1);
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const preset = one(p.preset);
  if (preset === 'this_month') return { from: monthStart(yesterday), to: yesterday, preset, clamped: false, explicit: true };
  if (preset === 'last_month') {
    const lastMonthEnd = addDays(monthStart(today), -1);
    return { from: monthStart(lastMonthEnd), to: lastMonthEnd, preset, clamped: false, explicit: true };
  }
  if (preset === 'last_30') return { from: addDays(today, -30), to: yesterday, preset, clamped: false, explicit: true };

  let from = isYmd(one(p.from)) ? (one(p.from) as string) : monthStart(yesterday);
  let to = isYmd(one(p.to)) ? (one(p.to) as string) : yesterday;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (daysBetween(from, to) > 365) { from = addDays(to, -365); clamped = true; }   // 366 days inclusive
  return { from, to, preset: null, clamped, explicit: isYmd(one(p.from)) || isYmd(one(p.to)) };
}

/** The month of `latest`, up to that day: used when the default period has no statements. */
export function periodEndingAt(latest: string): Period {
  return { from: monthStart(latest), to: latest, preset: null, clamped: false, explicit: false };
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

/**
 * Daily statements that belong to plant $1 (name $2). ergOS doesn't always fill plant_id on
 * iex_tod_daily_obligation, so a statement with no plant_id also counts when its portfolio is the
 * plant's (from its cleared trades or open access charges) or its plant_name is the plant's name.
 */
const STATEMENT_OF_PLANT = `(
  o.plant_id = $1
  OR (o.plant_id IS NULL AND (
       o.portfolio_id IN (SELECT DISTINCT b.portfolio_id FROM trading_result_block b WHERE b.plant_id = $1 AND b.portfolio_id IS NOT NULL)
    OR o.portfolio_id IN (SELECT c.portfolio_id FROM plant_open_access_charges c WHERE c.plant_id = $1)
    OR lower(trim(o.plant_name)) = lower(trim($2::text))
  ))
)`;

/** Latest trade date with a statement for the plant, or null when it has none at all. */
export async function latestStatementDate(q: Query, plantId: number, plantName: string): Promise<string | null> {
  const rows = await q<{ d: string | null }>(
    `SELECT max(o.trade_date)::text AS d FROM iex_tod_daily_obligation o WHERE ${STATEMENT_OF_PLANT}`, [plantId, plantName]);
  return rows[0]?.d ?? null;
}

/** The stored file path for one day's statement of plant $1 (same matching as the savings rows). */
export async function statementFilePath(q: Query, plantId: number, plantName: string, date: string,
  column: 'excel_file_path' | 'pdf_report_path' | 'statement_docx_path' | 'zip_bundle_path'): Promise<string | null> {
  const rows = await q<{ p: string | null }>(
    `SELECT o.${column} AS p FROM iex_tod_daily_obligation o
     WHERE ${STATEMENT_OF_PLANT} AND o.trade_date = $3::date
     ORDER BY (o.plant_id IS NULL), o.id DESC LIMIT 1`, [plantId, plantName, date]);
  return rows[0]?.p ?? null;
}

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

export async function loadSavings(q: Query, plantId: number, plantName: string, period: Period, profileDays: number | null): Promise<SavingsData> {
  const [rows, tod, heatRaw] = await Promise.all([
    q<SavingsRow>(`
      SELECT DISTINCT ON (o.trade_date)
             o.trade_date, o.volume_cleared_kwh, o.iex_energy_charge, o.iex_total_cost, o.avg_landed_iex_tariff,
             o.ctu_transmission_charges, o.stu_transmission_charges, o.distribution_charges, o.nldc_application_fees,
             o.nldc_scheduling_buy, o.sldc_scheduling_charges, o.fees, o.igst, o.css,
             o.grid_total_cost, o.avg_grid_tariff, o.electricity_duty_amount, o.net_savings_per_day, o.percent_below_grid,
             o.excel_file_path, o.statement_docx_path, o.pdf_report_path, o.zip_bundle_path, coalesce(o.is_locked, false) AS is_locked
      FROM iex_tod_daily_obligation o
      WHERE ${STATEMENT_OF_PLANT} AND o.trade_date BETWEEN $3::date AND $4::date
      ORDER BY o.trade_date, (o.plant_id IS NULL), o.id DESC`, [plantId, plantName, period.from, period.to]),
    // Indicative ToD split: cleared blocks priced at the plant's DISCOM ToD tariff (voltage level + FPPCA),
    // via app_tod_schedule() per month (migration 005: falls back to the same DISCOM / state and nearest month).
    q<{ ok: boolean }>(`SELECT to_regprocedure('app_tod_schedule(integer,date)') IS NOT NULL AS ok`).then(([{ ok }]) => ok
      ? q<TodSplitRow>(`
          WITH b AS (
            SELECT date_trunc('month', date)::date AS m, block_no,
                   coalesce(cleared_quantity, cleared_quantity_mw * 250) AS kwh,
                   coalesce(landed_cost, coalesce(cleared_quantity, cleared_quantity_mw * 250) * landed_cost_rs_per_kwh) AS landed
            FROM trading_result_block
            WHERE plant_id = $1 AND date BETWEEN $2::date AND $3::date AND upper(type_) = 'BUY'
          ), s AS (
            SELECT mo.m, t.block, t.tod, t.grid_rate
            FROM (SELECT DISTINCT m FROM b) mo CROSS JOIN LATERAL app_tod_schedule($1, mo.m) t
          )
          SELECT upper(regexp_replace(s.tod, '[^A-Za-z]', '', 'g')) AS tod_type,
                 sum(b.kwh)::float8 AS kwh, sum(b.landed)::float8 AS landed, sum(b.kwh * s.grid_rate)::float8 AS grid
          FROM b JOIN s ON s.m = b.m AND s.block = b.block_no
          GROUP BY 1
          ORDER BY CASE upper(regexp_replace(s.tod, '[^A-Za-z]', '', 'g')) WHEN 'PEAK' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END`,
          [plantId, period.from, period.to])
      : q<TodSplitRow>(`
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
          ORDER BY CASE upper(t.tod_type) WHEN 'PEAK' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END`, [plantId, period.from, period.to])),
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

