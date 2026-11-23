import type { ReactNode } from 'react';
import type { ClientRow, PlantRow, Scope } from '@/lib/queries/scope';
import { inr } from '@/lib/format';
import { iconSvg } from '@/lib/ui/icon-svg';
import { ClientSwitcher, type ClientOption } from './ClientSwitcher';
import { PlantGrid, type PlantOption } from './PlantGrid';

function initials(name: string): string {
  const words = name.replace(/\b(ltd|limited|pvt|private|inc|llp)\b\.?/gi, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

function clientMeta(plants: PlantRow[]): string {
  const states = [...new Set(plants.map((p) => p.state).filter(Boolean))];
  const where = states.length === 0 ? '' : states.length <= 2 ? ` · ${states.join(', ')}` : ` · ${states.length} states`;
  return `${plants.length} plant${plants.length === 1 ? '' : 's'}${where}`;
}

/**
 * The page's scope: which client (switcher) and which plant (grid), plus page controls on the right
 * (day pager on Today, period on Savings).
 */
export function ScopeBar({ scope, client, plant, clientHref, plantHref, controls, below }: {
  scope: Scope; client: ClientRow; plant: PlantRow;
  clientHref: (c: ClientRow) => string; plantHref: (p: PlantRow) => string;
  controls?: ReactNode; below?: ReactNode;
}) {
  const byClient = (id: number) => scope.plants.filter((p) => p.client_id === id);
  const clients: ClientOption[] = scope.clients.map((c) => ({
    id: c.client_id, name: c.name, initials: initials(c.alias_name || c.name), meta: clientMeta(byClient(c.client_id)), href: clientHref(c),
  }));
  const plants: PlantOption[] = byClient(client.client_id).map((p) => ({
    id: p.plant_id,
    name: p.name,
    location: p.discom ?? p.state,
    capacity: p.connected_load ? `${inr(p.connected_load, p.connected_load % 1 ? 2 : 0)} MW` : '—',
    voltage: p.voltage_level ? p.voltage_level.replace(/_kv$/i, ' kV') : '—',
    state: p.state,
    autoTrading: !!p.is_auto_trading_enabled,
    href: plantHref(p),
  }));
  const icon = (n: string, s = 14) => iconSvg(n, s);
  return (
    <section className="eg-glass ecv-scope" aria-label="Client and plant">
      <div className="ecv-scope__top">
        <ClientSwitcher clients={clients} currentId={client.client_id}
          icons={{ chevron: icon('chevron-down', 16), check: icon('check', 16), search: icon('search', 16) }} />
        {controls ? <div className="ecv-scope__controls">{controls}</div> : null}
      </div>
      <PlantGrid plants={plants} selectedId={plant.plant_id}
        icons={{ factory: icon('factory', 20), pin: icon('pin', 13), check: icon('check', 14), bolt: icon('bolt', 16), trend: icon('trend', 14), search: icon('search', 16) }} />
      {below}
    </section>
  );
}
