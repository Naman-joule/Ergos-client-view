'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface PlantOption {
  id: number;
  name: string;
  location: string;      // DISCOM or state
  capacity: string;      // "4.5 MW" or "—"
  voltage: string;       // "33 kV" or "—"
  state: string;
  autoTrading: boolean;
  href: string;
}

type Icons = Record<'factory' | 'pin' | 'check' | 'bolt' | 'trend' | 'search', string>;
const Ico = ({ svg }: { svg: string }) => <span className="ecv-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;

/** The client's plants as a grid of eg-plant cards; a search box appears once there are more than 6. */
export function PlantGrid({ plants, selectedId, icons }: { plants: PlantOption[]; selectedId: number; icons: Icons }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plants;
    return plants.filter((p) => [p.name, p.location, p.state].some((v) => v.toLowerCase().includes(q)));
  }, [plants, query]);

  return (
    <div className="ecv-plantpicker">
      <div className="ecv-plantpicker__head">
        <span className="eg-overline">Plants <span className="eg-chip eg-chip--solid ecv-count">{plants.length}</span></span>
        {plants.length > 6 ? (
          <label className="eg-input ecv-plantpicker__search">
            <Ico svg={icons.search} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plants by name or location" aria-label="Search plants" />
          </label>
        ) : null}
      </div>
      <div className="ecv-plants" role="list" aria-label="Plants">
        {shown.map((p) => {
          const on = p.id === selectedId;
          return (
            <Link key={p.id} role="listitem" href={p.href} className={'eg-plant' + (on ? ' is-selected' : '')} aria-current={on ? 'true' : undefined}>
              <span className="eg-plant__head">
                <span className="eg-plant__icon"><Ico svg={icons.factory} /></span>
                <span className="ecv-plant__titles">
                  <span className="eg-plant__name" title={p.name}>{p.name}</span>
                  <span className="eg-plant__loc"><Ico svg={icons.pin} />{p.location}</span>
                </span>
                <span className="eg-plant__radio">{on ? <Ico svg={icons.check} /> : null}</span>
              </span>
              <span className="eg-plant__stats">
                <span className="eg-plant__cap"><Ico svg={icons.bolt} />{p.capacity}</span>
                <span className="eg-plant__iex"><Ico svg={icons.trend} />{p.voltage}</span>
              </span>
              <span className="eg-plant__foot">
                <span>{p.state}</span>
                <span className="eg-chip"><span className={p.autoTrading ? 'eg-dot eg-dot--live' : 'eg-dot eg-dot--off'} />Auto: {p.autoTrading ? 'ON' : 'OFF'}</span>
              </span>
            </Link>
          );
        })}
        {!shown.length ? <p className="eg-muted ecv-plants__empty">No plant matches “{query}”.</p> : null}
      </div>
    </div>
  );
}
