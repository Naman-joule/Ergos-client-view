import { NextResponse } from 'next/server';
import { anonymous } from '@/lib/db';
import { SYNC_STALE_MINUTES, syncLagMinutes } from '@/lib/queries/sync';

export const dynamic = 'force-dynamic';

/** DB round trip plus sync lag. No tenant data. */
export async function GET() {
  const t0 = Date.now();
  const sessionSecretOk = (process.env.SESSION_SECRET ?? '').length >= 32;
  try {
    const lag = await anonymous(async (q) => { await q('SELECT 1'); return syncLagMinutes(q); });
    const stale = lag === null || lag > SYNC_STALE_MINUTES;
    return NextResponse.json(
      { ok: true, db_ms: Date.now() - t0, sync_lag_minutes: lag === null ? null : Math.round(lag * 10) / 10, sync_stale: stale, session_secret_ok: sessionSecretOk },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('health: database check failed:', (e as Error).message);
    return NextResponse.json({ ok: false, db_ms: Date.now() - t0, session_secret_ok: sessionSecretOk }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
