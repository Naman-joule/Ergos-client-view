import 'server-only';
import type { Query } from '../db';
import { addDays } from '../time';

// IEX market prices (DAM, RTM, GDAM), the same for every user: per-block clearing price and volume for a day,
// and daily averages over the last 30 days. From iex_market_block (migration 007), synced from the IEX data DB.

export const MARKETS = [
  { key: 'DAM', label: 'Day-ahead (DAM)', short: 'DAM', slot: 'iex' },
  { key: 'RTM', label: 'Real-time (RTM)', short: 'RTM', slot: 'grid' },
  { key: 'GDAM', label: 'Green day-ahead (GDAM)', short: 'GDAM', slot: 'solar' },
] as const;
export type MarketKey = (typeof MARKETS)[number]['key'];

export interface MarketDay {
  key: MarketKey;
  mcp: (number | null)[];          // ₹/kWh per block
  mcv: (number | null)[];          // cleared MW per block
  blocks: number;                  // blocks with a price
  avg: number | null;              // volume-weighted ₹/kWh (simple average when volumes are missing)
  min: { rate: number; block: number } | null;
  max: { rate: number; block: number } | null;
  mwh: number;                     // cleared energy
}
export interface MarketTrendDay { date: string; avg: Partial<Record<MarketKey, number>>; mwh: Partial<Record<MarketKey, number>> }
export interface IexData { date: string; latest: string | null; earliest: string | null; markets: MarketDay[]; trend: MarketTrendDay[]; hasData: boolean }

export async function iexDateRange(q: Query): Promise<{ earliest: string | null; latest: string | null }> {
  const [r] = await q<{ earliest: string | null; latest: string | null }>(
    `SELECT min(date)::text AS earliest, max(date)::text AS latest FROM day_ahead_market_snapshot`);
  return r ?? { earliest: null, latest: null };
}

export async function loadIex(q: Query, date: string, range: { earliest: string | null; latest: string | null }): Promise<IexData> {
  const [blocks, trend] = await Promise.all([
    q<{ market: MarketKey; block: number; mcp: number | null; mcv: number | null }>(
      `SELECT market, block, mcp_rs_per_kwh::float8 AS mcp, mcv_mw::float8 AS mcv FROM iex_market_block WHERE date = $1::date`, [date]),
    q<{ d: string; market: MarketKey; avg: number | null; mwh: number | null }>(`
      SELECT date::text AS d, market,
             coalesce(sum(mcp_rs_per_kwh * mcv_mw) / nullif(sum(mcv_mw) FILTER (WHERE mcp_rs_per_kwh IS NOT NULL), 0), avg(mcp_rs_per_kwh))::float8 AS avg,
             (sum(mcv_mw) / 4)::float8 AS mwh
      FROM iex_market_block WHERE date BETWEEN $1::date - 29 AND $1::date
      GROUP BY 1, 2`, [date]),
  ]);

  const markets: MarketDay[] = MARKETS.map(({ key }) => {
    const mcp = new Array<number | null>(96).fill(null), mcv = new Array<number | null>(96).fill(null);
    for (const r of blocks) if (r.market === key && r.block >= 1 && r.block <= 96) { mcp[r.block - 1] = r.mcp; mcv[r.block - 1] = r.mcv; }
    let num = 0, den = 0, sum = 0, n = 0, mwh = 0;
    let min: MarketDay['min'] = null, max: MarketDay['max'] = null;
    mcp.forEach((p, i) => {
      if (p == null) return;
      sum += p; n++;
      const v = mcv[i];
      if (v != null && v > 0) { num += p * v; den += v; mwh += v / 4; }
      if (!min || p < min.rate) min = { rate: p, block: i + 1 };
      if (!max || p > max.rate) max = { rate: p, block: i + 1 };
    });
    return { key, mcp, mcv, blocks: n, avg: den ? num / den : n ? sum / n : null, min, max, mwh };
  });

  const byDay = new Map<string, MarketTrendDay>();
  for (let k = 29; k >= 0; k--) { const d = addDays(date, -k); byDay.set(d, { date: d, avg: {}, mwh: {} }); }
  for (const r of trend) {
    const day = byDay.get(r.d);
    if (!day) continue;
    if (r.avg != null) day.avg[r.market] = r.avg;
    if (r.mwh != null) day.mwh[r.market] = r.mwh;
  }

  return { date, ...range, markets, trend: [...byDay.values()], hasData: markets.some((m) => m.blocks > 0) };
}

// ---- ranges and the paged block table -------------------------------------------------------------------

export interface MarketRange {
  key: MarketKey;
  avg: number | null;                                        // volume-weighted ₹/kWh over the range
  min: { rate: number; date: string; block: number } | null;
  max: { rate: number; date: string; block: number } | null;
  mwh: number; blocks: number; days: number;
  profile: (number | null)[];                                // average ₹/kWh per block of the day, across the range
}
export interface IexRangeData { from: string; to: string; markets: MarketRange[]; trend: MarketTrendDay[]; hasData: boolean }

