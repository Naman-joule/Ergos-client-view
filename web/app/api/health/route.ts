import { NextResponse } from 'next/server';
import { anonymous } from '@/lib/db';
import { SYNC_STALE_MINUTES, syncLagMinutes } from '@/lib/queries/sync';

export const dynamic = 'force-dynamic';

/** DB round trip plus sync lag. No tenant data. */
export async function GET() {
  const t0 = Date.now();
  try {
    const lag = await anonymous(async (q) => { await q('SELECT 1'); return syncLagMinutes(q); });
    const stale = lag === null || lag > SYNC_STALE_MINUTES;
    return NextResponse.json(
      { ok: true, db_ms: Date.now() - t0, sync_lag_minutes: lag === null ? null : Math.round(lag * 10) / 10, sync_stale: stale },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ ok: false, db_ms: Date.now() - t0 }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
