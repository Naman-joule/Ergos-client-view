import 'server-only';
import { buyRows } from './exchange';
import { STATEMENT_COSTS_SQL } from './statement';
import type { Query } from '../db';
import { parsePrebid, sumCurves } from '../prebid';
import { addDays, currentBlock, istToday } from '../time';
import { allocate } from '../supply';

/** 15 minutes when meter_timestamp marks the end of the interval (default), 0 when it marks the start. */
export function meterShift(): string {
  return process.env.METER_TS_CONVENTION === 'start' ? '0 minutes' : '15 minutes';
}

// Bucket each reading by its shifted IST timestamp, not by the stored date column.
const BLOCK_SQL = `
  WITH m AS (
    SELECT plant_id, kwh_delta, (meter_timestamp AT TIME ZONE 'Asia/Kolkata') - $3::interval AS t
    FROM plant_processed_meter_data
    WHERE plant_id = ANY($1::int[]) AND date BETWEEN $2::date - 1 AND $2::date + 1
  )
  SELECT plant_id,
         (extract(hour FROM t) * 4 + floor(extract(minute FROM t) / 15) + 1)::int AS block,
         sum(kwh_delta)::float8 AS kwh
  FROM m WHERE t::date = $2::date
  GROUP BY 1, 2`;

/** Latest IST calendar day with meter readings for the plant, or null when it has none. */
export async function latestMeterDate(q: Query, plantId: number): Promise<string | null> {
  const rows = await q<{ d: string | null }>(
    `SELECT max(date)::text AS d FROM plant_processed_meter_data WHERE plant_id = $1`, [plantId]);
  return rows[0]?.d ?? null;
}

export interface TodayData {
  date: string;
  isToday: boolean;
  now: number;                     // index (0-95) of the last block with meter data; -1 when none
  demand: number[];                // kW per block
  solar: number[];                 // kW per block generated (mapped generators x s_t_ratio)
  solarUsed: number[];             // kW of that solar that met demand: min(solar, demand)
  surplus: number[];               // kW of solar beyond demand: max(0, solar - demand)
  bank: number[];                  // kW drawn back from banked energy (adjusted_discharge, else discharge)
  iexUsed: number[];               // kW of the IEX purchase that met demand (settles first)
  tod: (string | null)[];          // DISCOM ToD period per block: PEAK / NORMAL / OFFPEAK (null when no tariff)
  gridRate: (number | null)[];     // DISCOM ₹/kWh per block for the plant's voltage level, incl. FPPCA
  solarRate: (number | null)[];    // solar ₹/kWh per block (state_grid_solar_tariff), when known
  todSource: TodSource | null;     // where the ToD schedule came from (fallbacks), null when none
  iex: number[];                   // kW per block (BUY)
  grid: number[];                  // kW per block, derived: whatever demand solar, banking and IEX didn't meet
  iexRate: (number | null)[];      // landed ₹/kWh per block
  mcp: (number | null)[];          // market clearing price ₹/kWh per block
  hasSolar: boolean;
  totals: { demandKwh: number; solarKwh: number; iexKwh: number; gridKwh: number; iexLandedRs: number; bankKwh: number; surplusKwh: number };
  landedRate: number | null;       // ₹/kWh for the day
  peak: { kw: number; block: number } | null;
  prebid: { status: 'none' | 'ok' | 'unrecognised'; planKw: number[] | null; markets: string[] };
  banking: BankingRow[];
  history: HistoryDay[];           // 7 days ending at date, oldest first
}

export interface BankingRow {
  block: number; charge: number; discharge: number; drawn: number; soc: number | null;
  peak_balance: number | null; normal_balance: number | null; offpeak_balance: number | null;
}
export interface HistoryDay { date: string; demandMwh: number; peakKw: number; iexMwh: number; landedRate: number | null }

const zeros = () => new Array<number>(96).fill(0);

export interface TodSource {
  kind: 'master' | 'master_discom' | 'master_state' | 'plant' | 'discom_category' | 'discom' | 'state';
  year: number; month: number;
}
interface TodRow { block: number; tod: string | null; grid_rate: number | null; solar_rate: number | null; source: string; src_year: number; src_month: number }

function perBlock<T>(rows: TodRow[], f: (r: TodRow) => T | null): (T | null)[] {
  const a: (T | null)[] = new Array(96).fill(null);
  for (const r of rows) if (r.block >= 1 && r.block <= 96) a[r.block - 1] = f(r);
  return a;
}

/**
 * The plant's ToD schedule for the day through app_tod_schedule() (migration 005), which falls back
 * to the same DISCOM / state and the nearest month. Before 005 is applied, falls back to the plant's
 * own rows for that month.
 */
