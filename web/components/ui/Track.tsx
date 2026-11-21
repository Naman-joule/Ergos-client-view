import type { CSSProperties, ReactNode } from 'react';

/** eg-track: a rail with a fill and marker at `value` (0..1). */
export function Track({ value, left, leftNote, right, rightNote }: {
  value: number; left: ReactNode; leftNote?: ReactNode; right: ReactNode; rightNote?: ReactNode;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="eg-track" style={{ '--value': `${(v * 100).toFixed(1)}%` } as CSSProperties}>
      <div className="eg-track__labels">
        <span>{left}{leftNote ? <small>{leftNote}</small> : null}</span>
        <span>{right}{rightNote ? <small>{rightNote}</small> : null}</span>
      </div>
      <div className="eg-track__rail"><div className="eg-track__fill" /><div className="eg-track__marker" /></div>
    </div>
  );
}
