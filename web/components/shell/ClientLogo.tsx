'use client';
import { useState } from 'react';

/** The client's logo, or its initials when there is no logo or it fails to load. */
export function ClientLogo({ src, initials, name, size = 'lg' }: { src: string | null; initials: string; name: string; size?: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <span className={`ecv-logo ecv-logo--${size}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${name} logo`} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className={`eg-avatar ecv-client-avatar${size === 'lg' ? ' eg-avatar--lg' : ''}`} aria-hidden="true">{initials}</span>;
}