export async function todSchedule(q: Query, plantId: number, date: string): Promise<{ rows: TodRow[]; source: TodSource | null }> {
  // Check first: an error inside the request's transaction would abort every query after it.
  const [{ ok }] = await q<{ ok: boolean }>(`SELECT to_regprocedure('app_tod_schedule(integer,date)') IS NOT NULL AS ok`);
  const rows = ok
    ? await q<TodRow>(`SELECT block, tod, grid_rate, solar_rate, source, src_year, src_month FROM app_tod_schedule($1, $2::date)`, [plantId, date])
    : await q<TodRow>(`
      SELECT DISTINCT ON (t.block) t.block, t.tod_type AS tod,
             (CASE lower(p.voltage_level) WHEN '132_kv' THEN t.tariff_132_kv WHEN '66_kv' THEN t.tariff_66_kv ELSE t.tariff_33_kv END
              + coalesce(t.fppca_charge, 0))::float8 AS grid_rate,
             NULL::float8 AS solar_rate, 'plant' AS source, t.year AS src_year, t.month AS src_month
      FROM state_grid_discom_tariff t JOIN plant p ON p.plant_id = t.plant_id
      WHERE t.plant_id = $1 AND t.year = extract(year FROM $2::date)::int AND t.month = extract(month FROM $2::date)::int
      ORDER BY t.block, t.id`, [plantId, date]);
  const r = rows[0];
  return { rows, source: r ? { kind: r.source as TodSource['kind'], year: r.src_year, month: r.src_month } : null };
}

/** 'Off-Peak', 'OFF_PEAK', 'offpeak' -> 'OFFPEAK'; 'Peak' -> 'PEAK'; 'Normal' -> 'NORMAL'. */
export function normaliseTod(v: string | null): string | null {
  if (!v) return null;
  // keep digits: DISCOMs may number repeated periods (NORMAL_1 05–11, NORMAL_2 11–17) and they must stay separate
  const k = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k || null;
}

