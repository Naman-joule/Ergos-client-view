import 'server-only';

// Per-email login throttle for THIS server instance: 5 failures, then a 5-minute lockout.
// Serverless instances don't share memory, so this only slows down a single warm instance.
// Production still needs rate limiting at the edge (Vercel Firewall rate-limit rule on /login).
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;
const WINDOW_MS = 15 * 60_000;

type Entry = { failures: number; first: number; lockedUntil: number };
const g = globalThis as unknown as { __ecvThrottle?: Map<string, Entry> };
const table = (g.__ecvThrottle ??= new Map());

export function isLocked(email: string, now = Date.now()): boolean {
  const e = table.get(email);
  return !!e && e.lockedUntil > now;
}

export function recordFailure(email: string, now = Date.now()): void {
  let e = table.get(email);
  if (!e || now - e.first > WINDOW_MS) e = { failures: 0, first: now, lockedUntil: 0 };
  e.failures++;
  if (e.failures >= MAX_FAILURES) { e.lockedUntil = now + LOCK_MS; e.failures = 0; e.first = now; }
  table.set(email, e);
  if (table.size > 10_000) for (const [k, v] of table) if (v.lockedUntil < now && now - v.first > WINDOW_MS) table.delete(k);
}

export function clearFailures(email: string): void {
  table.delete(email);
}
