'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { msToNextRefresh } from '@/lib/time-state';

/** True while the user is reading or touching something that a refresh would move under them. */
function useInteractionLock() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const LOCK = '.ecv-hist__plot, .ecv-tod, .ecv-supply, .ecv-sv, [data-live-lock]';
    let over = false, down = false;
    const update = () => {
      const a = document.activeElement;
      const typing = !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
      setBusy(over || down || typing || !!document.querySelector('[aria-modal="true"]'));
    };
    const move = (e: PointerEvent) => { over = !!(e.target as Element | null)?.closest?.(LOCK); update(); };
    const press = () => { down = true; update(); };
    const release = () => { down = false; update(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update);
    };
  }, []);
  return busy;
}

/**
 * Refreshes the server-rendered page after each block's sync. The refresh runs inside a transition, so the
 * current page stays on screen until the new one is ready, and it waits while the user is interacting.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const due = useRef(false);
  const busy = useInteractionLock();

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { t = setTimeout(() => { due.current = true; setTick((n) => n + 1); arm(); }, msToNextRefresh()); };
    arm();
    const wake = () => { if (document.visibilityState === 'visible') { due.current = true; setTick((n) => n + 1); } };
    document.addEventListener('visibilitychange', wake);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', wake); };
  }, []);

  useEffect(() => {
    if (due.current && !busy && document.visibilityState === 'visible') {
      due.current = false;
      startTransition(() => router.refresh());
    }
  }, [tick, busy, router]);
  return null;
}
