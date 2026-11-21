import type { ReactNode } from 'react';

/** eg-glass panel with an eg-card__head. */
export function Card({ title, sub, actions, children, className }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={['eg-glass', 'ecv-card', className].filter(Boolean).join(' ')}>
      <div className="eg-card__head">
        <div>
          <h3 className="eg-card__title">{title}</h3>
          {sub ? <p className="eg-card__sub">{sub}</p> : null}
        </div>
        {actions ? <div className="eg-row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
