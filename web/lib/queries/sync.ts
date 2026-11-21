import 'server-only';
import type { Query } from '../db';

/** Minutes since the last successful fast sync run, or null if none is recorded. */
export async function syncLagMinutes(q: Query): Promise<number | null> {
  const rows = await q<{ minutes: number | null }>(`
    SELECT extract(epoch FROM now() - max(finished_at)) / 60 AS minutes
    FROM sync_runs
    WHERE tier = 'fast' AND table_name = '__run__' AND status = 'ok'
      AND coalesce(error, '') NOT LIKE 'dry run%'`);
  const m = rows[0]?.minutes;
  return m === null || m === undefined ? null : Number(m);
}

export const SYNC_STALE_MINUTES = 35;
