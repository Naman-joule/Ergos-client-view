import 'server-only';
import type { Query } from '../db';
import { parsePrebid, sumCurves } from '../prebid';
import { addDays, currentBlock, istToday } from '../time';

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
  solar: number[];                 // kW per block (mapped generators x s_t_ratio)
  iex: number[];                   // kW per block (BUY)
  grid: number[];                  // kW per block, derived: max(0, demand - iex - solar)
  iexRate: (number | null)[];      // landed ₹/kWh per block
  mcp: (number | null)[];          // market clearing price ₹/kWh per block
  hasSolar: boolean;
  totals: { demandKwh: number; solarKwh: number; iexKwh: number; gridKwh: number; iexLandedRs: number };
  landedRate: number | null;       // ₹/kWh for the day
  peak: { kw: number; block: number } | null;
  prebid: { status: 'none' | 'ok' | 'unrecognised'; planKw: number[] | null; markets: string[] };
  banking: BankingRow[];
  history: HistoryDay[];           // 7 days ending at date, oldest first
}

export interface BankingRow {
  block: number; charge: number; discharge: number; soc: number | null;
  peak_balance: number | null; normal_balance: number | null; offpeak_balance: number | null;
}
export interface HistoryDay { date: string; demandMwh: number; peakKw: number; iexMwh: number; landedRate: number | null }

const zeros = () => new Array<number>(96).fill(0);

export async function loadToday(q: Query, plantId: number, date: string): Promise<TodayData> {
  const shift = meterShift();
  const isToday = date === istToday();

  const mappings = await q<{ source_plant_id: number; s_t_ratio: number }>(
    `SELECT source_plant_id, s_t_ratio FROM plant_gen_con_mapping WHERE target_plant_id = $1 AND is_active`,
    [plantId],
  );
  const plantIds = [plantId, ...mappings.map((m) => m.source_plant_id)];

  const [meter, trades, prebids, banking, histMeter, histIex] = await Promise.all([
    q<{ plant_id: number; block: number; kwh: number }>(BLOCK_SQL, [plantIds, date, shift]),
    q<{ block_no: number; kwh: number; landed: number; mcp: number | null }>(`
      SELECT block_no,
             sum(coalesce(cleared_quantity, cleared_quantity_mw * 250))::float8 AS kwh,
             sum(coalesce(landed_cost, coalesce(cleared_quantity, cleared_quantity_mw * 250) * landed_cost_rs_per_kwh))::float8 AS landed,
             (sum(CASE WHEN cleared_price > 100 THEN cleared_price / 1000 ELSE cleared_price END
                  * coalesce(cleared_quantity, cleared_quantity_mw * 250))
              / nullif(sum(coalesce(cleared_quantity, cleared_quantity_mw * 250)), 0))::float8 AS mcp
      FROM trading_result_block
      WHERE plant_id = $1 AND date = $2::date AND upper(type_) = 'BUY'
      GROUP BY block_no`, [plantId, date]),
    q<{ market_type: string | null; prebid_plan_data: unknown }>(
      `SELECT market_type, prebid_plan_data FROM prebid_plan WHERE plant_id = $1 AND date = $2::date ORDER BY market_type`,
      [plantId, date]),
    q<BankingRow>(`
      SELECT block, coalesce(charge, 0)::float8 AS charge, coalesce(discharge, 0)::float8 AS discharge, soc,
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
      SELECT date::text AS d,
             sum(coalesce(cleared_quantity, cleared_quantity_mw * 250))::float8 AS kwh,
             sum(coalesce(landed_cost, coalesce(cleared_quantity, cleared_quantity_mw * 250) * landed_cost_rs_per_kwh))::float8 AS landed
      FROM trading_result_block
      WHERE plant_id = $1 AND date BETWEEN $2::date - 6 AND $2::date AND upper(type_) = 'BUY'
      GROUP BY date`, [plantId, date]),
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

  const demand = demandKwh.map((k) => k * 4);
  const solar = solarKwh.map((k) => k * 4);
  const iex = iexKwh.map((k) => k * 4);
  const grid = demand.map((d, i) => (i <= now ? Math.max(0, d - iex[i] - solar[i]) : 0));

  const upTo = <T,>(a: T[]) => a.slice(0, now + 1);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totals = {
    demandKwh: sum(upTo(demandKwh)),
    solarKwh: sum(upTo(solarKwh)),
    iexKwh: sum(upTo(iexKwh)),
    gridKwh: sum(upTo(grid)) / 4,
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
    date, isToday, now, demand, solar, iex, grid, iexRate, mcp,
    hasSolar: mappings.length > 0,
    totals, landedRate, peak, prebid, banking, history,
  };
}
