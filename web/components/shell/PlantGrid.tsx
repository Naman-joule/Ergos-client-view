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

const MANY = 6;        // above this: compact tiles, search, state filter, grouping
const COLLAPSED = 12;  // tiles shown before "Show all"

/**
 * The client's plants. Up to 6: full eg-plant cards. More: compact tiles grouped by state, with
 * search, a state filter and a "Show all" toggle; the selected plant always stays visible.
 */
export function PlantGrid({ plants, selectedId, icons }: { plants: PlantOption[]; selectedId: number; icons: Icons }) {
  const many = plants.length > MANY;
  const [query, setQuery] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const collator = useMemo(() => new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' }), []);
  const sorted = useMemo(() => [...plants].sort((a, b) => collator.compare(a.name, b.name)), [plants, collator]);

  const states = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plants) m.set(p.state, (m.get(p.state) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [plants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((p) => (!state || p.state === state)
      && (!q || [p.name, p.location, p.state].some((v) => v.toLowerCase().includes(q))));
  }, [sorted, query, state]);

  const searching = !!query.trim() || !!state;
  const grouped = many && states.length > 1 && !state;
  const collapsible = many && !searching && filtered.length > COLLAPSED;
  const collapsed = collapsible && !expanded;
  // Collapsed: a few per state (so no state disappears), or the first 12 when there's one state.
  // The selected plant is always included.
  const perGroup = states.length >= 3 ? 3 : states.length === 2 ? 6 : COLLAPSED;   // whole rows at the usual widths
  const take = (items: PlantOption[], n: number) => {
    if (items.length <= n) return items;
    const head = items.slice(0, n);
    const sel = items.find((p) => p.id === selectedId);
    return sel && !head.includes(sel) ? [...head.slice(0, n - 1), sel] : head;
  };

  const groups = useMemo(() => {
    if (!grouped) return [{ state: null as string | null, total: filtered.length, items: collapsed ? take(filtered, COLLAPSED) : filtered }];
    return states
      .map(([st]) => {
        const items = filtered.filter((p) => p.state === st);
        return { state: st as string | null, total: items.length, items: collapsed ? take(items, perGroup) : items };
      })
      .filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, states, filtered, collapsed, perGroup, selectedId]);
  const hidden = filtered.length - groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="ecv-plantpicker">
      <div className="ecv-plantpicker__head">
        <span className="eg-overline">Plants <span className="eg-chip eg-chip--solid ecv-count">{plants.length}</span></span>
        {many && states.length > 1 ? (
          <div className="eg-pills ecv-pills" role="group" aria-label="Filter by state">
            <button type="button" aria-pressed={!state} onClick={() => setState(null)}>All</button>
            {states.slice(0, 6).map(([s, n]) => (
              <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(state === s ? null : s)}>{s} <span className="ecv-pills__n">{n}</span></button>
            ))}
          </div>
        ) : null}
        {many ? (
          <label className="eg-input ecv-plantpicker__search">
            <Ico svg={icons.search} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plants" aria-label="Search plants by name or location" />
          </label>
        ) : null}
      </div>

      {groups.map((g) => (
        <div key={g.state ?? 'all'} className="ecv-plantgroup">
          {g.state ? <div className="ecv-plantgroup__title"><Ico svg={icons.pin} />{g.state}<span>{g.total} plant{g.total === 1 ? '' : 's'}</span></div> : null}
          <div className={many ? 'ecv-ptiles' : 'ecv-plants'} role="list" aria-label={g.state ? `Plants in ${g.state}` : 'Plants'}>
            {g.items.map((p) => (many ? <Tile key={p.id} p={p} on={p.id === selectedId} icons={icons} /> : <Card key={p.id} p={p} on={p.id === selectedId} icons={icons} />))}
          </div>
        </div>
      ))}
      {!filtered.length ? <p className="eg-muted ecv-plants__empty">No plant matches{query ? ` “${query}”` : ''}{state ? ` in ${state}` : ''}.</p> : null}
      {collapsible ? (
        <button type="button" className="eg-btn eg-btn--sm eg-btn--ghost ecv-showall" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show fewer plants' : `Show all ${filtered.length} plants (${hidden} more)`}
        </button>
      ) : null}
    </div>
  );
}

/** Full card (few plants). */
function Card({ p, on, icons }: { p: PlantOption; on: boolean; icons: Icons }) {
  return (
    <Link role="listitem" href={p.href} className={'eg-plant' + (on ? ' is-selected' : '')} aria-current={on ? 'true' : undefined}>
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
}

/** Compact tile (many plants): name (up to 2 lines), capacity · voltage, DISCOM, auto-trading. */
function Tile({ p, on, icons }: { p: PlantOption; on: boolean; icons: Icons }) {
  return (
    <Link role="listitem" href={p.href} className={'eg-plant ecv-ptile' + (on ? ' is-selected' : '')} aria-current={on ? 'true' : undefined} title={p.name}>
      <span className="eg-plant__icon ecv-ptile__icon"><Ico svg={icons.factory} /></span>
      <span className="ecv-ptile__body">
        <span className="eg-plant__name ecv-ptile__name">{p.name}</span>
        <span className="ecv-ptile__meta">
          <span className="ecv-ptile__cap"><Ico svg={icons.bolt} />{p.capacity}</span>
          <span className="ecv-ptile__dot">·</span>
          <span className="ecv-nowrap">{p.voltage}</span>
          {p.autoTrading ? <><span className="ecv-ptile__dot">·</span><span className="ecv-ptile__auto"><span className="eg-dot eg-dot--live" />Auto</span></> : null}
        </span>
        <span className="ecv-ptile__loc"><Ico svg={icons.pin} />{p.location}</span>
      </span>
      <span className="eg-plant__radio">{on ? <Ico svg={icons.check} /> : null}</span>
    </Link>
  );
}
