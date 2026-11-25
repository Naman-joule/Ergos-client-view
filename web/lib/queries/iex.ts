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
