'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A thin bar at the top while the next page loads. Pages render on the server and some take a few seconds
 * (a month of 15-minute data); without this a click looked like nothing happened. It starts on a click on an
 * internal link or a GET form submit, and stops when the URL changes. Fixed position: nothing moves.
 */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams();
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setOn(false); window.clearTimeout(timer.current); }, [path, search]);

  useEffect(() => {
    const start = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setOn(true); timer.current = window.setTimeout(() => setOn(false), 15_000); }, 120);   // never spin forever
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const submit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      const action = f.getAttribute('action') ?? '';
      // only real page loads: a plain GET form to a page (React server-action forms have a javascript: action)
      if ((f.getAttribute('method') ?? 'get').toLowerCase() === 'get' && action && !action.startsWith('javascript:') && !action.includes('/api/')) start();
    };
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('submit', submit, true); };
  }, []);

  return <div className={`ecv-progress${on ? ' is-on' : ''}`} role="progressbar" aria-hidden={!on} aria-label="Loading" />;
}
