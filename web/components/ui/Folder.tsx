'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';

// Port of ErgOS.folder(): cuts the front into the folder shape and keeps it shaped on resize.
// The edge SVG is rendered by React; __egShaped tells harmony.js's auto-mount to leave it alone.
function folderPath(w: number, h: number, tw: number, dip: number, r: number, run: number): string {
  const y = dip;
  return `M0,${r}Q0,0 ${r},0` +
    `L${tw - run * 0.15},0` +
    `C${tw + run * 0.35},0 ${tw + run * 0.35},${y} ${tw + run},${y}` +
    `L${w - r},${y}Q${w},${y} ${w},${y + r}` +
    `L${w},${h - r}Q${w},${h} ${w - r},${h}` +
    `L${r},${h}Q0,${h} 0,${h - r}Z`;
}

export function Folder({ sheets, children }: { sheets?: ReactNode; children: ReactNode }) {
  const [shape, setShape] = useState<{ d: string; w: number; h: number } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const front = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    (el as HTMLDivElement & { __egShaped?: boolean }).__egShaped = true;
    const run = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      const cs = getComputedStyle(el);
      const dip = parseFloat(cs.getPropertyValue('--folder-dip')) || 56;
      const ratio = parseFloat(cs.getPropertyValue('--folder-tab')) || 0.42;
      const r = Math.min(36, h / 4);
      const rn = Math.min(130, Math.max(70, w * 0.11));
      const tw = Math.max(170, Math.min(w - rn - r - 20, w * ratio));
      const d = folderPath(w, h, tw, dip, r, rn);
      el.style.clipPath = `path('${d}')`;
      el.style.setProperty('-webkit-clip-path', `path('${d}')`);
      el.classList.add('is-shaped');
      setShape((s) => (s && s.d === d ? s : { d, w, h }));
    };
    run();
    observer.current = new ResizeObserver(() => requestAnimationFrame(run));
    observer.current.observe(el);
  }, []);

  return (
    <div className="eg-folder">
      <div className="eg-folder__back" />
      {sheets ? <div className="eg-folder__sheets" aria-hidden="true">{sheets}</div> : null}
      <div className="eg-folder__front" ref={front}>
        <svg className="eg-folder__edge" aria-hidden="true" viewBox={shape ? `0 0 ${shape.w} ${shape.h}` : undefined}
          width={shape?.w} height={shape?.h}>
          {shape ? <path className="eg-folder__edge-line" d={shape.d} /> : null}
        </svg>
        {children}
      </div>
    </div>
  );
}

export function Sheet({ kicker, children }: { kicker: ReactNode; children: ReactNode }) {
  return <div className="eg-sheet"><div className="eg-sheet__kicker">{kicker}</div>{children}</div>;
}
