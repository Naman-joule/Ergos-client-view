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
  /** open-access losses ergOS applied that day, % (migration 010; null when not recorded) */
  distribution_loss_pct: number | null; ctu_loss_pct: number | null; stu_loss_pct: number | null;
  grid_total_cost: number; avg_grid_tariff: number | null; electricity_duty_amount: number;
  net_savings_per_day: number; percent_below_grid: number | null;
  excel_file_path: string | null; statement_docx_path: string | null; pdf_report_path: string | null; zip_bundle_path: string | null;
  is_locked: boolean;
  /** true when ergOS had no grid benchmark for the day and the client view estimated it (see estimateBenchmarks) */
  benchmark_estimated?: boolean;
  /** how the missing benchmark was filled: implied from ergOS's own savings, or estimated from the DISCOM tariff */
  benchmark_source?: 'implied' | 'tariff';
}

/** Charges grouped the way a bill reads: what each one pays for. */
export const CHARGE_GROUPS = [
  { key: 'network', label: 'Transmission and distribution charges', hint: 'For using the inter-state (CTU), state (STU) and DISCOM networks',
    items: ['ctu_transmission_charges', 'stu_transmission_charges', 'distribution_charges'] },
  { key: 'css', label: 'Cross-subsidy surcharge', hint: 'Paid to the DISCOM for buying power from outside it', items: ['css'] },
  { key: 'ops', label: 'Scheduling and exchange fees', hint: 'Load-despatch scheduling (SLDC, NLDC) and IEX transaction fees',
    items: ['sldc_scheduling_charges', 'nldc_scheduling_buy', 'nldc_application_fees', 'fees'] },
  { key: 'tax', label: 'IGST', hint: 'GST on the fees', items: ['igst'] },
] as const;

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
  tradeDays: number; best: SavingsRow | null; negativeDays: number; allLocked: boolean; estimatedDays: number; impliedDays: number;
  energyCharge: number; charges: Record<ChargeKey, number>;
  /** exchange energy: ergOS's iex_energy_charge, or, on days it left that at 0, the landed cost less the charges */
  energy: number; energyDerivedDays: number;
  /** landed cost not explained by energy + charges (rounding, or a charge ergOS doesn't itemise) */
  unaccounted: number;
  /** open-access losses: energy bought but not delivered, by network, over the days ergOS recorded loss rates */
  losses: { ctuKwh: number; stuKwh: number; distKwh: number; clearedKwh: number; days: number;
            ctuPct: number | null; stuPct: number | null; distPct: number | null };
}

export interface TodSplitRow { tod_type: string; kwh: number; landed: number; grid: number }
export interface HeatRow { label: string; date: string; values: number[] }

export interface SavingsData { rows: SavingsRow[]; totals: SavingsTotals; tod: TodSplitRow[]; heat: HeatRow[] }

/**
 * Daily statements that belong to plant $1. ergOS doesn't always fill plant_id on iex_tod_daily_obligation;
 * a statement without one belongs to the plant when its portfolio is this plant's (from its cleared trades or
 * open access charges) and no other plant's, so a multi-plant portfolio's statement isn't counted under each
 * plant. Plant names are not matched: two clients can name a plant the same (migration 011 closes the same gap
 * in RLS). $2 (the plant name) is kept in the signature for callers but no longer used.
 */
