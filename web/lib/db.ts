import 'server-only';
import pg from 'pg';

// Type parsers: numeric -> float, int8 -> int, date -> raw 'YYYY-MM-DD' (never shifted by time zone).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v) => v);

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

const g = globalThis as unknown as { __ecvPool?: pg.Pool };

function sslConfig(): pg.PoolConfig['ssl'] {
  if (process.env.DATABASE_SSL === 'disable') return false;
  // Supabase's pooler certificate chains to Supabase's own CA. Set DATABASE_SSL_CA to its PEM
  // (Project settings -> Database -> SSL) to verify it; otherwise the link is encrypted, unverified.
  const ca = process.env.DATABASE_SSL_CA;
  return ca ? { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

function pool(): pg.Pool {
  if (!g.__ecvPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__ecvPool = new pg.Pool({
      connectionString: url,
      max: 5,
      ssl: sslConfig(),
      statement_timeout: 15_000,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    g.__ecvPool.on('error', (e) => console.error('pg pool error', e.message));
  }
  return g.__ecvPool;
}

async function inTransaction<T>(begin: string, userId: number | null, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  const q: Query = async (text, params) => (await client.query(text, params as unknown[])).rows;
  try {
    await client.query(begin);
    // Transaction-local (third arg true): safe on the Supabase transaction pooler (port 6543).
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId === null ? '' : String(userId)]);
    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Read-only transaction scoped to a user; RLS sees app.user_id. */
export function withUser<T>(userId: number, fn: (q: Query) => Promise<T>): Promise<T> {
  return inTransaction('BEGIN READ ONLY', userId, fn);
}

/** Read-write transaction scoped to a user. The only writable table is dashboard_config. */
export function withUserWrite<T>(userId: number, fn: (q: Query) => Promise<T>): Promise<T> {
  return inTransaction('BEGIN', userId, fn);
}

/** No user: for login (app_auth_lookup) and the health check only. RLS hides all tenant data. */
export function anonymous<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return inTransaction('BEGIN READ ONLY', null, fn);
}

/** No user, read-write: only for the login lockout functions (app_login_failed / app_login_succeeded). */
export function anonymousWrite<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return inTransaction('BEGIN', null, fn);
}
