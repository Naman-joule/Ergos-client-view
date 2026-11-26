import 'server-only';
import type { Query } from '../db';
import { meterShift } from './today';
import { buildMonthLoad, buildPlantLoad, type BlockKwh, type LoadBlock, type LoadSummary, type MeterRow, type MonthLoad } from '../plant-load';
export type { DayLoad, LoadBlock, LoadFlag, LoadPoint, LoadSummary, MonthLoad } from '../plant-load';

/**
 * Plant load report: one day of the plant's own energy meter, as its data logger recorded it, block by block.
 * Only readings that exist in plant_processed_meter_data are shown: a block without a reading stays empty, and
 * readings ergOS filled in (flag 'interpolated') are marked. Nothing is estimated or made up here.
 *
 * Readings are bucketed into IST 15-minute blocks the same way as the Energy page (meter_timestamp shifted by
 * METER_TS_CONVENTION), so the report's total matches Energy for the same day.
 */
export async function loadPlantLoad(q: Query, plantId: number, date: string): Promise<{ blocks: LoadBlock[]; summary: LoadSummary }> {
  const rows = await q<MeterRow>(`
    WITH m AS (
      SELECT meter_timestamp, kwh, kwh_delta, kvah, cumulative_pf, flags,
             (meter_timestamp AT TIME ZONE 'Asia/Kolkata') - $3::interval AS t,
             lag(kvah) OVER (ORDER BY meter_timestamp) AS prev_kvah
      FROM plant_processed_meter_data
      WHERE plant_id = $1 AND date BETWEEN $2::date - 1 AND $2::date + 1
    )
    SELECT (extract(hour FROM t) * 4 + floor(extract(minute FROM t) / 15) + 1)::int AS block,
           to_char(meter_timestamp AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS ts,
           kwh::float8 AS kwh, kwh_delta::float8 AS kwh_delta, kvah::float8 AS kvah, prev_kvah::float8 AS prev_kvah,
           cumulative_pf::float8 AS pf, flags
    FROM m WHERE t::date = $2::date
    ORDER BY meter_timestamp`, [plantId, date, meterShift()]);

  return buildPlantLoad(rows);
}

/** The plant's most recent reading, IST 'YYYY-MM-DD HH:MM', or null — shows how fresh the logger's data is. */
export async function lastReading(q: Query, plantId: number): Promise<string | null> {
  const [r] = await q<{ ts: string | null }>(`
    SELECT to_char(max(meter_timestamp) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS ts
    FROM plant_processed_meter_data WHERE plant_id = $1`, [plantId]);
  return r?.ts ?? null;
}

/**
 * Month of plant load: each block's energy for every day from `from` to `to` (bucketed exactly as the day view),
 * then each day's and the month's maximum and minimum load. Readings flagged 'missing' carry no value and are
 * left out, as in the day view.
 */
export async function loadPlantLoadMonth(q: Query, plantId: number, from: string, to: string): Promise<MonthLoad> {
  const rows = await q<BlockKwh>(`
    WITH m AS (
      SELECT kwh_delta, flags, (meter_timestamp AT TIME ZONE 'Asia/Kolkata') - $4::interval AS t
      FROM plant_processed_meter_data
      WHERE plant_id = $1 AND date BETWEEN $2::date - 1 AND $3::date + 1
    )
    SELECT t::date::text AS d, (extract(hour FROM t) * 4 + floor(extract(minute FROM t) / 15) + 1)::int AS block,
           sum(kwh_delta)::float8 AS kwh
    FROM m
    WHERE t::date BETWEEN $2::date AND $3::date AND kwh_delta IS NOT NULL
      AND lower(trim(coalesce(flags, ''))) <> 'missing'
    GROUP BY 1, 2`, [plantId, from, to, meterShift()]);
  const dates: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)) dates.push(d);
  return buildMonthLoad(rows, dates);
}
