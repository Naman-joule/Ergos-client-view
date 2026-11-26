'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** The header's account menu (a <details>): closes on navigation, an outside tap, or Escape. */
export function UserMenu({ summary, label, title, children }: { summary: ReactNode; label: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [path]);
  useEffect(() => {
    const away = (e: PointerEvent) => { const d = ref.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, []);
  return (
    <details ref={ref} className="ecv-usermenu">
      <summary className="eg-avatar eg-avatar--lg ecv-avatar" aria-label={label} title={title}>{summary}</summary>
      {children}
    </details>
  );
}
