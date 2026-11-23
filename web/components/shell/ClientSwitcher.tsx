'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClientLogo } from './ClientLogo';

export interface ClientOption {
  id: number;
  name: string;
  initials: string;
  meta: string;          // "8 plants · Uttar Pradesh"
  logo: string | null;   // resolved logo URL (lib/logo.ts) or null for initials
  href: string;
}

/**
 * Client switcher: an eg-account pill that opens a searchable list. With one client it is a
 * static label (no dropdown), so client users simply see whose data this is.
 */
export function ClientSwitcher({ clients, currentId, icons }: {
  clients: ClientOption[]; currentId: number; icons: { chevron: string; check: string; search: string };
}) {
  const router = useRouter();
  const current = clients.find((c) => c.id === currentId) ?? clients[0]!;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const many = clients.length > 1;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    setActive(Math.max(0, shown.findIndex((c) => c.id === currentId)));
    requestAnimationFrame(() => search.current?.focus());
    return () => document.removeEventListener('mousedown', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const Pill = (
    <>
      <ClientLogo src={current.logo} initials={current.initials} name={current.name} />
      <span className="ecv-client-text">
        <span className="eg-overline ecv-client-label">Client</span>
        <span className="eg-account__name">{current.name}</span>
        <span className="eg-account__meta">{current.meta}</span>
      </span>
    </>
  );

  if (!many) return <div className="eg-account ecv-client">{Pill}</div>;

  const go = (i: number) => {
    const c = shown[i];
    if (c) { setOpen(false); router.push(c.href); }
  };

  return (
    <div className="ecv-switcher" ref={root}>
      <button type="button" className="eg-account ecv-client ecv-client--button" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
        {Pill}
        <span className="ecv-chev" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons.chevron }} />
      </button>
      {open ? (
        <div className="ecv-popover" role="dialog" aria-label="Switch client"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); go(active); }
          }}>
          <label className="eg-input ecv-popover__search">
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons.search }} />
            <input ref={search} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={`Search ${clients.length} clients`} aria-label="Search clients" aria-controls={listId} />
          </label>
          <ul className="ecv-options" role="listbox" id={listId} aria-label="Clients">
            {shown.map((c, i) => (
              <li key={c.id} role="option" aria-selected={c.id === currentId}>
                <Link href={c.href} className={'ecv-option' + (i === active ? ' is-active' : '')}
                  onMouseEnter={() => setActive(i)} onClick={() => setOpen(false)}>
                  <ClientLogo src={c.logo} initials={c.initials} name={c.name} size="sm" />
                  <span className="ecv-option__text"><b>{c.name}</b><small>{c.meta}</small></span>
                  {c.id === currentId ? <span className="ecv-option__check" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons.check }} /> : null}
                </Link>
              </li>
            ))}
            {!shown.length ? <li className="ecv-options__empty">No client matches “{query}”</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
