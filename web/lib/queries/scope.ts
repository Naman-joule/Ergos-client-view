import 'server-only';
import type { Query } from '../db';

export interface ClientRow { client_id: number; name: string; alias_name: string | null; logo_url: string | null }
export interface PlantRow {
  plant_id: number; client_id: number; name: string; state: string; discom: string | null;
  connected_load: number | null; voltage_level: string | null; is_auto_trading_enabled: boolean | null;
}
export interface Scope { clients: ClientRow[]; plants: PlantRow[] }
export interface Selection { client: ClientRow; plant: PlantRow; plants: PlantRow[] }

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
 * Picks the client and plant to show. A plant or client id from the query string that isn't
 * visible silently falls back to the first visible one, without hinting that it exists.
 */
export function resolveSelection(scope: Scope, params: { client?: unknown; plant?: unknown }): Selection | null {
  if (!scope.plants.length) return null;
  const pid = toId(params.plant);
  const cid = toId(params.client);
  let plant = pid ? scope.plants.find((p) => p.plant_id === pid) : undefined;
  let client = plant ? scope.clients.find((c) => c.client_id === plant!.client_id) : undefined;
  if (!plant && cid) {
    client = scope.clients.find((c) => c.client_id === cid);
    plant = client ? scope.plants.find((p) => p.client_id === client!.client_id) : undefined;
  }
  if (!plant || !client) {
    client = scope.clients[0];
    plant = scope.plants.find((p) => p.client_id === client!.client_id);
  }
  if (!plant || !client) return null;
  return { client, plant, plants: scope.plants.filter((p) => p.client_id === client!.client_id) };
}