export async function loadToday(q: Query, plantId: number, date: string): Promise<TodayData> {
  const shift = meterShift();
  const isToday = date === istToday();

  const mappings = await q<{ source_plant_id: number; s_t_ratio: number }>(
    `SELECT source_plant_id, s_t_ratio FROM plant_gen_con_mapping WHERE target_plant_id = $1 AND is_active`,
    [plantId],
  );
  const plantIds = [plantId, ...mappings.map((m) => m.source_plant_id)];

  const [meter, trades, prebids, banking, histMeter, histIex, tariff, statements] = await Promise.all([
    q<{ plant_id: number; block: number; kwh: number }>(BLOCK_SQL, [plantIds, date, shift]),
    q<{ block_no: number; kwh: number; landed: number; mcp: number | null }>(`
      SELECT block_no, sum(kwh)::float8 AS kwh, sum(landed)::float8 AS landed,
             (sum(mcp * cleared) / nullif(sum(cleared), 0))::float8 AS mcp
      FROM ${buyRows('b.plant_id = $1 AND b.date = $2::date')} t
      GROUP BY block_no`, [plantId, date]),
    q<{ market_type: string | null; prebid_plan_data: unknown }>(
      `SELECT market_type, prebid_plan_data FROM prebid_plan WHERE plant_id = $1 AND date = $2::date ORDER BY market_type`,
      [plantId, date]),
    q<BankingRow>(`
      SELECT block, coalesce(charge, 0)::float8 AS charge, coalesce(discharge, 0)::float8 AS discharge,
             coalesce(adjusted_discharge, 0)::float8 AS drawn, soc,
             peak_balance, normal_balance, offpeak_balance
      FROM banking WHERE plant_id = $1 AND date = $2::date ORDER BY block`, [plantId, date]),
    q<{ d: string; kwh: number; peak_kw: number }>(`
      WITH m AS (
        SELECT kwh_delta, (meter_timestamp AT TIME ZONE 'Asia/Kolkata') - $3::interval AS t
        FROM plant_processed_meter_data
        WHERE plant_id = $1 AND date BETWEEN $2::date - 7 AND $2::date + 1
      ), b AS (
        SELECT t::date AS d, date_trunc('minute', t) AS slot, sum(kwh_delta) AS kwh
        FROM m WHERE t::date BETWEEN $2::date - 6 AND $2::date GROUP BY 1, 2
      )
      SELECT d::text AS d, sum(kwh)::float8 AS kwh, (max(kwh) * 4)::float8 AS peak_kw FROM b GROUP BY d`,
      [plantId, date, shift]),
    q<{ d: string; kwh: number; landed: number }>(`
      SELECT date::text AS d, sum(kwh)::float8 AS kwh, sum(landed)::float8 AS landed
      FROM ${buyRows("b.plant_id = $1 AND b.date BETWEEN $2::date - 6 AND $2::date")} t
      GROUP BY date`, [plantId, date]),
    todSchedule(q, plantId, date),
    // ergOS's savings statements: their exchange cost is the day's cost, as on Savings and Billing
    q<{ d: string; cost: number; kwh: number }>(STATEMENT_COSTS_SQL, [plantId, '', addDays(date, -6), date]),
  ]);

  // ---- per-block series
  const demandKwh = zeros();
  const solarKwh = zeros();
  const ratio = new Map(mappings.map((m) => [m.source_plant_id, Number(m.s_t_ratio) || 0]));
  let last = -1;
  for (const r of meter) {
    if (r.block < 1 || r.block > 96) continue;
    if (r.plant_id === plantId) {
      demandKwh[r.block - 1] += r.kwh;
      last = Math.max(last, r.block - 1);
    } else {
      solarKwh[r.block - 1] += r.kwh * (ratio.get(r.plant_id) ?? 0);
    }
  }
  const now = isToday ? Math.min(last, currentBlock() - 1) : last;

  const iexKwh = zeros();
  const iexLanded = zeros();
  const iexRate: (number | null)[] = new Array(96).fill(null);
  const mcp: (number | null)[] = new Array(96).fill(null);
  for (const t of trades) {
    if (t.block_no < 1 || t.block_no > 96) continue;
    const i = t.block_no - 1;
    iexKwh[i] += t.kwh || 0;
    iexLanded[i] += t.landed || 0;
    iexRate[i] = t.kwh ? t.landed / t.kwh : null;
    mcp[i] = t.mcp;
  }
  // one exchange cost across the app: scale the day's block costs to its savings statement, when there is one
  const stmt = new Map(statements.map((r) => [r.d, r.cost]));
  const dayCost = stmt.get(date);
  const tradedCost = iexLanded.reduce((a, v) => a + v, 0);
  if (dayCost && tradedCost > 0) {
    const k = dayCost / tradedCost;
    for (let i = 0; i < 96; i++) { iexLanded[i] *= k; if (iexRate[i] != null) iexRate[i]! *= k; }
  }
  for (const r of histIex) { const c = stmt.get(r.d); if (c && r.landed > 0) r.landed = c; }

  const demand = demandKwh.map((k) => k * 4);
  const solar = solarKwh.map((k) => k * 4);
  const iex = iexKwh.map((k) => k * 4);
  const bankRaw = zeros();
  for (const r of banking) if (r.block >= 1 && r.block <= 96) bankRaw[r.block - 1] += (r.drawn || 0) * 4;

  // Meet demand bottom-up (IEX first, then solar, banking, grid): see lib/supply.ts, shared with History.
  const { solarUsed, bank, iexUsed, grid, surplus } = allocate(demand, iex, solar, bankRaw, now);

  const upTo = <T,>(a: T[]) => a.slice(0, now + 1);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totals = {
    demandKwh: sum(upTo(demandKwh)),
    solarKwh: sum(upTo(solarKwh)),
    iexKwh: sum(upTo(iexKwh)),
    gridKwh: sum(upTo(grid)) / 4,
    bankKwh: sum(upTo(bank)) / 4,
    surplusKwh: sum(upTo(surplus)) / 4,
    iexLandedRs: sum(upTo(iexLanded)),
  };
  const dayIexKwh = sum(iexKwh);
  const landedRate = dayIexKwh ? sum(iexLanded) / dayIexKwh : null;

  let peak: TodayData['peak'] = null;
  for (let i = 0; i <= now; i++) if (!peak || demand[i] > peak.kw) peak = { kw: demand[i], block: i + 1 };

  // ---- prebid: sum the curves across market types
  let prebid: TodayData['prebid'] = { status: 'none', planKw: null, markets: [] };
  if (prebids.length) {
    const curves = prebids.map((p) => parsePrebid(p.prebid_plan_data)).filter((c): c is number[] => !!c);
    prebid = curves.length
      ? { status: 'ok', planKw: sumCurves(curves), markets: prebids.map((p) => p.market_type || '—') }
      : { status: 'unrecognised', planKw: null, markets: prebids.map((p) => p.market_type || '—') };
  }

  // ---- 7-day history, oldest first
  const hm = new Map(histMeter.map((r) => [r.d, r]));
  const hi = new Map(histIex.map((r) => [r.d, r]));
  const history: HistoryDay[] = [];
  for (let k = 6; k >= 0; k--) {
    const d = addDays(date, -k);
    const m = hm.get(d);
    const x = hi.get(d);
    if (!m && !x) continue;
    history.push({
      date: d,
      demandMwh: (m?.kwh ?? 0) / 1000,
      peakKw: m?.peak_kw ?? 0,
      iexMwh: (x?.kwh ?? 0) / 1000,
      landedRate: x && x.kwh ? x.landed / x.kwh : null,
    });
  }

  return {
    tod: perBlock(tariff.rows, (t) => normaliseTod(t.tod)),
    gridRate: perBlock(tariff.rows, (t) => t.grid_rate),
    solarRate: perBlock(tariff.rows, (t) => t.solar_rate),
    todSource: tariff.source,
    date, isToday, now, demand, solar, solarUsed, surplus, bank, iex, iexUsed, grid, iexRate, mcp,
    hasSolar: mappings.length > 0,
    totals, landedRate, peak, prebid, banking, history,
  };
}
