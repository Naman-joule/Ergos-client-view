import 'server-only';
import { anonymous, anonymousWrite } from './db';

// Login lockout: 5 failed sign-ins for an email within 15 minutes lock it for 15 minutes. Kept in the
// database (migration 012), so every server instance sees the same count; serverless instances don't share
// memory, which made the old in-memory counter nearly useless. Before migration 012 runs, or if the database
// call fails, it falls back to this instance's memory rather than blocking sign-in.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const g = globalThis as unknown as { __ecvThrottle?: Map<string, number[]> };
const mem: Map<string, number[]> = (g.__ecvThrottle ??= new Map<string, number[]>());

const recent = (email: string, now = Date.now()) => (mem.get(email) ?? []).filter((t: number) => now - t < WINDOW_MS);
const missing = (e: unknown) => /app_login_\w+\(.*\) does not exist|function app_login/.test((e as Error).message ?? '');

export async function isLocked(email: string): Promise<boolean> {
  try {
    const [r] = await anonymous((q) => q<{ locked: boolean }>('SELECT app_login_locked($1) AS locked', [email]));
    return !!r?.locked;
  } catch (e) {
    if (!missing(e)) console.error('login lockout check failed:', (e as Error).message);
    return recent(email).length >= MAX_FAILURES;
  }
}

export async function recordFailure(email: string): Promise<void> {
  mem.set(email, [...recent(email), Date.now()]);
  if (mem.size > 10_000) for (const k of mem.keys()) if (!recent(k).length) mem.delete(k);
  await anonymousWrite((q) => q('SELECT app_login_failed($1)', [email])).catch((e) => {
    if (!missing(e)) console.error('login failure not recorded:', (e as Error).message);
  });
}

export async function clearFailures(email: string): Promise<void> {
  mem.delete(email);
  await anonymousWrite((q) => q('SELECT app_login_succeeded($1)', [email])).catch(() => {});
}
