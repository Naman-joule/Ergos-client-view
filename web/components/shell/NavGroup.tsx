'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

/**
 * A sidebar entry with sub-pages (Reports → Plant load, IEX obligation).
 *   laptop sidebar: an accordion under the entry; open on its own pages, toggled by the entry
 *   tablet rail / phone tab bar: a small menu beside / above the entry; closes on a pick, outside tap or Escape
 */
export function NavGroup({ label, icon, chevron, current, items }: {
  label: string; icon: ReactNode; chevron: ReactNode; current: boolean;
  items: { href: string; label: string; current: boolean }[];
}) {
  const [expanded, setExpanded] = useState(current);   // sidebar accordion
  const [fly, setFly] = useState(false);               // rail / tab-bar menu
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!fly) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setFly(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFly(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [fly]);

  const toggle = () => {
    if (window.matchMedia('(min-width: 1180px)').matches) setExpanded((v) => !v);
    else setFly((v) => !v);
  };

  return (
    <div ref={ref} className="ecv-navgroup" data-expanded={expanded} data-fly={fly}>
      <button type="button" className="eg-nav__item ecv-nav__item ecv-navgroup__btn" onClick={toggle}
        aria-current={current ? 'page' : undefined} aria-expanded={expanded || fly} aria-controls={id} title={label}>
        {icon}<span className="ecv-nav__label">{label}</span><span className="ecv-navgroup__chev" aria-hidden="true">{chevron}</span>
      </button>
      <ul id={id} className="ecv-navgroup__menu" aria-label={label}>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="ecv-navgroup__link" aria-current={i.current ? 'page' : undefined} onClick={() => setFly(false)}>{i.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
