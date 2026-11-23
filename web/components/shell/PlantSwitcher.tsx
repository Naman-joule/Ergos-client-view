'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

type Icons = Record<'factory' | 'pin' | 'check' | 'bolt' | 'search' | 'chevron' | 'left' | 'right', string>;
const Ico = ({ svg }: { svg: string }) => <span className="ecv-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;

/**
 * Plant switcher: shows only the selected plant (one row, whatever the plant count), with ‹ › to
 * step through the client's plants. Opening it gives a searchable list grouped by state, with
 * state filters once there are several states; arrow keys and Enter work throughout.
 */
export function PlantSwitcher({ plants, selectedId, icons }: { plants: PlantOption[]; selectedId: number; icons: Icons }) {
  const router = useRouter();
  const collator = useMemo(() => new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' }), []);
  const sorted = useMemo(() => [...plants].sort((a, b) => collator.compare(a.name, b.name)), [plants, collator]);
  const index = Math.max(0, sorted.findIndex((p) => p.id === selectedId));
  const current = sorted[index]!;
  const prev = sorted.length > 1 ? sorted[(index - 1 + sorted.length) % sorted.length] : null;
  const next = sorted.length > 1 ? sorted[(index + 1) % sorted.length] : null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const states = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of sorted) m.set(p.state, (m.get(p.state) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((p) => (!state || p.state === state)
      && (!q || [p.name, p.location, p.state].some((v) => v.toLowerCase().includes(q))));
  }, [sorted, query, state]);

  // Group by state (in the order of the filter pills) when there's more than one state in view.
  const groups = useMemo(() => {
    const inView = new Set(filtered.map((p) => p.state));
    if (inView.size < 2) return [{ state: null as string | null, items: filtered }];
    return states.map(([s]) => ({ state: s as string | null, items: filtered.filter((p) => p.state === s) })).filter((g) => g.items.length);
  }, [filtered, states]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    setActive(Math.max(0, flat.findIndex((p) => p.id === selectedId)));
    requestAnimationFrame(() => {
      search.current?.focus();
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => document.removeEventListener('mousedown', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const go = (p: PlantOption | undefined) => { if (p) { setOpen(false); router.push(p.href); } };

  return (
    <div className="ecv-plantsw" ref={root}>
      <div className="ecv-plantsw__row">
        <button type="button" className="eg-account ecv-plantsw__button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
          onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
          <span className="eg-plant__icon ecv-plantsw__icon"><Ico svg={icons.factory} /></span>
          <span className="ecv-client-text">
            <span className="eg-overline ecv-client-label">Plant{sorted.length > 1 ? ` · ${index + 1} of ${sorted.length}` : ''}</span>
            <span className="eg-account__name" title={current.name}>{current.name}</span>
            <span className="eg-account__meta ecv-plantsw__meta">
              {current.capacity} · {current.voltage} · {current.location}{current.autoTrading ? <> · <span className="eg-dot eg-dot--live" /> Auto</> : null}
            </span>
          </span>
          <span className="ecv-chev" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons.chevron }} />
        </button>
        {prev && next ? (
          <span className="ecv-plantsw__step">
            <Link className="eg-icon-btn eg-icon-btn--sm" href={prev.href} aria-label={`Previous plant: ${prev.name}`} title={prev.name}><Ico svg={icons.left} /></Link>
            <Link className="eg-icon-btn eg-icon-btn--sm" href={next.href} aria-label={`Next plant: ${next.name}`} title={next.name}><Ico svg={icons.right} /></Link>
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="ecv-popover ecv-popover--plants" role="dialog" aria-label="Switch plant"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
          }}>
          <label className="eg-input ecv-popover__search">
            <Ico svg={icons.search} />
            <input ref={search} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={`Search ${sorted.length} plants by name or location`} aria-label="Search plants" aria-controls={listId} />
          </label>
          {states.length > 1 ? (
            <div className="eg-pills ecv-pills" role="group" aria-label="Filter by state">
              <button type="button" aria-pressed={!state} onClick={() => { setState(null); setActive(0); }}>All <span className="ecv-pills__n">{sorted.length}</span></button>
              {states.map(([s, n]) => (
                <button key={s} type="button" aria-pressed={state === s} onClick={() => { setState(state === s ? null : s); setActive(0); }}>{s} <span className="ecv-pills__n">{n}</span></button>
              ))}
            </div>
          ) : null}
          <ul className="ecv-options ecv-options--plants" role="listbox" id={listId} aria-label="Plants" ref={list}>
            {groups.map((g) => (
              <li key={g.state ?? 'all'} role="presentation">
                {g.state ? <div className="ecv-options__group"><Ico svg={icons.pin} />{g.state}<span>{g.items.length}</span></div> : null}
                <ul role="presentation" className="ecv-options__items">
                  {g.items.map((p) => {
                    const i = flat.indexOf(p);
                    const on = p.id === selectedId;
                    return (
                      <li key={p.id} role="option" aria-selected={on}>
                        <Link href={p.href} className={'ecv-option ecv-option--plant' + (i === active ? ' is-active' : '')}
                          onMouseEnter={() => setActive(i)} onClick={() => setOpen(false)}>
                          <span className="eg-plant__icon ecv-option__icon"><Ico svg={icons.factory} /></span>
                          <span className="ecv-option__text">
                            <b>{p.name}</b>
                            <small>{p.location}{p.autoTrading ? ' · Auto-trading on' : ''}</small>
                          </span>
                          <span className="ecv-option__cap"><Ico svg={icons.bolt} />{p.capacity}<small>{p.voltage}</small></span>
                          <span className="ecv-option__check" aria-hidden="true">{on ? <Ico svg={icons.check} /> : null}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {!flat.length ? <li className="ecv-options__empty">No plant matches{query ? ` “${query}”` : ''}{state ? ` in ${state}` : ''}.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
