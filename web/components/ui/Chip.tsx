import type { ReactNode } from 'react';

export type ChipTone = 'default' | 'accent' | 'negative' | 'warning' | 'solid';

export function Chip({ tone = 'default', lg, mono, time, children, title }: {
  tone?: ChipTone; lg?: boolean; mono?: boolean; time?: boolean; children: ReactNode; title?: string;
}) {
  const cls = ['eg-chip', tone !== 'default' && `eg-chip--${tone}`, lg && 'eg-chip--lg', mono && 'eg-chip--mono', time && 'eg-chip--time']
    .filter(Boolean).join(' ');
  return <span className={cls} title={title}>{children}</span>;
}

export function LiveDot({ off }: { off?: boolean }) {
  return <span className={off ? 'eg-dot eg-dot--off' : 'eg-dot eg-dot--live'} />;
}
