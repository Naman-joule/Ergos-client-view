import Link from 'next/link';
import { Icon } from '../ui/Icon';
import { inr } from '@/lib/format';
import type { PlantRow } from '@/lib/queries/scope';

export function PlantStrip({ plants, selected, hrefFor }: { plants: PlantRow[]; selected: number; hrefFor: (p: PlantRow) => string }) {
  return (
    <div className="ecv-plants" role="list" aria-label="Plants">
      {plants.map((p) => {
        const on = p.plant_id === selected;
        return (
          <Link key={p.plant_id} role="listitem" href={hrefFor(p)} className={'eg-plant' + (on ? ' is-selected' : '')}
            aria-current={on ? 'true' : undefined}>
            <span className="eg-plant__head">
              <span className="eg-plant__icon"><Icon name="factory" size={20} /></span>
              <span>
                <span className="eg-plant__name">{p.name}</span>
                <span className="eg-plant__loc"><Icon name="pin" size={13} />{p.discom ?? p.state}</span>
              </span>
              <span className="eg-plant__radio">{on ? <Icon name="check" size={14} /> : null}</span>
            </span>
            <span className="eg-plant__stats">
              <span className="eg-plant__cap"><Icon name="bolt" size={16} />{p.connected_load ? `${inr(p.connected_load, p.connected_load % 1 ? 2 : 0)} MW` : '—'}</span>
              <span className="eg-plant__iex"><Icon name="trend" size={14} />{p.voltage_level ? p.voltage_level.replace('_kv', ' kV') : '—'}</span>
            </span>
            <span className="eg-plant__foot">
              <span>{p.state}</span>
              <span className="eg-chip"><span className={p.is_auto_trading_enabled ? 'eg-dot eg-dot--live' : 'eg-dot eg-dot--off'} />Auto: {p.is_auto_trading_enabled ? 'ON' : 'OFF'}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
