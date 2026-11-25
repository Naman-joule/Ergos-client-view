'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Menu button for narrow screens (CSS shows it below 1180 px). Opens the sidebar as a drawer by setting
 * data-nav="open" on <html>; closes on Escape, on the backdrop, and whenever the page changes.
 */
export function NavToggle() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.nav = 'open'; else delete root.dataset.nav;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="eg-icon-btn eg-icon-btn--sm ecv-navbtn" aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open} aria-controls="ecv-side" onClick={() => setOpen((o) => !o)}>
        <svg className="eg-ico" viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <div className="ecv-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
    </>
  );
}
