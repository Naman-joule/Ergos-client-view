import 'server-only';
import type { Query } from '../db';

export interface ClientRow { client_id: number; name: string; alias_name: string | null; logo_url: string | null }
export interface PlantRow {
  plant_id: number; client_id: number; name: string; state: string; discom: string | null;
  connected_load: number | null; voltage_level: string | null; is_auto_trading_enabled: boolean | null;
}
export interface Scope { clients: ClientRow[]; plants: PlantRow[] }
export interface Selection {
  client: ClientRow; plant: PlantRow; plants: PlantRow[];
  /** a plant or client was asked for in the URL that this user can't see; the selection fell back */
  denied?: boolean;
}

/** Clients and consumer plants this user can see. No user filter here: RLS does it.
 *  Plants without a client are skipped (nothing to group them under). */
export async function loadScope(q: Query): Promise<Scope> {
  const [clients, plants] = await Promise.all([
    q<ClientRow>(`SELECT client_id, name, alias_name, logo_url FROM client WHERE coalesce(is_active, true) ORDER BY name`),
    q<PlantRow>(`
      SELECT p.plant_id, p.client_id, p.name, p.state, p.discom, p.connected_load, p.voltage_level, p.is_auto_trading_enabled
      FROM plant p LEFT JOIN plant_type t ON t.id = p.plant_type_id
      -- Every plant except generators (captive solar etc.). Tolerant of case and of a missing type.
      WHERE lower(coalesce(t.type, '')) NOT IN ('generator', 'generation')
        AND coalesce(p.is_active, true)
      ORDER BY p.name NULLS LAST`),
  ]);
  const withPlants = new Set(plants.map((p) => p.client_id));
  return { clients: clients.filter((c) => withPlants.has(c.client_id)), plants: plants.filter((p) => p.client_id !== null) };
}

const toId = (v: unknown) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The client and plant to show: the URL's, else the one remembered from the last page (cookie, see
 * middleware.ts), else the first. A URL asking for a plant or client the user can't see falls back and
 * says so (denied), instead of silently showing another plant.
 */
export function resolveSelection(scope: Scope, params: { client?: unknown; plant?: unknown },
  remembered?: { client?: unknown; plant?: unknown }): Selection | null {
  if (!scope.plants.length) return null;
  const asked = toId(params.plant) || toId(params.client);
  const pick = (pr: { client?: unknown; plant?: unknown }) => {
    const pid = toId(pr.plant), cid = toId(pr.client);
    let plant = pid ? scope.plants.find((p) => p.plant_id === pid) : undefined;
    let client = plant ? scope.clients.find((c) => c.client_id === plant!.client_id) : undefined;
    if (!plant && cid) {
      client = scope.clients.find((c) => c.client_id === cid);
      plant = client ? scope.plants.find((p) => p.client_id === client!.client_id) : undefined;
    }
    return plant && client ? { plant, client } : null;
  };
  let hit = pick(params);
  const denied = !!asked && !hit;
  if (!hit && !asked && remembered) hit = pick(remembered);
  if (!hit) {
    const client = scope.clients[0];
    const plant = client ? scope.plants.find((p) => p.client_id === client.client_id) : undefined;
    hit = plant && client ? { plant, client } : null;
  }
  if (!hit) return null;
  return { ...hit, plants: scope.plants.filter((p) => p.client_id === hit!.client.client_id), denied };
}