/** Prices across from…to: per-market summary, the daily trend, and the average price at each block of the day. */
export async function loadIexRange(q: Query, from: string, to: string): Promise<IexRangeData> {
  const [summary, extremes, trend, profile] = await Promise.all([
    q<{ market: MarketKey; avg: number | null; mwh: number | null; blocks: number; days: number }>(`
      SELECT market,
             coalesce(sum(mcp_rs_per_kwh * mcv_mw) / nullif(sum(mcv_mw) FILTER (WHERE mcp_rs_per_kwh IS NOT NULL), 0), avg(mcp_rs_per_kwh))::float8 AS avg,
             (sum(mcv_mw) / 4)::float8 AS mwh, count(mcp_rs_per_kwh)::int AS blocks, count(DISTINCT date)::int AS days
      FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date GROUP BY market`, [from, to]),
    q<{ market: MarketKey; kind: 'min' | 'max'; rate: number; d: string; block: number }>(`
      SELECT * FROM (
        SELECT DISTINCT ON (market) market, 'min' AS kind, mcp_rs_per_kwh::float8 AS rate, date::text AS d, block
        FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date AND mcp_rs_per_kwh IS NOT NULL
        ORDER BY market, mcp_rs_per_kwh, date, block) lo
      UNION ALL
      SELECT * FROM (
        SELECT DISTINCT ON (market) market, 'max', mcp_rs_per_kwh::float8, date::text, block
        FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date AND mcp_rs_per_kwh IS NOT NULL
        ORDER BY market, mcp_rs_per_kwh DESC, date, block) hi`, [from, to]),
    q<{ d: string; market: MarketKey; avg: number | null; mwh: number | null }>(`
      SELECT date::text AS d, market,
             coalesce(sum(mcp_rs_per_kwh * mcv_mw) / nullif(sum(mcv_mw) FILTER (WHERE mcp_rs_per_kwh IS NOT NULL), 0), avg(mcp_rs_per_kwh))::float8 AS avg,
             (sum(mcv_mw) / 4)::float8 AS mwh
      FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date GROUP BY 1, 2`, [from, to]),
    q<{ market: MarketKey; block: number; avg: number | null }>(`
      SELECT market, block, avg(mcp_rs_per_kwh)::float8 AS avg
      FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date GROUP BY 1, 2`, [from, to]),
  ]);
  const markets: MarketRange[] = MARKETS.map(({ key }) => {
    const s = summary.find((r) => r.market === key);
    const lo = extremes.find((r) => r.market === key && r.kind === 'min');
    const hi = extremes.find((r) => r.market === key && r.kind === 'max');
    const prof = new Array<number | null>(96).fill(null);
    for (const r of profile) if (r.market === key && r.block >= 1 && r.block <= 96) prof[r.block - 1] = r.avg;
    return {
      key, avg: s?.avg ?? null, mwh: s?.mwh ?? 0, blocks: s?.blocks ?? 0, days: s?.days ?? 0, profile: prof,
      min: lo ? { rate: lo.rate, date: lo.d, block: lo.block } : null,
      max: hi ? { rate: hi.rate, date: hi.d, block: hi.block } : null,
    };
  });
  const byDay = new Map<string, MarketTrendDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, { date: d, avg: {}, mwh: {} });
  for (const r of trend) {
    const day = byDay.get(r.d);
    if (!day) continue;
    if (r.avg != null) day.avg[r.market] = r.avg;
    if (r.mwh != null) day.mwh[r.market] = r.mwh;
  }
  return { from, to, markets, trend: [...byDay.values()], hasData: markets.some((m) => m.blocks > 0) };
}

export interface IexRow { date: string; block: number; mcp: Partial<Record<MarketKey, number | null>>; mcv: Partial<Record<MarketKey, number | null>> }

/** How many (day, block) rows have a price in any market between from and to. */
export async function countIexRows(q: Query, from: string, to: string): Promise<number> {
  const [r] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM (SELECT DISTINCT date, block FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date) x`, [from, to]);
  return r?.n ?? 0;
}

/** One page of the block table: a row per day and block (date, then block, ascending), all markets side by side. */
export async function loadIexRows(q: Query, from: string, to: string, offset: number, limit: number): Promise<IexRow[]> {
  const rows = await q<{ d: string; block: number; dam: number | null; rtm: number | null; gdam: number | null;
    dam_mw: number | null; rtm_mw: number | null; gdam_mw: number | null }>(`
    SELECT date::text AS d, block,
           max(mcp_rs_per_kwh) FILTER (WHERE market = 'DAM')::float8 AS dam,
           max(mcp_rs_per_kwh) FILTER (WHERE market = 'RTM')::float8 AS rtm,
           max(mcp_rs_per_kwh) FILTER (WHERE market = 'GDAM')::float8 AS gdam,
           max(mcv_mw) FILTER (WHERE market = 'DAM')::float8 AS dam_mw,
           max(mcv_mw) FILTER (WHERE market = 'RTM')::float8 AS rtm_mw,
           max(mcv_mw) FILTER (WHERE market = 'GDAM')::float8 AS gdam_mw
    FROM iex_market_block WHERE date BETWEEN $1::date AND $2::date
    GROUP BY 1, 2 ORDER BY 1, 2 LIMIT $3 OFFSET $4`, [from, to, limit, offset]);
  return rows.map((r) => ({
    date: r.d, block: r.block,
    mcp: { DAM: r.dam, RTM: r.rtm, GDAM: r.gdam },
    mcv: { DAM: r.dam_mw, RTM: r.rtm_mw, GDAM: r.gdam_mw },
  }));
}