const STATEMENT_OF_PLANT = `(
  o.plant_id = $1
  OR (o.plant_id IS NULL AND $2::text IS NOT NULL AND o.portfolio_id IN (
       SELECT u.portfolio_id FROM (
         SELECT b.portfolio_id, b.plant_id FROM trading_result_block b WHERE b.portfolio_id IS NOT NULL
         UNION
         SELECT c.portfolio_id, c.plant_id FROM plant_open_access_charges c
       ) u
       WHERE u.portfolio_id IN (SELECT portfolio_id FROM trading_result_block WHERE plant_id = $1 AND portfolio_id IS NOT NULL
                                UNION SELECT portfolio_id FROM plant_open_access_charges WHERE plant_id = $1)
       GROUP BY u.portfolio_id HAVING bool_and(u.plant_id = $1)
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
    estimatedDays: rows.filter((r) => r.benchmark_estimated && r.benchmark_source !== 'implied').length,
    impliedDays: rows.filter((r) => r.benchmark_source === 'implied').length,
    energyCharge: sum('iex_energy_charge'),
    charges,
    ...breakdownOf(rows),
  };
}

/** Split each day's landed cost into energy + charges, and its cleared kWh into delivered + losses. */
function breakdownOf(rows: SavingsRow[]) {
  let energy = 0, energyDerivedDays = 0, unaccounted = 0;
  const L = { ctuKwh: 0, stuKwh: 0, distKwh: 0, clearedKwh: 0, days: 0 };
  const pcts = { ctu: new Set<number>(), stu: new Set<number>(), dist: new Set<number>() };
  for (const r of rows) {
    const charges = CHARGE_COLUMNS.reduce((a, [k]) => a + n(r[k]), 0);
    const total = n(r.iex_total_cost);
    let e = n(r.iex_energy_charge);
    if (e <= 0 && total > charges) { e = total - charges; energyDerivedDays++; }
    energy += e;
    unaccounted += total - e - charges;
    const kwh = n(r.volume_cleared_kwh);
    if (kwh > 0 && (r.ctu_loss_pct != null || r.stu_loss_pct != null || r.distribution_loss_pct != null)) {
      // the power passes the inter-state network, then the state's, then the DISCOM's; each loses its share
      const ctu = kwh * n(r.ctu_loss_pct) / 100;
      const stu = (kwh - ctu) * n(r.stu_loss_pct) / 100;
      const dist = (kwh - ctu - stu) * n(r.distribution_loss_pct) / 100;
      L.ctuKwh += ctu; L.stuKwh += stu; L.distKwh += dist; L.clearedKwh += kwh; L.days++;
      pcts.ctu.add(n(r.ctu_loss_pct)); pcts.stu.add(n(r.stu_loss_pct)); pcts.dist.add(n(r.distribution_loss_pct));
    }
  }
  const only = (s: Set<number>) => (s.size === 1 ? [...s][0]! : null);   // one rate over the period, else none to quote
  return { energy, energyDerivedDays, unaccounted,
    losses: { ...L, ctuPct: only(pcts.ctu), stuPct: only(pcts.stu), distPct: only(pcts.dist) } };
}

/**
 * ergOS sometimes stores a day with no grid benchmark (avg_grid_tariff and grid_total_cost 0), e.g. when it
 * found no DISCOM tariff for the plant. Showing ₹0 makes the savings meaningless, so for those days the
 * benchmark is estimated the same way ergOS defines it: each cleared 15-minute block priced at the plant's
 * DISCOM ToD rate for its voltage level plus FPPCA (app_tod_schedule, migrations 005/006), weighted by the
 * block's cleared kWh. Without block data for the day, the day's average ToD rate is used. Grid cost, net
 * savings and % below grid are then recomputed from it, and the row is flagged benchmark_estimated.
 * When ergOS DID store a savings figure for the day (only its grid cost is missing), its savings are kept as
 * they are and the grid cost is implied from them (IEX cost + savings), so the client view's savings always
 * equal ergOS's; the tariff estimate is used only for days with no savings figure at all.
 * Days ergOS did price are never touched.
 */
export async function estimateBenchmarks(q: Query, plantId: number, rows: SavingsRow[]): Promise<SavingsRow[]> {
  const missing = rows.filter((r) => !(r.avg_grid_tariff && r.avg_grid_tariff > 0) && !(r.grid_total_cost && r.grid_total_cost > 0) && r.volume_cleared_kwh > 0);
  if (!missing.length) return rows;
  const [{ ok }] = await q<{ ok: boolean }>(`SELECT to_regprocedure('app_tod_schedule(integer,date)') IS NOT NULL AS ok`);
  if (!ok) return rows;
  const rates = await q<{ day: string; weighted: number | null; flat: number | null }>(`
    WITH d AS (SELECT unnest($2::date[]) AS day),
    s AS (SELECT d.day, t.block, t.grid_rate FROM d CROSS JOIN LATERAL app_tod_schedule($1, d.day) t WHERE t.grid_rate > 0),
    b AS (SELECT date AS day, block_no, sum(coalesce(cleared_quantity, cleared_quantity_mw * 250))::float8 AS kwh
          FROM trading_result_block
          WHERE plant_id = $1 AND date = ANY($2::date[]) AND upper(type_) = 'BUY'
          GROUP BY 1, 2)
    SELECT s.day::text AS day,
           (sum(b.kwh * s.grid_rate) / nullif(sum(b.kwh), 0))::float8 AS weighted,
           avg(s.grid_rate)::float8 AS flat
    FROM s LEFT JOIN b ON b.day = s.day AND b.block_no = s.block
    GROUP BY 1`, [plantId, missing.map((r) => r.trade_date)]);
  const byDay = new Map(rates.map((r) => [r.day, r.weighted ?? r.flat]));
  return rows.map((r) => {
    if (!missing.includes(r)) return r;
    // ergOS has savings but no grid cost: keep its savings, imply the grid cost and benchmark from them
    if (r.net_savings_per_day != null && r.net_savings_per_day !== 0 && (r.iex_total_cost || 0) > 0) {
      const grid = (r.iex_total_cost || 0) + r.net_savings_per_day;
      return { ...r, grid_total_cost: grid, avg_grid_tariff: grid / r.volume_cleared_kwh,
               percent_below_grid: grid ? (r.net_savings_per_day / grid) * 100 : null, benchmark_estimated: true, benchmark_source: 'implied' as const };
    }
    const rate = byDay.get(r.trade_date);
    if (!rate || !(rate > 0)) return r;
    const grid = rate * r.volume_cleared_kwh;
    const savings = grid - (r.iex_total_cost || 0);
    return { ...r, avg_grid_tariff: rate, grid_total_cost: grid, net_savings_per_day: savings,
             percent_below_grid: grid ? (savings / grid) * 100 : null, benchmark_estimated: true, benchmark_source: 'tariff' as const };
  });
}

export async function loadSavings(q: Query, plantId: number, plantName: string, period: Period, profileDays: number | null): Promise<SavingsData> {
  const [rows, tod, heatRaw] = await Promise.all([
    q<SavingsRow>(`
      SELECT DISTINCT ON (o.trade_date)
             o.trade_date, o.volume_cleared_kwh, o.iex_energy_charge, o.iex_total_cost, o.avg_landed_iex_tariff,
             o.ctu_transmission_charges, o.stu_transmission_charges, o.distribution_charges, o.nldc_application_fees,
             o.nldc_scheduling_buy, o.sldc_scheduling_charges, o.fees, o.igst, o.css,
             -- read through jsonb so the page still works before migration 010 adds these columns
             (to_jsonb(o) ->> 'distribution_loss_pct')::float8 AS distribution_loss_pct,
             (to_jsonb(o) ->> 'ctu_loss_pct')::float8 AS ctu_loss_pct,
             (to_jsonb(o) ->> 'stu_loss_pct')::float8 AS stu_loss_pct,
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

  const priced = await estimateBenchmarks(q, plantId, rows);
  return { rows: priced, totals: totalsOf(priced), tod, heat };
}

