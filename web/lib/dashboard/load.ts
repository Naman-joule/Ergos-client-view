import 'server-only';
import type { Query } from '../db';
import { DEFAULT_SPEC } from './defaults';
import { validateSpec, type DashboardSpec } from './schema';

export interface LoadedSpec {
  spec: DashboardSpec;
  source: 'client' | 'global' | 'default';
  /** Set when a stored spec failed validation. Show only to users with manage_dashboards. */
  error: string | null;
}

/** The client's published config, else the global published config, else the built-in default. */
export async function loadSpec(q: Query, clientId: number): Promise<LoadedSpec> {
  const rows = await q<{ client_id: number | null; version: number; spec: unknown }>(`
    SELECT client_id, version, spec FROM dashboard_config
    WHERE status = 'published' AND (client_id = $1 OR client_id IS NULL)
    ORDER BY client_id NULLS LAST
    LIMIT 1`, [clientId]);
  const row = rows[0];
  if (!row) return { spec: DEFAULT_SPEC, source: 'default', error: null };
  const v = validateSpec(row.spec);
  const source = row.client_id === null ? 'global' : 'client';
  if (v.ok) return { spec: v.spec, source, error: null };
  return { spec: DEFAULT_SPEC, source: 'default', error: `${source} config v${row.version} is invalid, showing the default layout. ${v.error}` };
}
