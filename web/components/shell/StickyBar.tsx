'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Compact time bar that slides in at the top of the page once the full plant/time bar above it has scrolled
 * out of view, so the date, range and plant controls are always one tap away. It sits in a zero-height sticky
 * track, so it never pushes content; hidden, it's inert and out of the accessibility tree.
 */
export function StickyBar({ title, children }: { title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const anchor = ref.current?.previousElementSibling;
    if (!anchor) return;
    const io = new IntersectionObserver(([e]) => setOn(!e!.isIntersecting && e!.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(anchor);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`ecv-stick${on ? ' is-on' : ''}`} aria-hidden={!on} inert={!on}>
      <div className="ecv-stick__bar eg-glass" role="region" aria-label="Date and plant">
        <b className="ecv-stick__title">{title}</b>
        <div className="ecv-stick__controls">{children}</div>
        <button type="button" className="eg-icon-btn eg-icon-btn--sm ecv-stick__top" aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>
    </div>
  );
}
