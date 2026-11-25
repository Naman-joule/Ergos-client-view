// Freshness of synced data and the live refresh schedule. Pure, so node:test can load it.

/** Data freshness from minutes since the last successful sync (the sync runs every 15 minutes). */
export type TimeState = 'live' | 'delayed' | 'stale';
export function timeState(lag: number | null): TimeState {
  if (lag === null || lag > 90) return 'stale';
  return lag > 30 ? 'delayed' : 'live';
}

export const BLOCK_MS = 15 * 60_000;
export const SETTLE_MS = 90_000;            // the sync lands within ~90 s of a block boundary
const IST_MS = 5.5 * 3_600_000;             // IST has no DST, so block boundaries are fixed in UTC too
/** Milliseconds until 90 s after the next 15-minute IST block boundary. */
export const msToNextRefresh = (now = Date.now()) => BLOCK_MS - ((now + IST_MS) % BLOCK_MS) + SETTLE_MS;

/** "4 min ago", "3 h ago", "2 d ago" */
export const ago = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);
