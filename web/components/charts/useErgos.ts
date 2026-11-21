'use client';
import { useEffect, useRef } from 'react';
import { whenErgOS, type ErgOSRuntime } from '@/lib/ui/ergos';

/**
 * Draws into an empty host <div> that React never populates, once window.ErgOS exists.
 * `key` must change whenever the drawing inputs change.
 */
export function useErgosDraw(draw: (E: ErgOSRuntime, host: HTMLDivElement) => void, key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    let cancelled = false;
    const host = ref.current;
    whenErgOS().then((E) => {
      if (cancelled || !host) return;
      host.replaceChildren();
      drawRef.current(E, host);
    });
    return () => {
      cancelled = true;
      host?.replaceChildren();
    };
  }, [key]);
  return ref;
}
