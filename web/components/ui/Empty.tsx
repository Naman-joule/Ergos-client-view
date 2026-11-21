import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Empty({ title, children, icon = 'clock' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="ecv-empty" role="status">
      <span className="eg-icon-btn eg-icon-btn--sm" aria-hidden="true"><Icon name={icon} size={17} /></span>
      <div>
        <b>{title}</b>
        {children ? <p className="eg-muted">{children}</p> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = 'warning', children }: { tone?: 'warning' | 'negative'; children: ReactNode }) {
  return <div className={`ecv-notice ecv-notice--${tone}`} role="status">{children}</div>;
}
